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

function metricValue(metrics, name) {
  return metrics.find((entry) => entry.name === name)?.value ?? 0;
}

function summarizeTrace(tracePayload) {
  const events = Array.isArray(tracePayload?.traceEvents)
    ? tracePayload.traceEvents
    : [];

  let scriptingMs = 0;
  let renderingMs = 0;
  let paintingMs = 0;

  const scriptingNames = new Set([
    "EvaluateScript",
    "FunctionCall",
    "RunMicrotasks",
    "V8.Execute",
    "v8.execute",
  ]);

  const renderingNames = new Set([
    "Layout",
    "RecalculateStyles",
    "UpdateLayoutTree",
    "UpdateLayerTree",
    "CompositeLayers",
    "Commit",
  ]);

  const paintingNames = new Set(["Paint", "RasterTask"]);

  for (const event of events) {
    if (event?.ph !== "X" || typeof event?.dur !== "number") {
      continue;
    }

    const durationMs = event.dur / 1000;

    if (scriptingNames.has(event.name)) {
      scriptingMs += durationMs;
      continue;
    }

    if (renderingNames.has(event.name)) {
      renderingMs += durationMs;
      continue;
    }

    if (paintingNames.has(event.name)) {
      paintingMs += durationMs;
    }
  }

  return {
    scriptingMs,
    renderingMs,
    paintingMs,
    combinedRenderingMs: renderingMs + paintingMs,
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
const suiteRuns = readNumberArg("suiteRuns", 5);
const depth = readNumberArg("depth", 5);
const breadth = readNumberArg("breadth", 3);
const warmupIterations = readNumberArg("warmup", 60);
const iterations = readNumberArg("iterations", 240);
const saveTraces = readBoolArg("saveTraces", false);
const autoStartServer = readBoolArg("autoStartServer", true);

const benchmarkOptions = {
  depth,
  breadth,
  warmupIterations,
  iterations,
};

const frameworks = ["React", "Solid"];
const variants = ["baseline", "optimized"];

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

const browser = await puppeteer.launch({
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});

try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => Boolean(window.__nestedUiBenchmark));

  const scenarios = await page.evaluate(
    () => window.__nestedUiBenchmark?.scenarios ?? [],
  );

  const cdp = await page.target().createCDPSession();
  await cdp.send("Performance.enable");

  const records = [];

  for (const framework of frameworks) {
    for (const variant of variants) {
      for (const scenario of scenarios) {
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

        // 2) Run the benchmark with capture + tracing to collect CPU/render/memory.
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
        const wallStart = performance.now();

        const captureBenchmark = await page.evaluate(
          async (payload) => {
            const api = window.__nestedUiBenchmark;
            if (!api) {
              throw new Error("Automation API was not found in page context.");
            }

            return api.runCondition({ ...payload, captureMetrics: true });
          },
          {
            framework,
            variant,
            scenario,
            options: benchmarkOptions,
            suiteRuns,
          },
        );

        const wallEnd = performance.now();

        const afterMetrics = await cdp.send("Performance.getMetrics");
        const traceBuffer = await page.tracing.stop();
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

        // Approximate CPU usage as total main-thread CPU task time over wall time.
        // Values can exceed 100 due to tracing/CDP overhead and scheduling effects.
        const cpuUsagePercent = (taskDurationMs / wallDurationMs) * 100;

        // Use primaryBenchmark.aggregate for unbiased primary metrics,
        // and augment with trace/CDP-derived secondary metrics from the
        // captureBenchmark + trace summary.
        const appAggregate = {
          ...primaryBenchmark.aggregate,
          cpuUsagePercent,
          renderingTimeMs: traceSummary.combinedRenderingMs,
          memoryUsageMb: jsHeapUsedMb,
        };

        const appRuns = primaryBenchmark.runs.map((run, idx) => ({
          ...run,
          // Use per-run memory when available from the capture pass; fall back to CDP value.
          cpuUsagePercent,
          renderingTimeMs: traceSummary.combinedRenderingMs,
          memoryUsageMb:
            captureBenchmark.runs[idx] &&
            typeof captureBenchmark.runs[idx].memoryUsageMb === "number"
              ? captureBenchmark.runs[idx].memoryUsageMb
              : jsHeapUsedMb,
        }));

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
          appAggregate,
          appRuns,
          cdp: {
            taskDurationMs,
            scriptDurationMs,
            wallDurationMs,
            cpuUsagePercent,
            jsHeapUsedMb,
            jsHeapTotalMb,
          },
          trace: traceSummary,
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    sourceUrl: url,
    notes: {
      cpu: "cpuUsagePercent is derived as (TaskDuration delta / wallDurationMs) * 100",
      rendering:
        "renderingTimeMs is trace-derived combined rendering + painting duration",
      memory:
        "memoryUsageMb in appAggregate is set from CDP JSHeapUsedSize after each condition",
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
