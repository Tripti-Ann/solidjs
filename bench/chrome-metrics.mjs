import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import puppeteer from "puppeteer";

const args = new Map(
  process.argv.slice(2).map((entry) => {
    const [key, ...rest] = entry.split("=");
    return [key, rest.join("=")];
  }),
);

function readNumberArg(key, fallback) {
  const raw = args.get(`--${key}`);
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for --${key}: ${raw}`);
  }

  return value;
}

function readBoolArg(key, fallback = false) {
  const raw = args.get(`--${key}`);
  if (!raw) {
    return fallback;
  }

  return raw === "true" || raw === "1";
}

function readChoiceArg(key, choices) {
  const value = args.get(`--${key}`);
  if (!value) {
    return choices;
  }

  if (!choices.includes(value)) {
    throw new Error(`Invalid value for --${key}: ${value}`);
  }

  return [value];
}

function metricValue(metrics, name) {
  return metrics.find((entry) => entry.name === name)?.value ?? 0;
}

function processSnapshotKey(processInfo) {
  return `${processInfo.type}:${processInfo.id}`;
}

function summarizeBrowserProcessCpuTime(beforeProcessInfo, afterProcessInfo) {
  const beforeProcessInfoByKey = new Map(
    beforeProcessInfo.map((processInfo) => [
      processSnapshotKey(processInfo),
      processInfo,
    ]),
  );
  const afterProcessKeys = new Set(afterProcessInfo.map(processSnapshotKey));
  const includedProcesses = afterProcessInfo.map((processInfo) => {
    const beforeProcessInfo = beforeProcessInfoByKey.get(
      processSnapshotKey(processInfo),
    );

    return {
      id: processInfo.id,
      type: processInfo.type,
      snapshotMembership: beforeProcessInfo ? "both" : "after-only",
      cpuTimeDeltaMs: Math.max(
        0,
        (processInfo.cpuTime - (beforeProcessInfo?.cpuTime ?? 0)) * 1000,
      ),
    };
  });
  const exitedProcesses = beforeProcessInfo
    .filter(
      (processInfo) => !afterProcessKeys.has(processSnapshotKey(processInfo)),
    )
    .map((processInfo) => ({
      id: processInfo.id,
      type: processInfo.type,
      cpuTimeAtInitialSnapshotMs: processInfo.cpuTime * 1000,
    }));

  return {
    browserProcessGroupCpuTimeMs: includedProcesses.reduce(
      (total, processInfo) => total + processInfo.cpuTimeDeltaMs,
      0,
    ),
    processCount: includedProcesses.length,
    includedProcesses,
    exitedProcesses,
    completeProcessCoverage: exitedProcesses.length === 0,
  };
}

function summarizeTrace(tracePayload) {
  const events = Array.isArray(tracePayload?.traceEvents)
    ? tracePayload.traceEvents
    : [];

  const renderingAndPaintingEventNames = new Set([
    "Layout",
    "RecalculateStyles",
    "UpdateLayoutTree",
    "UpdateLayerTree",
    "CompositeLayers",
    "Commit",
    "Paint",
    "RasterTask",
  ]);
  let traceRenderingAndPaintingDurationMs = 0;

  for (const event of events) {
    if (event?.ph !== "X" || typeof event?.dur !== "number") {
      continue;
    }

    const durationMs = event.dur / 1000;

    if (renderingAndPaintingEventNames.has(event.name)) {
      traceRenderingAndPaintingDurationMs += durationMs;
    }
  }

  return {
    eventNames: [...renderingAndPaintingEventNames],
    traceRenderingAndPaintingDurationMs,
  };
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
    args.get("--chromeExecutablePath") ?? process.env.CHROME_EXECUTABLE_PATH;
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

const url = args.get("--url") ?? "http://127.0.0.1:5173";
const suiteRuns = readNumberArg("suiteRuns", 1);
const depth = readNumberArg("depth", 5);
const breadth = readNumberArg("breadth", 3);
const warmupIterations = readNumberArg("warmup", 5);
const iterations = readNumberArg("iterations", 25);
const saveTraces = readBoolArg("saveTraces", false);
const autoStartServer = readBoolArg("autoStartServer", true);

const benchmarkOptions = {
  depth,
  breadth,
  warmupIterations,
  iterations,
};

const frameworks = readChoiceArg("framework", ["React", "Solid"]);
const variants = readChoiceArg("variant", ["baseline", "optimized"]);
const scenarioFilter = args.get("--scenario");
const experimentEnvironment = {
  os: "Microsoft Windows 11 Pro",
  osVersionBuild: "10.0.26200 / build 26200",
  cpu: "AMD Ryzen 5 5625U with Radeon Graphics",
  logicalProcessors: 12,
  ramGiB: 16,
  react: "19.2.5",
  reactDom: "19.2.5",
  solidJs: "1.9.12",
  reactCompiler: "disabled",
};

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "bench", "results", runId);

await fs.mkdir(outputDir, { recursive: true });

let localServerProcess = null;
const { host: urlHost, port: urlPort } = parseUrlParts(url);

if (!(await isUrlReachable(url))) {
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
  localServerProcess = spawn(
    process.execPath,
    [viteBin, "--host", urlHost, "--port", String(urlPort)],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      windowsHide: true,
    },
  );

  const ready = await waitForUrl(url, 45000);
  if (!ready) {
    stopChildProcess(localServerProcess);
    throw new Error(
      `Auto-started dev server did not become ready at ${url} within timeout.`,
    );
  }
}

const chromeExecutablePath = await resolveChromeExecutablePath();
const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromeExecutablePath,
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

try {
  const browserVersion = await browser.version();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => Boolean(window.__nestedUiBenchmark));

  const scenarios = await page.evaluate(
    () => window.__nestedUiBenchmark?.scenarios ?? [],
  );
  const activeScenarios = scenarioFilter
    ? scenarios.filter((scenario) => scenario === scenarioFilter)
    : scenarios;

  if (activeScenarios.length === 0) {
    throw new Error(`Invalid value for --scenario: ${scenarioFilter}`);
  }

  const cdp = await page.target().createCDPSession();
  const browserCdp = await browser.target().createCDPSession();
  await cdp.send("Performance.enable");

  const records = [];

  for (const framework of frameworks) {
    for (const variant of variants) {
      for (const scenario of activeScenarios) {
        const label = `${framework}-${variant}-${scenario}`;

        // Two-pass approach:
        // 1) Run the benchmark without capture to collect unbiased primary timings.
        const primaryBenchmark = await page.evaluate(
          async (payload) => {
            const api = window.__nestedUiBenchmark;
            if (!api) {
              throw new Error("Automation API was not found in page context.");
            }

            return api.runCondition({ ...payload, captureMetrics: false });
          },
          {
            framework,
            variant,
            scenario,
            options: benchmarkOptions,
            suiteRuns,
          },
        );

        // 2) Pause after warm-up so condition metrics exclude those operations.
        const conditionBenchmark = page.evaluate(
          async (payload) => {
            const api = window.__nestedUiBenchmark;
            if (!api) {
              throw new Error("Automation API was not found in page context.");
            }

            return api.runCondition({
              ...payload,
              captureMetrics: true,
              pauseAtMeasurementBoundaries: true,
            });
          },
          {
            framework,
            variant,
            scenario,
            options: benchmarkOptions,
            suiteRuns,
          },
        );

        await page.waitForFunction(
          () => window.__nestedUiBenchmark?.boundaryPhase === "after-warmup",
        );

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
        await page.evaluate(() =>
          window.__nestedUiBenchmark?.resumeAtMeasurementBoundary(),
        );

        await page.waitForFunction(
          () => window.__nestedUiBenchmark?.boundaryPhase === "after-measured",
        );

        const wallEnd = performance.now();
        const afterMetrics = await cdp.send("Performance.getMetrics");
        const afterProcessInfo = await browserCdp.send(
          "SystemInfo.getProcessInfo",
        );
        const traceBuffer = await page.tracing.stop();
        await page.evaluate(() =>
          window.__nestedUiBenchmark?.resumeAtMeasurementBoundary(),
        );
        await conditionBenchmark;
        const traceText = Buffer.from(traceBuffer).toString("utf-8");
        const tracePayload = JSON.parse(traceText);

        const beforeTaskDuration = metricValue(
          beforeMetrics.metrics,
          "TaskDuration",
        );
        const afterTaskDuration = metricValue(
          afterMetrics.metrics,
          "TaskDuration",
        );

        const beforeScriptDuration = metricValue(
          beforeMetrics.metrics,
          "ScriptDuration",
        );
        const afterScriptDuration = metricValue(
          afterMetrics.metrics,
          "ScriptDuration",
        );

        const jsHeapUsedMb =
          metricValue(afterMetrics.metrics, "JSHeapUsedSize") / (1024 * 1024);
        const jsHeapTotalMb =
          metricValue(afterMetrics.metrics, "JSHeapTotalSize") / (1024 * 1024);

        const traceSummary = summarizeTrace(tracePayload);
        const wallDurationMs = Math.max(1, wallEnd - wallStart);
        const taskDurationMs = Math.max(
          0,
          (afterTaskDuration - beforeTaskDuration) * 1000,
        );
        const scriptDurationMs = Math.max(
          0,
          (afterScriptDuration - beforeScriptDuration) * 1000,
        );
        const browserProcessCpuTime = summarizeBrowserProcessCpuTime(
          beforeProcessInfo.processInfo,
          afterProcessInfo.processInfo,
        );

        const rawMeasurements = primaryBenchmark.runs.flatMap(
          (run) => run.measurements,
        );
        const aggregates = primaryBenchmark.runs.map(
          ({ measurements, ...aggregate }) => aggregate,
        );

        if (saveTraces) {
          const tracePath = path.join(outputDir, `${label}.trace.json`);
          await fs.writeFile(tracePath, traceText, "utf-8");
        }

        records.push({
          framework,
          variant,
          scenario,
          suiteRuns,
          options: benchmarkOptions,
          aggregates,
          rawMeasurements,
          cdpMetrics: {
            taskDurationMs,
            scriptDurationMs,
            wallDurationMs,
            jsHeapUsedMb,
            jsHeapTotalMb,
          },
          cpuMetrics: browserProcessCpuTime,
          traceMetrics: traceSummary,
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourceUrl: url,
    configuration: {
      environment: {
        ...experimentEnvironment,
        browser: browserVersion,
      },
      browserVersion,
      suiteRuns,
      operationsPerCondition: {
        warmup: warmupIterations,
        measured: iterations,
        total: warmupIterations + iterations,
      },
    },
    notes: {
      taskDuration:
        "taskDurationMs is the Chrome DevTools Protocol Performance.getMetrics TaskDuration delta, converted from seconds to milliseconds. Its scope is the traced capture pass for one framework, variant, and scenario, including benchmark JavaScript and requestAnimationFrame callbacks but excluding idle wall-clock time.",
      browserProcessGroupCpuTime:
        "browserProcessGroupCpuTimeMs is the sum of Chrome DevTools Protocol SystemInfo.getProcessInfo cpuTime deltas across all processes in the dedicated Puppeteer browser instance that are present in the final snapshot. It is converted from seconds to milliseconds and measured from immediately after the five warm-up operations through immediately after the 25 measured operations. It is CPU time across all threads, not CPU utilisation percentage. completeProcessCoverage is false when a process present at the initial snapshot exited before the final snapshot; its unobservable in-window CPU time is not included.",
      traceRenderingAndPainting:
        "traceRenderingAndPaintingDurationMs is the sum of complete trace-event durations (ph = X, microseconds converted to milliseconds) for the event names in traceMetrics.eventNames during the traced capture pass. It is not a CPU utilisation metric.",
      memory:
        "jsHeapUsedMb and jsHeapTotalMb are condition-level CDP Performance.getMetrics snapshots after the traced capture pass.",
    },
    records,
  };

  const reportPath = path.join(outputDir, "chrome-metrics-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`Saved metrics report: ${reportPath}`);
  if (saveTraces) {
    console.log(`Saved traces in: ${outputDir}`);
  }
} finally {
  await browser.close();
  stopChildProcess(localServerProcess);
}
