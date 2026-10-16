import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import puppeteer from "puppeteer";
import {
  classifyProcessLifecycles,
  describeRuns,
  shuffled,
  summarizeByOperationKind,
  summarizeProcessCpuTime,
  summarizeTrace,
} from "./report-utils.mjs";

const usage = `Usage: npm run metrics:chrome -- [--flag=value ...]

  --url=URL                    Measure a server you started yourself (default: build + preview on http://127.0.0.1:4173)
  --framework=React|Solid      Only this framework
  --variant=baseline|optimized Only this variant
  --scenario=KEY               Only this scenario
  --control=true|false         Include the Control (no-op) condition (default: true)
  --suiteRuns=N                Repeated runs per condition in one browser session (default: 10)
  --warmup=N                   Warm-up operations per run (default: 5)
  --iterations=N               Measured operations per run (default: 25)
  --shuffle=true|false         Seeded shuffle of condition order per run (default: true)
  --seed=N                     Shuffle seed (default: 1)
  --saveTraces[=true]          Save gzipped Chrome trace files
  --verifyOnly[=true]          Only run the in-browser correctness pass
  --autoStartServer=true|false Build and start a preview server when --url is unreachable (default: true)
  --chromeExecutablePath=PATH  Chrome binary (also CHROME_EXECUTABLE_PATH)
  --help                       Show this help`;

const knownFlags = new Set(
  [...usage.matchAll(/--(\w+)/g)].map((match) => match[1]),
);

const args = new Map(
  process.argv.slice(2).map((entry) => {
    const match = /^--(\w+)(?:=(.*))?$/.exec(entry);
    if (!match || !knownFlags.has(match[1])) {
      console.error(`Unknown argument: ${entry}\n\n${usage}`);
      process.exit(1);
    }
    return [match[1], match[2]];
  }),
);

if (args.has("help")) {
  console.log(usage);
  process.exit(0);
}

function readNumberArg(key, fallback, min = 0) {
  const raw = args.get(key);
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new Error(
      `Invalid value for --${key}: ${raw} (expected an integer >= ${min})`,
    );
  }
  return Number(raw);
}

function readBoolArg(key, fallback) {
  if (!args.has(key)) {
    return fallback;
  }
  const raw = args.get(key);
  if (raw === undefined || raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  throw new Error(`Invalid boolean value for --${key}: ${raw}`);
}

function metricValue(metrics, name) {
  return metrics.find((entry) => entry.name === name)?.value ?? 0;
}

function parseUrlParts(inputUrl) {
  const parsed = new URL(inputUrl);
  const host = parsed.hostname;
  const port = Number.parseInt(
    parsed.port || (parsed.protocol === "https:" ? "443" : "80"),
    10,
  );

  if (!Number.isFinite(port)) {
    throw new Error(`Invalid URL port: ${inputUrl}`);
  }

  return { host, port };
}

async function isUrlReachable(inputUrl, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(inputUrl, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForUrl(inputUrl, timeoutMs = 30000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (await isUrlReachable(inputUrl)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function resolveChromeExecutablePath() {
  const configuredPath =
    args.get("chromeExecutablePath") ?? process.env.CHROME_EXECUTABLE_PATH;
  if (configuredPath) {
    return configuredPath;
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  const standardPath = path.join(
    process.env.ProgramFiles ?? "C:\\Program Files",
    "Google",
    "Chrome",
    "Application",
    "chrome.exe",
  );

  try {
    await fs.access(standardPath);
    return standardPath;
  } catch {
    return undefined;
  }
}

function stopChildProcess(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    // taskkill ensures Vite and child process tree are terminated on Windows.
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
}

function conditionLabel({ framework, variant, scenario }) {
  return `${framework}-${variant}-${scenario}`;
}

function summarizeCondition(condition, runs) {
  if (runs.length === 0) {
    return undefined;
  }
  const across = (select) => describeRuns(runs.map(select));

  return {
    ...condition,
    suiteRuns: runs.length,
    options: runs[0].aggregate.options,
    summaryAcrossRuns: {
      runMedianLatencyMs: across((entry) => entry.aggregate.medianMs),
      runMedianLatencyMsByKind: Object.fromEntries(
        Object.keys(runs[0].operationKinds).map((kind) => [
          kind,
          across((entry) => entry.operationKinds[kind].medianMs),
        ]),
      ),
      runP95LatencyMs: across((entry) => entry.aggregate.p95Ms),
      capturedRunMedianLatencyMs: across(
        (entry) => entry.capturedAggregate.medianMs,
      ),
      taskDurationMs: across((entry) => entry.cdpMetrics.taskDurationMs),
      rendererMainRenderingUnionMs: across(
        (entry) => entry.traceMetrics.rendererMainRenderingUnionMs,
      ),
      rendererMainGcUnionMs: across(
        (entry) => entry.traceMetrics.rendererMainGcUnionMs,
      ),
      bothEndpointsCpuTimeMs: across(
        (entry) => entry.cpuMetrics.bothEndpointsCpuTimeMs,
      ),
      jsHeapUsedMb: across((entry) => entry.cdpMetrics.jsHeapUsedMb),
    },
    runs,
  };
}

const explicitUrl = args.has("url");
const url = args.get("url") ?? "http://127.0.0.1:4173";
const suiteRuns = readNumberArg("suiteRuns", 10, 1);
const warmupIterations = readNumberArg("warmup", 5);
const iterations = readNumberArg("iterations", 25, 1);
const saveTraces = readBoolArg("saveTraces", false);
const verifyOnly = readBoolArg("verifyOnly", false);
const autoStartServer = readBoolArg("autoStartServer", true);
const shuffleOrder = readBoolArg("shuffle", true);
const orderSeed = readNumberArg("seed", 1);
const includeControl = readBoolArg("control", true);
const frameworkFilter = args.get("framework");
const variantFilter = args.get("variant");
const scenarioFilter = args.get("scenario");

const benchmarkOptions = { warmupIterations, iterations };

const hostEnvironment = {
  os: os.version(),
  osRelease: os.release(),
  cpu: os.cpus()[0]?.model.trim(),
  logicalProcessors: os.cpus().length,
  ramGiB: Math.round(os.totalmem() / 1024 ** 3),
  node: process.version,
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function git(...gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: process.cwd(),
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

async function packageVersion(name) {
  const manifest = path.join(
    process.cwd(),
    "node_modules",
    name,
    "package.json",
  );
  return JSON.parse(await fs.readFile(manifest, "utf-8")).version;
}

const statusText = git("status", "--porcelain=v1", "--untracked-files=all");
const statusEntries = statusText
  ? statusText.toString("utf-8").split("\n").filter(Boolean)
  : [];
const trackedDiff = git("diff", "HEAD", "--binary");
const source = {
  gitCommit: git("rev-parse", "HEAD")?.toString("utf-8").trim() ?? null,
  uncommittedChanges: statusText === null ? null : statusEntries.length > 0,
  statusEntries,
  trackedDiffSha256: trackedDiff?.length ? sha256(trackedDiff) : null,
  trackedDiffFile: trackedDiff?.length ? "source.patch" : null,
  untrackedFiles: await Promise.all(
    statusEntries
      .filter((entry) => entry.startsWith("?? "))
      .map(async (entry) => {
        const file = entry.slice(3);
        return { file, sha256: sha256(await fs.readFile(file)) };
      }),
  ),
};
if (source.uncommittedChanges) {
  console.warn(
    "Warning: uncommitted changes. The report stores the tracked diff (source.patch) and hashes of untracked files; commit for a clean source revision.",
  );
}
const tools = Object.fromEntries(
  await Promise.all(
    [
      "puppeteer",
      "vite",
      "@vitejs/plugin-react",
      "vite-plugin-solid",
      "typescript",
    ].map(async (name) => [name, await packageVersion(name)]),
  ),
);
const configFiles = Object.fromEntries(
  await Promise.all(
    [
      "package.json",
      "package-lock.json",
      "vite.config.ts",
      "tsconfig.json",
      "index.html",
    ].map(async (file) => [file, sha256(await fs.readFile(file))]),
  ),
);
const chromeArgs = [
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];
const traceCategories = [
  "devtools.timeline",
  "v8",
  "blink.user_timing",
  "disabled-by-default-devtools.timeline",
];

// Same CDP calls page.tracing uses, but on our own session so tracingComplete.dataLossOccurred is visible.
async function stopTracing(session) {
  const complete = new Promise((resolve) =>
    session.once("Tracing.tracingComplete", resolve),
  );
  await session.send("Tracing.end");
  const { stream, dataLossOccurred } = await complete;
  const chunks = [];
  for (;;) {
    const { data, base64Encoded, eof } = await session.send("IO.read", {
      handle: stream,
    });
    chunks.push(Buffer.from(data, base64Encoded ? "base64" : "utf-8"));
    if (eof) {
      break;
    }
  }
  await session.send("IO.close", { handle: stream });
  return {
    bytes: Buffer.concat(chunks),
    dataLossOccurred:
      typeof dataLossOccurred === "boolean" ? dataLossOccurred : "unknown",
  };
}

// Hashes the bytes the preview server actually serves (index.html and the assets it references).
async function hashServedFiles(baseUrl) {
  const indexResponse = await fetch(baseUrl);
  const html = Buffer.from(await indexResponse.arrayBuffer());
  const assets = [
    ...new Set(
      [
        ...html
          .toString("utf-8")
          .matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
      ].map((match) => match[1]),
    ),
  ];
  const files = [
    {
      path: new URL(baseUrl).pathname,
      bytes: html.length,
      sha256: sha256(html),
    },
  ];
  for (const asset of assets) {
    const body = Buffer.from(
      await (await fetch(new URL(asset, baseUrl))).arrayBuffer(),
    );
    files.push({ path: asset, bytes: body.length, sha256: sha256(body) });
  }
  return {
    files,
    headers: {
      crossOriginOpenerPolicy: indexResponse.headers.get(
        "cross-origin-opener-policy",
      ),
      crossOriginEmbedderPolicy: indexResponse.headers.get(
        "cross-origin-embedder-policy",
      ),
    },
  };
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "bench", "results", runId);

let localServerProcess = null;
let browser;
const { host: urlHost, port: urlPort } = parseUrlParts(url);

// Starts before the server so any failure still stops it and frees the port.
try {
  if (await isUrlReachable(url)) {
    if (!explicitUrl) {
      throw new Error(
        `${url} is already serving something, possibly an outdated build. Stop that server, or pass --url=${url} to measure it deliberately.`,
      );
    }
  } else {
    if (!autoStartServer) {
      throw new Error(
        `Target URL is not reachable: ${url}. Start the app first or use --autoStartServer=true.`,
      );
    }

    const viteBin = path.join(
      process.cwd(),
      "node_modules",
      "vite",
      "bin",
      "vite.js",
    );
    // Measure the production bundle; dev builds of React and Solid add checks that distort timings.
    const build = spawnSync(process.execPath, [viteBin, "build"], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
    });
    if (build.status !== 0) {
      throw new Error("Production build failed; cannot start preview server.");
    }

    localServerProcess = spawn(
      process.execPath,
      [
        viteBin,
        "preview",
        "--host",
        urlHost,
        "--port",
        String(urlPort),
        "--strictPort",
      ],
      {
        cwd: process.cwd(),
        stdio: "ignore",
        windowsHide: true,
      },
    );

    if (!(await waitForUrl(url, 45000))) {
      throw new Error(
        `Auto-started preview server did not become ready at ${url} within timeout.`,
      );
    }
  }

  const chromeExecutablePath = await resolveChromeExecutablePath();
  const launchOptions = {
    headless: true,
    executablePath: chromeExecutablePath,
    args: chromeArgs,
  };
  const servedFiles = await hashServedFiles(url);

  const openBenchmarkPage = async (targetBrowser) => {
    const page = await targetBrowser.newPage();
    const load = async () => {
      await page.goto(url, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => Boolean(window.__nestedUiBenchmark));
    };
    await load();
    return { page, load };
  };

  // Correctness pass in its own browser launch (same bundle and flags), so it leaves no state in the measured session.
  browser = await puppeteer.launch(launchOptions);
  const verifier = await openBenchmarkPage(browser);
  const {
    scenarios,
    scenarioDefinitions,
    pageAdapters,
    buildMode,
    loadedScripts,
  } = await verifier.page.evaluate(() => ({
    scenarios: window.__nestedUiBenchmark.scenarios,
    scenarioDefinitions: window.__nestedUiBenchmark.scenarioDefinitions,
    pageAdapters: window.__nestedUiBenchmark.adapters,
    buildMode: window.__nestedUiBenchmark.buildMode,
    loadedScripts: [...document.scripts].map(
      (script) => new URL(script.src).pathname,
    ),
  }));
  servedFiles.pageScriptsHashed = loadedScripts.every((script) =>
    servedFiles.files.some((file) => file.path === script),
  );
  if (buildMode !== "production") {
    console.warn(
      `Warning: target page reports build mode "${buildMode}"; timings from non-production builds are not comparable.`,
    );
  }
  const activeScenarios = scenarioFilter
    ? scenarios.filter((scenario) => scenario === scenarioFilter)
    : scenarios;

  if (activeScenarios.length === 0) {
    throw new Error(`Invalid value for --scenario: ${scenarioFilter}`);
  }

  const frameworkAdapters = pageAdapters.filter(
    ({ framework, variant }) =>
      framework !== "Control" &&
      (!frameworkFilter || framework === frameworkFilter) &&
      (!variantFilter || variant === variantFilter),
  );
  if (frameworkAdapters.length === 0) {
    throw new Error(
      `No adapter matches --framework=${frameworkFilter ?? "*"} --variant=${variantFilter ?? "*"}`,
    );
  }
  const activeAdapters = includeControl
    ? [
        ...frameworkAdapters,
        ...pageAdapters.filter(({ framework }) => framework === "Control"),
      ]
    : frameworkAdapters;

  const conditions = activeAdapters.flatMap(({ framework, variant }) =>
    activeScenarios.map((scenario) => ({ framework, variant, scenario })),
  );

  const correctnessResults = [];
  for (const condition of conditions) {
    await verifier.load();
    correctnessResults.push(
      await verifier.page.evaluate(
        (input) => window.__nestedUiBenchmark.verifyCondition(input),
        { ...condition, options: benchmarkOptions },
      ),
    );
  }
  const correctness = {
    browser: await browser.version(),
    passed: correctnessResults.every((result) => result.passed),
    results: correctnessResults,
  };
  await browser.close();
  browser = undefined;
  console.log(
    `Correctness pass ${correctness.passed ? "passed" : "FAILED"}: ${conditions.length} conditions, DOM checked after every apply().`,
  );
  for (const result of correctnessResults.filter((entry) => !entry.passed)) {
    const step = result.steps.find(
      (entry) => !entry.labelsMatch || !entry.structureMatches,
    );
    console.error(
      `  ${conditionLabel(result)} step ${step.step}: ${JSON.stringify(step.firstMismatch)}`,
    );
  }

  const shouldMeasure = correctness.passed && !verifyOnly;
  let page;
  let loadBenchmarkPage;
  let cdp;
  let browserCdp;
  let pageEnvironment;
  let browserVersion;
  let traceWindowMarks;
  if (shouldMeasure) {
    browser = await puppeteer.launch(launchOptions);
    browserVersion = await browser.version();
    ({ page, load: loadBenchmarkPage } = await openBenchmarkPage(browser));
    ({ pageEnvironment, traceWindowMarks } = await page.evaluate(() => ({
      pageEnvironment: window.__nestedUiBenchmark.environment,
      traceWindowMarks: window.__nestedUiBenchmark.traceWindowMarks,
    })));
    cdp = await page.target().createCDPSession();
    browserCdp = await browser.target().createCDPSession();
    await cdp.send("Performance.enable");
  }

  // Two passes per condition: untraced for update latencies, then traced for CDP, trace, and heap metrics.
  const measureCondition = async (condition, run, position) => {
    // Reload per condition so heap and JIT state do not carry over between conditions or runs.
    await loadBenchmarkPage();
    const payload = { ...condition, options: benchmarkOptions, suiteRuns: 1 };

    const primaryBenchmark = await page.evaluate(
      (input) =>
        window.__nestedUiBenchmark.runCondition({
          ...input,
          captureMetrics: false,
        }),
      payload,
    );

    // Fresh page so the traced pass starts from the same state as the primary pass.
    await loadBenchmarkPage();

    // Pause after warm-up so condition metrics exclude those operations.
    const conditionBenchmark = page.evaluate(
      (input) =>
        window.__nestedUiBenchmark.runCondition({
          ...input,
          captureMetrics: true,
          pauseAtMeasurementBoundaries: true,
        }),
      payload,
    );

    await page.evaluate(() =>
      window.__nestedUiBenchmark.waitForBoundary("after-warmup"),
    );

    // GC outside the timed window so heap snapshots reflect retained memory only.
    await cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = await cdp.send("Performance.getMetrics");

    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      traceConfig: {
        includedCategories: traceCategories,
        excludedCategories: [],
      },
    });

    const beforeMetrics = await cdp.send("Performance.getMetrics");
    const beforeProcessInfo = await browserCdp.send(
      "SystemInfo.getProcessInfo",
    );
    const wallStart = performance.now();
    // One awaited call instead of polling, so the harness adds no work inside the window.
    await page.evaluate(async () => {
      const api = window.__nestedUiBenchmark;
      const reached = api.waitForBoundary("after-measured");
      api.resumeAtMeasurementBoundary();
      await reached;
    });

    const wallEnd = performance.now();
    const afterMetrics = await cdp.send("Performance.getMetrics");
    const afterProcessInfo = await browserCdp.send("SystemInfo.getProcessInfo");
    const trace = await stopTracing(cdp);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = await cdp.send("Performance.getMetrics");
    await page.evaluate(() =>
      window.__nestedUiBenchmark.resumeAtMeasurementBoundary(),
    );
    const tracedBenchmark = await conditionBenchmark;
    const traceBytes = trace.bytes;

    const deltaMs = (name) =>
      Math.max(
        0,
        (metricValue(afterMetrics.metrics, name) -
          metricValue(beforeMetrics.metrics, name)) *
          1000,
      );
    const toMb = (metrics, name) =>
      metricValue(metrics.metrics, name) / (1024 * 1024);
    const taskDurationMs = deltaMs("TaskDuration");
    const jsHeapUsedMb = toMb(heapAfter, "JSHeapUsedSize");
    const { measurements: rawMeasurements, ...aggregate } =
      primaryBenchmark.aggregate;
    const { measurements: capturedRawMeasurements, ...capturedAggregate } =
      tracedBenchmark.aggregate;

    if (saveTraces) {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(
        path.join(
          outputDir,
          `${conditionLabel(condition)}-run${run}.trace.json.gz`,
        ),
        gzipSync(traceBytes),
      );
    }

    return {
      ...condition,
      run,
      positionInRun: position + 1,
      domMatchesModel:
        aggregate.domMatchesModel && capturedAggregate.domMatchesModel,
      aggregate,
      operationKinds: summarizeByOperationKind(rawMeasurements),
      atOrBelowTimerResolutionCount: rawMeasurements.filter(
        (measurement) =>
          measurement.phase === "measured" &&
          measurement.updateLatencyMs <= pageEnvironment.timerResolutionMs,
      ).length,
      rawMeasurements,
      capturedAggregate,
      capturedRawMeasurements,
      cdpMetrics: {
        taskDurationMs,
        tracedApplyTotalMs: capturedAggregate.totalMs,
        wallDurationMs: wallEnd - wallStart,
        jsHeapUsedMb,
        jsHeapTotalMb: toMb(heapAfter, "JSHeapTotalSize"),
        jsHeapUsedDeltaMb: jsHeapUsedMb - toMb(heapBefore, "JSHeapUsedSize"),
      },
      cpuMetrics: summarizeProcessCpuTime(
        beforeProcessInfo.processInfo,
        afterProcessInfo.processInfo,
      ),
      traceMetrics: {
        dataLossOccurred: trace.dataLossOccurred,
        ...summarizeTrace(
          JSON.parse(traceBytes.toString("utf-8")),
          traceWindowMarks,
        ),
      },
    };
  };

  const runRecords = [];
  const conditionOrders = [];
  const executionLog = [];
  let failure;

  // Interleave runs so slow drift (e.g. CPU thermal state) is spread over all conditions.
  try {
    for (let run = 1; shouldMeasure && run <= suiteRuns; run += 1) {
      const order = shuffleOrder
        ? shuffled(conditions, orderSeed + run)
        : conditions;
      conditionOrders.push(order.map(conditionLabel));

      for (const [position, condition] of order.entries()) {
        console.log(
          `Run ${run}/${suiteRuns} [${position + 1}/${order.length}] ${conditionLabel(condition)}`,
        );
        executionLog.push({
          run,
          positionInRun: position + 1,
          condition: conditionLabel(condition),
          startedAt: new Date().toISOString(),
        });
        const record = await measureCondition(condition, run, position);
        if (!record.domMatchesModel) {
          console.warn(
            `  DOM mismatch after the measured operations of ${conditionLabel(condition)} run ${run}.`,
          );
        }
        if (!record.traceMetrics.valid) {
          console.warn(
            `  Trace window markers missing for ${conditionLabel(condition)} run ${run}.`,
          );
        }
        runRecords.push(record);
      }
    }
  } catch (error) {
    // Keep finished conditions so a late failure does not discard the whole session.
    failure = error;
  }
  classifyProcessLifecycles(runRecords.map((record) => record.cpuMetrics));

  const records = conditions
    .map((condition) =>
      summarizeCondition(
        condition,
        runRecords.filter(
          (entry) => conditionLabel(entry) === conditionLabel(condition),
        ),
      ),
    )
    .filter(Boolean);

  const report = {
    protocolVersion: 3,
    generatedAt: new Date().toISOString(),
    ...(failure && { incomplete: true, error: failure.message }),
    sourceUrl: url,
    buildMode,
    configuration: {
      source,
      tools,
      configFiles,
      servedFiles,
      scenarios: scenarioDefinitions,
      chrome: {
        headless: true,
        executable: chromeExecutablePath
          ? "system or configured Chrome"
          : "Puppeteer-bundled Chrome",
        args: chromeArgs,
      },
      environment: {
        ...pageEnvironment,
        ...hostEnvironment,
        browser: browserVersion ?? correctness.browser,
      },
      suiteRuns,
      conditionOrder: {
        shuffled: shuffleOrder,
        seed: orderSeed,
        perRun: conditionOrders,
      },
      executionLog,
      operationsPerCondition: {
        warmup: warmupIterations,
        measured: iterations,
        total: warmupIterations + iterations,
      },
      traceWindowMarks: traceWindowMarks ?? null,
      traceCategories,
    },
    correctness,
    notes: {
      suiteRuns:
        "Repeated measurements within one browser session: one browser launch for all runs, a fresh page load per condition and another before the traced pass. Runs share the browser, GPU, and usually the renderer process; they are not independent fresh-process replications. Runs are interleaved (run 1 of all conditions, then run 2, ...); unless --shuffle=false the order within each run is a seeded shuffle (seed + run). conditionOrder.perRun is the planned order; executionLog is the order actually executed. summaryAcrossRuns describes per-run values (n, nearest-rank median/q1/q3, min, max); missing values are dropped and counted by n.",
      passes:
        "aggregate/rawMeasurements are the primary pass: untraced, 30 operations back-to-back, no yielding between measured operations. capturedAggregate/capturedRawMeasurements are the traced pass: a separate page load, the same 30 operations, one requestAnimationFrame wait after each measured operation, tracing and CDP sampling active. Captured latencies include tracing overhead and are not primary results.",
      correctness:
        "correctness is a separate pass in its own browser launch with the same served bundle and Chrome flags, before any measurement. For every condition it mounts the initial tree in a bench-host and, after each apply() returns and before yielding, compares every rendered label and the tree-node level sequence with an oracle that does not use the adapters' update helpers. MutationObserver records give the pills mutated per operation. Measurements are skipped if any condition fails.",
      domCheck:
        "domMatchesModel repeats a final-state label check on each measured pass, after all latency, CPU, trace-window, and heap endpoints of that pass.",
      source:
        "source.gitCommit is HEAD at start. statusEntries are git status --porcelain lines; trackedDiffSha256 hashes git diff HEAD, saved as source.patch next to the report; untrackedFiles lists untracked files with SHA-256, copied to source-untracked/. servedFiles hashes the index.html and asset bytes served by the preview server; pageScriptsHashed confirms that the page's scripts are among them.",
      control:
        "The Control adapter mounts the same markup as the framework adapters with plain DOM (renderStaticNode of the initial tree) and its apply() ignores the operation. It receives the identical schedule, so its DOM must keep showing the initial tree after every step (checked in the correctness pass). It retains the harness (scheduling, measurement records, frame waits, tracing, CDP sampling) and omits model updates, DOM mutation, and the rendering work DOM changes cause.",
      timerResolution:
        "environment.timerResolutionMs is the smallest non-zero performance.now() step observed in the page. Latencies at or below it (atOrBelowTimerResolutionCount) are below the effective timer resolution, not literally zero; exact zeros are kept.",
      taskDuration:
        "taskDurationMs is the CDP Performance.getMetrics TaskDuration delta (seconds to ms) between Node-side samples taken just before resuming the measured operations and just after they finish. tracedApplyTotalMs is the sum of the 25 captured apply() latencies. The two cover different windows and kinds of time, so their difference does not isolate work outside apply() and is not reported.",
      cpu: "Process set: every process SystemInfo.getProcessInfo reports for the dedicated browser instance at a sample. cpuMetrics.endpoints are the raw readings (cumulative cpuTime, seconds) at both samples. bothEndpointsCpuTimeMs sums cpuTime deltas of processes present at both samples: exact for those processes and a lower bound for the browser's CPU in the window, assuming a process id is not reused within the window. Processes that start and exit between the samples are never observed. observedProcessesUpperEstimateMs adds the full cumulative readings of end-only processes; it covers observed processes only, is not an upper bound on all browser CPU, and is null when a start-only process exists. lifecycle uses the session's other samples: missing-from-start-sample (seen earlier), first-observed-at-end-sample (never seen before), missing-from-end-sample (seen later), not-observed-again. GPU-process CPU is CPU time of Chrome's GPU process, not GPU hardware execution time.",
      trace:
        'Tracing is started and ended with CDP Tracing.start/Tracing.end on the page-target session that also samples Performance metrics (categories in configuration.traceCategories, stream transfer), so Tracing.tracingComplete.dataLossOccurred is recorded per run ("unknown" if the event lacks the field). The window is the two performance.mark events in configuration.traceWindowMarks (trace clock, µs): the start mark is emitted just before the first measured operation, the end mark after the frame that follows the last one; it is not identical to the TaskDuration or CPU windows. The renderer is the process and thread that emitted the start marker (rendererMainThreadName). Complete events (ph X) whose names are in eventNames are clipped to the window; boundary-crossing events are counted in clippedEvents and non-complete tracked events (not used) in nonCompleteTrackedEvents. inclusiveMsByScope: inclusive clipped durations per name for rendererMain, rendererOther (other renderer threads), and otherProcesses. rendererMainRenderingUnionMs and rendererMainGcUnionMs: lengths of interval unions on the renderer main thread for the rendering names and the GC names respectively (nesting counted once; the rendering union can contain GC that ran inside a rendering event). rendererMainRenderingOrGcUnionMs: union of both sets. Units: ms. valid is false when the markers are missing or duplicated.',
      memory:
        "jsHeapUsedMb and jsHeapTotalMb are CDP Performance.getMetrics snapshots taken after a forced garbage collection (HeapProfiler.collectGarbage) at the end of the measured operations, while the tree is still mounted. jsHeapUsedDeltaMb is the post-GC used-heap change from after warm-up to after the measured operations.",
    },
    droppedMetrics: {
      scriptDurationMs:
        "Dropped in protocol 2. The CDP ScriptDuration delta was 0.2-2.5 ms in conditions whose traced apply() total was up to about 650 ms (2026-10-11 report), so it did not capture the timed work.",
      nonApplyTaskDurationMs:
        "Dropped in protocol 3. TaskDuration minus summed captured apply() latency subtracts measurements over different windows and kinds of time, so it cannot isolate work outside apply(). Both inputs remain (taskDurationMs, tracedApplyTotalMs).",
    },
    records,
  };

  await fs.mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "chrome-metrics-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  if (trackedDiff?.length) {
    await fs.writeFile(path.join(outputDir, "source.patch"), trackedDiff);
  }
  for (const { file } of source.untrackedFiles) {
    const copy = path.join(outputDir, "source-untracked", file);
    await fs.mkdir(path.dirname(copy), { recursive: true });
    await fs.copyFile(file, copy);
  }
  console.log(`Saved ${failure ? "partial " : ""}report: ${reportPath}`);

  if (!correctness.passed) {
    throw new Error(
      "Correctness pass failed; no measurements were taken. See report.correctness.",
    );
  }
  if (failure) {
    throw failure;
  }
} finally {
  await browser?.close();
  stopChildProcess(localServerProcess);
}
