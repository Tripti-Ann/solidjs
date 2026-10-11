import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import puppeteer from "puppeteer";
import {
  describeRuns,
  shuffled,
  summarizeBrowserProcessCpuTime,
  summarizeByOperationKind,
  summarizeTrace,
} from "./report-utils.mjs";

const usage = `Usage: npm run metrics:chrome -- [--flag=value ...]

  --url=URL                    Measure a server you started yourself (default: build + preview on http://127.0.0.1:4173)
  --framework=React|Solid      Only this framework
  --variant=baseline|optimized Only this variant
  --scenario=KEY               Only this scenario
  --control=true|false         Include the Control (no-op) condition (default: true)
  --suiteRuns=N                Independent runs per condition (default: 10)
  --warmup=N                   Warm-up operations per run (default: 5)
  --iterations=N               Measured operations per run (default: 25)
  --shuffle=true|false         Seeded shuffle of condition order per run (default: true)
  --seed=N                     Shuffle seed (default: 1)
  --saveTraces[=true]          Save Chrome trace files
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
  const port = Number.parseInt(parsed.port || "80", 10);

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
      taskDurationMs: across((entry) => entry.cdpMetrics.taskDurationMs),
      nonApplyTaskDurationMs: across(
        (entry) => entry.cdpMetrics.nonApplyTaskDurationMs,
      ),
      traceRenderingAndPaintingDurationMs: across(
        (entry) => entry.traceMetrics.traceRenderingAndPaintingDurationMs,
      ),
      traceGarbageCollectionDurationMs: across(
        (entry) => entry.traceMetrics.traceGarbageCollectionDurationMs,
      ),
      browserProcessGroupCpuTimeMs: across(
        (entry) => entry.cpuMetrics.browserProcessGroupCpuTimeMs,
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

  browser = await puppeteer.launch({
    headless: true,
    executablePath: await resolveChromeExecutablePath(),
    args: [
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });

  const browserVersion = await browser.version();
  const page = await browser.newPage();
  const loadBenchmarkPage = async () => {
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => Boolean(window.__nestedUiBenchmark));
  };
  await loadBenchmarkPage();

  const { scenarios, pageAdapters, buildMode, pageEnvironment } =
    await page.evaluate(() => ({
      scenarios: window.__nestedUiBenchmark.scenarios,
      pageAdapters: window.__nestedUiBenchmark.adapters,
      buildMode: window.__nestedUiBenchmark.buildMode,
      pageEnvironment: window.__nestedUiBenchmark.environment,
    }));
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

  const cdp = await page.target().createCDPSession();
  const browserCdp = await browser.target().createCDPSession();
  await cdp.send("Performance.enable");

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

    await page.tracing.start({
      categories: [
        "devtools.timeline",
        "v8",
        "blink.user_timing",
        "disabled-by-default-devtools.timeline",
      ],
      screenshots: false,
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
    const traceBuffer = await page.tracing.stop();
    await cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = await cdp.send("Performance.getMetrics");
    await page.evaluate(() =>
      window.__nestedUiBenchmark.resumeAtMeasurementBoundary(),
    );
    const tracedBenchmark = await conditionBenchmark;
    const traceText = Buffer.from(traceBuffer).toString("utf-8");

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

    if (saveTraces) {
      await fs.mkdir(outputDir, { recursive: true });
      const tracePath = path.join(
        outputDir,
        `${conditionLabel(condition)}-run${run}.trace.json`,
      );
      await fs.writeFile(tracePath, traceText, "utf-8");
    }

    return {
      ...condition,
      run,
      positionInRun: position + 1,
      aggregate,
      operationKinds: summarizeByOperationKind(rawMeasurements),
      atOrBelowTimerResolutionCount: rawMeasurements.filter(
        (measurement) =>
          measurement.phase === "measured" &&
          measurement.updateLatencyMs <= pageEnvironment.timerResolutionMs,
      ).length,
      rawMeasurements,
      cdpMetrics: {
        taskDurationMs,
        tracedApplyTotalMs: tracedBenchmark.aggregate.totalMs,
        // Main-thread task time in the traced window not spent inside the timed apply() calls.
        nonApplyTaskDurationMs: Math.max(
          0,
          taskDurationMs - tracedBenchmark.aggregate.totalMs,
        ),
        scriptDurationMs: deltaMs("ScriptDuration"),
        wallDurationMs: Math.max(1, wallEnd - wallStart),
        jsHeapUsedMb,
        jsHeapTotalMb: toMb(heapAfter, "JSHeapTotalSize"),
        jsHeapUsedDeltaMb: jsHeapUsedMb - toMb(heapBefore, "JSHeapUsedSize"),
      },
      cpuMetrics: summarizeBrowserProcessCpuTime(
        beforeProcessInfo.processInfo,
        afterProcessInfo.processInfo,
      ),
      traceMetrics: summarizeTrace(JSON.parse(traceText)),
    };
  };

  const runRecords = [];
  const conditions = activeAdapters.flatMap(({ framework, variant }) =>
    activeScenarios.map((scenario) => ({ framework, variant, scenario })),
  );
  const conditionOrders = [];
  let failure;

  // Interleave runs so slow drift (e.g. CPU thermal state) is spread over all conditions.
  try {
    for (let run = 1; run <= suiteRuns; run += 1) {
      const order = shuffleOrder
        ? shuffled(conditions, orderSeed + run)
        : conditions;
      conditionOrders.push(order.map(conditionLabel));

      for (const [position, condition] of order.entries()) {
        console.log(
          `Run ${run}/${suiteRuns} [${position + 1}/${order.length}] ${conditionLabel(condition)}`,
        );
        runRecords.push(await measureCondition(condition, run, position));
      }
    }
  } catch (error) {
    // Keep finished conditions so a late failure does not discard the whole session.
    failure = error;
  }

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
    generatedAt: new Date().toISOString(),
    ...(failure && { incomplete: true, error: failure.message }),
    sourceUrl: url,
    buildMode,
    configuration: {
      environment: {
        ...pageEnvironment,
        ...hostEnvironment,
        browser: browserVersion,
      },
      suiteRuns,
      conditionOrder: {
        shuffled: shuffleOrder,
        seed: orderSeed,
        perRun: conditionOrders,
      },
      operationsPerCondition: {
        warmup: warmupIterations,
        measured: iterations,
        total: warmupIterations + iterations,
      },
    },
    notes: {
      suiteRuns:
        "Each suite run is an independent pass over every condition with a fresh page load per condition (and another before the traced pass). Runs are interleaved (run 1 of all conditions, then run 2, ...) and, unless --shuffle=false, the condition order within each run is a seeded shuffle. summaryAcrossRuns describes the distribution of per-run values (median, nearest-rank q1/q3, min, max); runMedianLatencyMs is the median of the per-run median update latencies, and runMedianLatencyMsByKind splits it by operation kind. records[].options is the effective tree shape and operation counts.",
      control:
        "The Control condition renders the same markup with plain DOM and ignores every update. Its metrics are the harness floor (frame production, tracing, benchmark bookkeeping); subtract it per scenario before attributing task time to a framework.",
      timerResolution:
        "environment.timerResolutionMs is the smallest non-zero performance.now() step observed in the page. Latencies at or below it (atOrBelowTimerResolutionCount) are below the effective timer resolution, not literally zero.",
      outsideApplyWindow:
        "The primary pass times apply() synchronously and back-to-back, so style, layout, paint, and deferred garbage collection fall outside its timings. The traced pass yields one frame after every measured operation and the runner awaits boundaries without polling; nonApplyTaskDurationMs is TaskDuration minus the summed apply() latencies of that traced pass, i.e. main-thread task time spent outside apply(), including the harness floor measured by the Control condition. traceGarbageCollectionDurationMs sums MinorGC and MajorGC trace events; traceMetrics.durationsByEventMs breaks the named events down.",
      taskDuration:
        "taskDurationMs is the Chrome DevTools Protocol Performance.getMetrics TaskDuration delta, converted from seconds to milliseconds. Its scope is the traced capture pass for one framework, variant, and scenario, including benchmark JavaScript and requestAnimationFrame callbacks but excluding idle wall-clock time.",
      browserProcessGroupCpuTime:
        "browserProcessGroupCpuTimeMs is the sum of Chrome DevTools Protocol SystemInfo.getProcessInfo cpuTime deltas across all processes in the dedicated Puppeteer browser instance that are present in the final snapshot. It is converted from seconds to milliseconds and measured from immediately after the warm-up operations through immediately after the measured operations. It is CPU time across all threads, not CPU utilisation percentage. completeProcessCoverage is false when a process present at the initial snapshot exited before the final snapshot; its unobservable in-window CPU time is not included.",
      traceRenderingAndPainting:
        "traceRenderingAndPaintingDurationMs is the sum of complete trace-event durations (ph = X, microseconds converted to milliseconds) for the event names in traceMetrics.eventNames during the traced capture pass. It is not a CPU utilisation metric.",
      memory:
        "jsHeapUsedMb and jsHeapTotalMb are CDP Performance.getMetrics snapshots taken after a forced garbage collection (HeapProfiler.collectGarbage) at the end of the measured operations, while the tree is still mounted. jsHeapUsedDeltaMb is the post-GC used-heap change from after warm-up to after the measured operations. The page is reloaded before every condition and run.",
    },
    records,
  };

  if (records.length > 0) {
    const reportPath = path.join(outputDir, "chrome-metrics-report.json");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

    console.log(
      `Saved ${failure ? "partial " : ""}metrics report: ${reportPath}`,
    );
    if (saveTraces) {
      console.log(`Saved traces in: ${outputDir}`);
    }
  }

  if (failure) {
    throw failure;
  }
} finally {
  await browser?.close();
  stopChildProcess(localServerProcess);
}
