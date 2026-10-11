import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  bootstrapMedianCi,
  describeRuns,
  summarizeByOperationKind,
} from "./report-utils.mjs";

const resultsRoot = path.join(process.cwd(), "bench", "results");
const reportFileName = "chrome-metrics-report.json";
// Above this share of latencies at the timer floor, medians are quantised to ticks and CIs are meaningless.
const timerLimitedShare = 0.1;

async function resolveReportPath(input) {
  if (input) {
    const stat = await fs.stat(input);
    return stat.isDirectory() ? path.join(input, reportFileName) : input;
  }

  const folders = (await fs.readdir(resultsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "archived")
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const folder of folders) {
    const candidate = path.join(resultsRoot, folder, reportFileName);
    if (
      await fs.access(candidate).then(
        () => true,
        () => false,
      )
    ) {
      return candidate;
    }
  }
  throw new Error(
    `No ${reportFileName} found under ${resultsRoot}. Run npm run metrics:chrome first.`,
  );
}

const reportPath = await resolveReportPath(process.argv[2]);
const report = JSON.parse(await fs.readFile(reportPath, "utf-8"));
const medianOf = (record, metric) => record.summaryAcrossRuns[metric].median;
const controlByScenario = new Map(
  report.records
    .filter((record) => record.framework === "Control")
    .map((record) => [record.scenario, record]),
);

const rows = report.records.map((record) => {
  const { runs } = record;
  const { depth, breadth, iterations } = runs[0].aggregate.options;
  const runMedians = runs.map((run) => run.aggregate.medianMs);
  const spread = describeRuns(runMedians);
  const ci = bootstrapMedianCi(runMedians);
  const control = controlByScenario.get(record.scenario);
  const nonApply = medianOf(record, "nonApplyTaskDurationMs");
  const belowTimerResolution = runs.reduce(
    (sum, run) => sum + run.atOrBelowTimerResolutionCount,
    0,
  );
  const measuredOperations = runs.length * iterations;

  return {
    scenario: record.scenario,
    framework: record.framework,
    variant: record.variant,
    shape: `${depth}x${breadth}`,
    runs: runs.length,
    medianLatencyMs: spread.median,
    ciLowMs: ci.low,
    ciHighMs: ci.high,
    runMedianQ1Ms: spread.q1,
    runMedianQ3Ms: spread.q3,
    p95Ms: medianOf(record, "runP95LatencyMs"),
    taskDurationMs: medianOf(record, "taskDurationMs"),
    nonApplyTaskDurationMs: nonApply,
    nonApplyAboveControlMs:
      control && control !== record
        ? nonApply - medianOf(control, "nonApplyTaskDurationMs")
        : null,
    renderingAndPaintingMs: medianOf(
      record,
      "traceRenderingAndPaintingDurationMs",
    ),
    garbageCollectionMs: medianOf(record, "traceGarbageCollectionDurationMs"),
    cpuTimeMs: medianOf(record, "browserProcessGroupCpuTimeMs"),
    jsHeapUsedMb: medianOf(record, "jsHeapUsedMb"),
    belowTimerResolution,
    measuredOperations,
    timerLimited: belowTimerResolution / measuredOperations > timerLimitedShare,
  };
});

// Mixed scenarios only: one summary hides cheap point updates and costly subtree updates.
const kindRows = report.records.flatMap((record) => {
  const perRun = record.runs.map((run) =>
    summarizeByOperationKind(run.rawMeasurements),
  );
  const kinds = Object.keys(perRun[0]);
  return kinds.length < 2
    ? []
    : kinds.map((kind) => ({
        scenario: record.scenario,
        framework: record.framework,
        variant: record.variant,
        kind,
        operationsPerRun: perRun[0][kind].count,
        medianLatencyMs: describeRuns(perRun.map((run) => run[kind].medianMs))
          .median,
      }));
});

const fixed = (value, digits) =>
  value === null || value === undefined ? "–" : value.toFixed(digits);

function markdownTable(headers, lines) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...lines.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

function csv(records) {
  const headers = Object.keys(records[0]);
  return [
    headers.join(","),
    ...records.map((record) =>
      headers.map((header) => record[header] ?? "").join(","),
    ),
  ].join("\n");
}

const environment = report.configuration.environment;
const markdown = [
  "# Benchmark summary",
  "",
  ...(report.incomplete
    ? [
        `**Incomplete run:** stopped early (${report.error}); only finished conditions are included.`,
        "",
      ]
    : []),
  `Source: ${path.relative(process.cwd(), reportPath)} (generated ${report.generatedAt}, ${report.buildMode} build, ${environment.browser}, ${environment.cpu}).`,
  `${report.configuration.suiteRuns} independent runs per condition; ${report.configuration.operationsPerCondition.measured} measured operations per run; timer resolution ${fixed(environment.timerResolutionMs * 1000, 1)} µs.`,
  "",
  'Latency is the median of the per-run median update latencies; the 95% CI is a percentile bootstrap of that median (2000 resamples). Other columns are medians across runs. "Above control" is the difference of medians against the Control condition of the same scenario. CPU is browser process-group CPU time across all threads.',
  "",
  markdownTable(
    [
      "Scenario",
      "Framework",
      "Variant",
      "Shape",
      "Latency ms",
      "95% CI ms",
      "Run IQR ms",
      "p95 ms",
      "Task ms",
      "Outside apply ms",
      "Above control ms",
      "Render ms",
      "GC ms",
      "CPU ms",
      "Heap MB",
      "≤ timer res.",
    ],
    rows.map((row) => [
      row.scenario,
      row.framework,
      row.variant,
      row.shape,
      `${fixed(row.medianLatencyMs, 3)}${row.timerLimited ? "†" : ""}`,
      row.timerLimited
        ? "n/a†"
        : `${fixed(row.ciLowMs, 3)}–${fixed(row.ciHighMs, 3)}`,
      `${fixed(row.runMedianQ1Ms, 3)}–${fixed(row.runMedianQ3Ms, 3)}`,
      fixed(row.p95Ms, 3),
      fixed(row.taskDurationMs, 1),
      fixed(row.nonApplyTaskDurationMs, 1),
      fixed(row.nonApplyAboveControlMs, 1),
      fixed(row.renderingAndPaintingMs, 1),
      fixed(row.garbageCollectionMs, 1),
      fixed(row.cpuTimeMs, 1),
      fixed(row.jsHeapUsedMb, 2),
      `${row.belowTimerResolution}/${row.measuredOperations}`,
    ]),
  ),
  "",
  `† More than ${timerLimitedShare * 100}% of measured latencies are at or below the timer resolution, so the latency is quantised to timer ticks and no meaningful CI exists. Compare these conditions using task and outside-apply time instead.`,
  ...(kindRows.length > 0
    ? [
        "",
        "## Latency by operation kind",
        "",
        markdownTable(
          ["Scenario", "Framework", "Variant", "Kind", "Ops/run", "Latency ms"],
          kindRows.map((row) => [
            row.scenario,
            row.framework,
            row.variant,
            row.kind,
            row.operationsPerRun,
            fixed(row.medianLatencyMs, 3),
          ]),
        ),
      ]
    : []),
  "",
].join("\n");

const outputDir = path.dirname(reportPath);
await fs.writeFile(path.join(outputDir, "summary.csv"), csv(rows), "utf-8");
await fs.writeFile(path.join(outputDir, "summary.md"), markdown, "utf-8");
// Some Windows consoles garble non-ASCII; the written files stay UTF-8.
console.log(
  markdown
    .replaceAll("µ", "u")
    .replaceAll("–", "-")
    .replaceAll("≤", "<=")
    .replaceAll("†", "*"),
);
console.log(`Saved summary.csv and summary.md in ${outputDir}`);
