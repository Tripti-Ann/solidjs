import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { describeRuns, summarizeByOperationKind } from "./report-utils.mjs";

const resultsRoot = path.join(process.cwd(), "bench", "results");
const reportFileName = "chrome-metrics-report.json";
// Above this share of latencies at the timer floor, medians are quantised to timer ticks.
const timerLimitedShare = 0.1;
// Descriptive flag for CPU spikes; no observation is excluded.
const cpuFlagFactor = 2;

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
const reportBytes = await fs.readFile(reportPath);
const report = JSON.parse(reportBytes.toString("utf-8"));
if ((report.protocolVersion ?? 1) < 2) {
  throw new Error(
    `${reportPath} predates protocol 2 (different CPU and trace definitions, no correctness pass); its existing summary files are left unchanged.`,
  );
}
const scenarioLabel = (key) =>
  report.configuration.scenarios?.find((scenario) => scenario.key === key)
    ?.label ?? key;
const cpuOfType = (run, type) =>
  run.cpuMetrics.bothEndpoints
    .filter((entry) => entry.type === type)
    .reduce((sum, entry) => sum + entry.cpuTimeDeltaMs, 0);

const rows = report.records.map((record) => {
  // Runs of one condition execute in run order, so this is also their execution order.
  const runs = [...record.runs].sort((a, b) => a.run - b.run);
  const { depth, breadth, iterations } = runs[0].aggregate.options;
  const describe = (select) => describeRuns(runs.map(select));
  const runMedians = describe((run) => run.aggregate.medianMs);
  const meanMs = describe((run) => run.aggregate.meanMs).median;
  const cpu = describe((run) => run.cpuMetrics.bothEndpointsCpuTimeMs);
  const measured = runs.flatMap((run) =>
    run.rawMeasurements.filter((entry) => entry.phase === "measured"),
  );
  const atOrBelowTimerResolution = runs.reduce(
    (sum, run) => sum + run.atOrBelowTimerResolutionCount,
    0,
  );
  const dataLoss = (value) =>
    runs.filter(
      (run) => (run.traceMetrics.dataLossOccurred ?? "unknown") === value,
    ).length;

  return {
    scenario: record.scenario,
    scenarioLabel: scenarioLabel(record.scenario),
    framework: record.framework,
    variant: record.variant,
    shape: `${depth}x${breadth}`,
    runs: runs.length,
    operationsPerRun: iterations,
    medianOfRunMediansMs: runMedians.median,
    runMedianQ1Ms: runMedians.q1,
    runMedianQ3Ms: runMedians.q3,
    runMedianIqrMs: runMedians.q3 - runMedians.q1,
    runMediansMs: runs.map((run) => run.aggregate.medianMs),
    withinRunMedianMs: runMedians.median,
    withinRunIqrMs: describe((run) => run.aggregate.iqrMs).median,
    withinRunMeanMs: meanMs,
    withinRunP95Ms: describe((run) => run.aggregate.p95Ms).median,
    reciprocalMeanApplyLatencyPerSecond: meanMs > 0 ? 1000 / meanMs : null,
    measuredOperations: measured.length,
    zeroLatencyCount: measured.filter((entry) => entry.updateLatencyMs === 0)
      .length,
    atOrBelowTimerResolution,
    timerFloorAffected: atOrBelowTimerResolution > 0,
    timerLimited:
      atOrBelowTimerResolution / measured.length > timerLimitedShare,
    capturedMedianOfRunMediansMs: describe(
      (run) => run.capturedAggregate.medianMs,
    ).median,
    capturedApplyTotalMs: describe((run) => run.capturedAggregate.totalMs)
      .median,
    taskDurationMs: describe((run) => run.cdpMetrics.taskDurationMs).median,
    rendererMainRenderingUnionMs: describe(
      (run) => run.traceMetrics.rendererMainRenderingUnionMs,
    ).median,
    rendererMainGcUnionMs: describe(
      (run) => run.traceMetrics.rendererMainGcUnionMs,
    ).median,
    validTraceRuns: runs.filter((run) => run.traceMetrics.valid).length,
    traceDataLossTrue: dataLoss(true),
    traceDataLossFalse: dataLoss(false),
    traceDataLossUnknown: dataLoss("unknown"),
    jsHeapUsedMiB: describe((run) => run.cdpMetrics.jsHeapUsedMb).median,
    bothEndpointsCpuTimeMs: cpu.median,
    bothEndpointsCpuTimeMaxMs: cpu.max,
    cpuFlaggedRuns: runs.filter(
      (run) => run.cpuMetrics.bothEndpointsCpuTimeMs > cpuFlagFactor * cpu.median,
    ).length,
    runCpuMs: runs.map((run) => run.cpuMetrics.bothEndpointsCpuTimeMs),
    runGpuProcessCpuMs: runs.map((run) => cpuOfType(run, "GPU")),
    runsWithProcessChanges: runs.filter(
      (run) => !run.cpuMetrics.sameProcessesAtBothEndpoints,
    ).length,
    domMismatchRuns: runs.filter((run) => run.domMatchesModel === false).length,
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
        scenarioLabel: scenarioLabel(record.scenario),
        framework: record.framework,
        variant: record.variant,
        kind,
        runs: perRun.length,
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
  if (records.length === 0) {
    return "";
  }
  const headers = Object.keys(records[0]);
  const cell = (value) =>
    Array.isArray(value) ? value.join(";") : (value ?? "");
  return [
    headers.join(","),
    ...records.map((record) =>
      headers.map((header) => cell(record[header])).join(","),
    ),
  ].join("\n");
}

const environment = report.configuration.environment;
const { source, servedFiles } = report.configuration;
const { measured } = report.configuration.operationsPerCondition;
const runCounts = [...new Set(rows.map((row) => row.runs))].join("/");
const domMismatchRuns = rows.reduce((sum, row) => sum + row.domMismatchRuns, 0);
const label = (row) => [row.scenarioLabel, row.framework, row.variant];
const floorFlag = (row) =>
  row.timerLimited ? "†" : row.timerFloorAffected ? "°" : "";
const range = (values) => `${Math.min(...values)}–${Math.max(...values)}`;
const maxRuns = Math.max(...rows.map((row) => row.runs));
const runColumns = Array.from({ length: maxRuns }, (_, index) => `Run ${index + 1}`);
const correctnessRows = report.correctness.results.map((result) => {
  const operations = result.steps.filter((step) => step.kind !== "mount");
  const total = (field) =>
    operations.reduce((sum, step) => sum + step[field], 0);
  return {
    ...result,
    scenarioLabel: scenarioLabel(result.scenario),
    operations: operations.length,
    unchangedSteps: operations
      .filter((step) => step.changedLabels === 0)
      .map((step) => step.step),
    changedLabels: range(operations.map((step) => step.changedLabels)),
    mutatedPills: range(operations.map((step) => step.mutatedPills)),
    unchangedPillsMutated: total("unchangedPillsMutated"),
    mutationsOutsidePills: total("mutationsOutsidePills"),
  };
});
const passedConditions = correctnessRows.filter((row) => row.passed).length;
const warmup = report.configuration.operationsPerCondition.warmup;
const stepList = (steps) =>
  steps.length === 0
    ? "none"
    : steps.length > 6
      ? `${steps.length} steps (all)`
      : steps.join(", ");

const markdown = [
  "# Benchmark summary",
  "",
  ...(report.incomplete
    ? [
        `**Incomplete run:** stopped early (${report.error}); only finished conditions are included.`,
        "",
      ]
    : []),
  `Source: ${path.relative(process.cwd(), reportPath)} (SHA-256 ${createHash("sha256").update(reportBytes).digest("hex")}; protocol ${report.protocolVersion}, generated ${report.generatedAt}, ${report.buildMode} build, ${environment.browser}, ${environment.cpu}).`,
  `Source revision: ${source.gitCommit ?? "not recorded"}${source.uncommittedChanges ? ` plus uncommitted changes (${source.statusEntries.length} status entries; tracked diff SHA-256 ${source.trackedDiffSha256?.slice(0, 16) ?? "none"}, saved as ${source.trackedDiffFile ?? "–"}; ${source.untrackedFiles.length} untracked files copied and hashed)` : ", clean working tree"}.`,
  `Served files: ${servedFiles.files.map((file) => `${file.path} (SHA-256 ${file.sha256.slice(0, 16)})`).join(", ")}; page scripts among them: ${servedFiles.pageScriptsHashed ? "yes" : "no"}.`,
  `Correctness pass (separate browser launch, DOM checked after every apply() before yielding): ${passedConditions}/${correctnessRows.length} conditions passed. Post-measurement final-state check: ${domMismatchRuns === 0 ? "matched in every measured pass" : `**failed in ${domMismatchRuns} run(s); those conditions are invalid (FAIRNESS_SPEC rule 7)**`}.`,
  `Design: ${runCounts} repeated runs per condition within one browser session (fresh page load per pass; repeated measurements, not independent fresh-process replications); ${warmup} warm-up and ${measured} measured operations per run; timer resolution ${fixed(environment.timerResolutionMs * 1000, 1)} µs.`,
  "",
  `Statistics: nearest-rank quantiles, index ceil(p·n) − 1 of the n sorted values. For an even n this gives the lower median (n = 10 runs: value 5; n = 6 operations: value 3). Within a run (n = ${measured}): median = value ${Math.ceil(0.5 * measured)}, Q1 = value ${Math.ceil(0.25 * measured)}, Q3 = value ${Math.ceil(0.75 * measured)}, p95 = value ${Math.ceil(0.95 * measured)}. Across runs (n = ${maxRuns}): Q1 = value ${Math.ceil(0.25 * maxRuns)}, median = value ${Math.ceil(0.5 * maxRuns)}, Q3 = value ${Math.ceil(0.75 * maxRuns)}. No confidence intervals are reported: runs are repeated measurements within one session, so the coverage of a resampling interval is not established. Reciprocal mean latency is derived from apply() latency, not measured throughput; no speedup ratios are computed.`,
  "",
  "## Primary pass: run-level update latency (main descriptive evidence)",
  "",
  `n = runs per row; each value is one run's median of ${measured} measured latencies. Exact zeros (latency below the 5 µs timer step) are kept.`,
  "",
  markdownTable(
    [
      "Scenario",
      "Framework",
      "Variant",
      "Shape",
      "n runs",
      "Median of run medians ms",
      "Run-median Q1–Q3 ms",
      "Run-median IQR ms",
      "≤ timer res. (pooled ops)",
      "Exact zeros (pooled ops)",
    ],
    rows.map((row) => [
      ...label(row),
      row.shape,
      row.runs,
      `${fixed(row.medianOfRunMediansMs, 3)}${floorFlag(row)}`,
      `${fixed(row.runMedianQ1Ms, 3)}–${fixed(row.runMedianQ3Ms, 3)}`,
      fixed(row.runMedianIqrMs, 3),
      `${row.atOrBelowTimerResolution}/${row.measuredOperations}`,
      `${row.zeroLatencyCount}/${row.measuredOperations}`,
    ]),
  ),
  "",
  "### Individual run medians (ms, in execution order)",
  "",
  markdownTable(
    ["Scenario", "Framework", "Variant", ...runColumns],
    rows.map((row) => [
      ...label(row),
      ...row.runMediansMs.map((value) => fixed(value, 3)),
    ]),
  ),
  "",
  "## Primary pass: within-run statistics",
  "",
  `Each statistic is computed within one run (n = ${measured} measured operations) and summarised by the median across runs (n = runs). 1000/mean is the reciprocal of the mean synchronous apply() latency, a derived statistic and not measured application throughput; it is empty when the mean is 0.`,
  "",
  markdownTable(
    [
      "Scenario",
      "Framework",
      "Variant",
      "n runs",
      "medianMs",
      "iqrMs",
      "meanMs",
      "p95Ms",
      "1000/mean (1/s)",
    ],
    rows.map((row) => [
      ...label(row),
      row.runs,
      `${fixed(row.withinRunMedianMs, 3)}${floorFlag(row)}`,
      fixed(row.withinRunIqrMs, 3),
      `${fixed(row.withinRunMeanMs, 3)}${floorFlag(row)}`,
      fixed(row.withinRunP95Ms, 3),
      `${fixed(row.reciprocalMeanApplyLatencyPerSecond, 0)}${floorFlag(row)}`,
    ]),
  ),
  "",
  `° At least one measured latency of the row is at or below the timer resolution. † More than ${timerLimitedShare * 100}%: values are quantised to timer ticks and must not be used for precise comparisons or ratios.`,
  "",
  "## Captured (traced) pass: supporting metrics",
  "",
  "Medians across runs; n = runs, except rendering/GC where n = runs with valid trace markers. A separate page load with tracing and CDP sampling and one frame wait after each measured operation; captured latency includes tracing overhead. Task ms (CDP TaskDuration between two Node-side samples) and captured apply total (sum of the 25 captured apply() latencies) are separate measurements over different windows; no difference between them is reported. Rendering and GC: lengths of interval unions of the named trace events on the renderer main thread inside the page-marker window; the rendering union can contain GC that ran inside a rendering event. Trace data loss counts runs by Tracing.tracingComplete.dataLossOccurred (true/false/unknown).",
  "",
  markdownTable(
    [
      "Scenario",
      "Framework",
      "Variant",
      "n runs",
      "Captured median ms",
      "Captured apply total ms",
      "Task ms",
      "Main-thread rendering union ms",
      "Main-thread GC union ms",
      "n valid traces",
      "Data loss true/false/unknown",
      "Heap MiB",
    ],
    rows.map((row) => [
      ...label(row),
      row.runs,
      fixed(row.capturedMedianOfRunMediansMs, 3),
      fixed(row.capturedApplyTotalMs, 2),
      fixed(row.taskDurationMs, 1),
      fixed(row.rendererMainRenderingUnionMs, 1),
      fixed(row.rendererMainGcUnionMs, 1),
      row.validTraceRuns,
      `${row.traceDataLossTrue}/${row.traceDataLossFalse}/${row.traceDataLossUnknown}`,
      fixed(row.jsHeapUsedMiB, 2),
    ]),
  ),
  "",
  "## Captured pass: CPU time",
  "",
  `CPU = sum of cpuTime deltas of browser processes present at both CPU samples (a lower bound for the browser's CPU in the window; processes that start and exit between samples cannot be observed). n = runs. Flagged = runs above ${cpuFlagFactor} × the condition's median (descriptive; nothing excluded). GPU process = CPU time of Chrome's GPU process, not GPU hardware execution time.`,
  "",
  markdownTable(
    [
      "Scenario",
      "Framework",
      "Variant",
      "n runs",
      "Median ms",
      "Max ms",
      "Flagged runs",
      "Runs with process changes",
    ],
    rows.map((row) => [
      ...label(row),
      row.runs,
      fixed(row.bothEndpointsCpuTimeMs, 1),
      fixed(row.bothEndpointsCpuTimeMaxMs, 1),
      row.cpuFlaggedRuns,
      row.runsWithProcessChanges,
    ]),
  ),
  "",
  "### CPU per run (ms, in execution order): total (GPU process)",
  "",
  markdownTable(
    ["Scenario", "Framework", "Variant", ...runColumns],
    rows.map((row) => [
      ...label(row),
      ...row.runCpuMs.map(
        (value, index) =>
          `${value > cpuFlagFactor * row.bothEndpointsCpuTimeMs ? "**" : ""}${fixed(value, 0)} (${fixed(row.runGpuProcessCpuMs[index], 0)})${value > cpuFlagFactor * row.bothEndpointsCpuTimeMs ? "**" : ""}`,
      ),
    ]),
  ),
  ...(kindRows.length > 0
    ? [
        "",
        "## Primary pass: latency by operation kind",
        "",
        "Latency = median across runs (n = runs) of each run's per-kind median (n = Ops/run operations of that kind).",
        "",
        markdownTable(
          [
            "Scenario",
            "Framework",
            "Variant",
            "Kind",
            "n runs",
            "Ops/run",
            "Latency ms",
          ],
          kindRows.map((row) => [
            ...label(row),
            row.kind,
            row.runs,
            row.operationsPerRun,
            fixed(row.medianLatencyMs, 3),
          ]),
        ),
      ]
    : []),
  "",
  "## Correctness pass: DOM changes per operation",
  "",
  `n = operations checked per condition (warm-up steps 1–${warmup} and measured steps ${warmup + 1}–${warmup + measured}). Changed labels = labels the oracle expects to change; mutated pills = pills with a MutationObserver record; unchanged pills mutated = DOM writes to pills whose expected label did not change. Steps without label changes are value no-ops (e.g. step 1 sets 0 to 0) or Control steps.`,
  "",
  markdownTable(
    [
      "Scenario",
      "Framework",
      "Variant",
      "n ops checked",
      "Passed",
      "Steps without label changes",
      "Changed labels (min–max)",
      "Mutated pills (min–max)",
      "Unchanged pills mutated (total)",
      "Mutations outside pills (total)",
    ],
    correctnessRows.map((row) => [
      ...label(row),
      row.operations,
      row.passed ? "yes" : "**no**",
      stepList(row.unchangedSteps),
      row.changedLabels,
      row.mutatedPills,
      row.unchangedPillsMutated,
      row.mutationsOutsidePills,
    ]),
  ),
  "",
].join("\n");

const outputDir = path.dirname(reportPath);
// Earlier summaries are moved aside, never overwritten.
const supersededDir = path.join(outputDir, "superseded");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
for (const name of ["summary.md", "summary.csv"]) {
  const existing = path.join(outputDir, name);
  if (await fs.access(existing).then(() => true, () => false)) {
    await fs.mkdir(supersededDir, { recursive: true });
    await fs.rename(existing, path.join(supersededDir, `${stamp}-${name}`));
  }
}
await fs.writeFile(path.join(outputDir, "summary.csv"), csv(rows), "utf-8");
await fs.writeFile(path.join(outputDir, "summary.md"), markdown, "utf-8");
// Some Windows consoles garble non-ASCII; the written files stay UTF-8.
console.log(
  markdown
    .replaceAll("µ", "u")
    .replaceAll("–", "-")
    .replaceAll("−", "-")
    .replaceAll("≤", "<=")
    .replaceAll("†", "*")
    .replaceAll("°", "^")
    .replaceAll("·", "*"),
);
console.log(`Saved summary.csv and summary.md in ${outputDir}`);
