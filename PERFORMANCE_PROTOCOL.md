# Performance Measurement Protocol

This protocol aligns benchmark execution with thesis methodology and improves reproducibility.

## 1. Objective

Measure React and Solid performance for nested real-time updates across baseline and optimized implementations.

Primary focus:

- Update latency (median of per-run medians)

Supporting focus:

- Chrome DevTools Protocol `TaskDuration`
- Main-thread time outside `apply()`, relative to the Control condition
- Named trace-event durations (rendering, painting, garbage collection)
- Browser process-group CPU time
- Post-GC JavaScript heap snapshots

All of these come from `npm run metrics:chrome`; the browser UI export contains update latencies only.

## 2. Test Matrix

Run all combinations:

- Framework: React, Solid
- Variant: baseline, optimized
- Scenarios: deep-leaf-updates, root-update-propagation, partial-subtree-invalidation, controlled-patterns
- Plus the Control condition per scenario (harness overhead floor)

Each full matrix run should use the same options for all entries.

## 3. Run Counts and Warmup

Required configuration:

- Per-run warmup iterations (in-app `Warmup`): 5
- Per-run measured iterations (in-app `Iterations`): 25
- Suite runs (independent repeats, `npm run metrics:chrome`): 10

Notes:

- Each framework/variant/scenario condition executes 30 operations per run: 5 warm-up operations excluded from analysis, followed by 25 measured operations.
- Raw records retain both phases. Median, IQR, p95, and aggregate ops/s use only the 25 measured latencies of a run.
- Each suite run uses a fresh page load per condition, plus another before the traced pass. Runs are interleaved and the condition order within a run is a seeded shuffle, so slow drift (for example CPU thermal state) is spread across conditions instead of being shared by the 25 operations of one condition.
- The unit of analysis is the per-run median latency; report the median and spread of the 10 per-run medians (`summaryAcrossRuns.runMedianLatencyMs`). For mixed scenarios also report `runMedianLatencyMsByKind`.
- `npm run report` writes `summary.md` and `summary.csv` with these values and a 95% percentile-bootstrap confidence interval of the median per-run median.

## 4. Environment Control

The Chrome runner launches headless Chrome with extensions and background throttling disabled, and records OS, CPU, browser, and library versions in the report. Before each session:

- Use the same machine, OS power mode, and browser version.
- Close unrelated heavy apps.

Record these details in the thesis appendix.

## 5. Browser UI

The browser UI is for checking and demonstration only (see README). Its suite runs share one page, so its exports are not used for thesis results.

## 6. CDP TaskDuration Measurement

The automated Chrome runner captures this condition-level metric for each framework, variant, and scenario:

1. Run `npm run metrics:chrome`. It builds and serves the production bundle on port 4173 and refuses to run if that port is already in use, so an outdated build is never measured by accident.
2. Read the generated `chrome-metrics-report.json` and confirm `buildMode` is `production`, or run `npm run report` for summary tables.
3. Retain optional trace files when `--saveTraces` is supplied.

Definition:

- `TaskDuration` is the CDP `Performance.getMetrics` cumulative task-duration value. The script records the before/after delta and converts seconds to milliseconds.
- Its scope is one traced capture pass for a framework, variant, and scenario. It includes benchmark JavaScript and any `requestAnimationFrame` callbacks executed by that pass; it excludes idle wall-clock time.
- It is not labelled as CPU usage, CPU utilisation, or a percentage.
- Tracing and DevTools instrumentation introduce overhead. Compare only conditions captured with the same process.

## 7. Trace Event Duration Measurement

The automation records `traceRenderingAndPaintingDurationMs`: the sum of complete trace events (`ph = "X"`) for `Layout`, `RecalculateStyles`, `UpdateLayoutTree`, `UpdateLayerTree`, `CompositeLayers`, `Commit`, `Paint`, and `RasterTask`. Trace durations are converted from microseconds to milliseconds. This is a named trace-event total, not a CPU utilisation metric and not a complete browser rendering cost.

## 8. Memory Measurement

The automated Chrome runner reloads the page before every condition. It forces a garbage collection (`HeapProfiler.collectGarbage`) outside the timed window after warm-up and again after the measured operations, then stores `JSHeapUsedSize` and `JSHeapTotalSize` from the second snapshot (tree still mounted) plus `jsHeapUsedDeltaMb` between the two. These are JavaScript heap snapshots, not total process or system memory. Interpret individual snapshots cautiously.

## 9. Analysis Guidance

Work outside the update-latency window:

- Update latency times `apply()` synchronously and back-to-back, so style recalculation, layout, paint, and deferred garbage collection are not included.
- `nonApplyTaskDurationMs` is `TaskDuration` minus the summed `apply()` latencies of the traced pass (which yields one frame per operation); it is the main-thread task time spent outside `apply()`. The runner awaits measurement boundaries with a single promise instead of polling, so it adds no work inside the window.
- The Control condition renders the same markup with plain DOM and ignores every update. Its `nonApplyTaskDurationMs` is the harness floor (frame production, tracing, bookkeeping); report framework values above this floor (`Above control` in `npm run report`).
- `traceMetrics.durationsByEventMs` breaks this down by named trace event, including `MinorGC` and `MajorGC`.
- Interpret latency together with these metrics; a lower synchronous latency does not imply less total work.

Timer resolution:

- `environment.timerResolutionMs` records the smallest observed `performance.now()` step (5 µs when cross-origin isolated). Latencies at or below it are reported as below the effective timer resolution, not as zero (`atOrBelowTimerResolutionCount`).
- `npm run report` marks conditions where more than 10% of measured latencies are at or below the resolution (†). Their medians are quantised to timer ticks and no confidence interval is given; compare them using task and outside-apply time instead.

For each metric:

- Use median as primary estimator.
- Report IQR for spread.
- Include p95 latency.
- Calculate p95 with nearest-rank: sort the 25 measured latencies and select index `ceil(0.95 * n) - 1`.
- Calculate IQR as the nearest-rank 75th percentile minus the nearest-rank 25th percentile.
- Calculate aggregate ops/s as `1000 / mean measured latency in milliseconds`.
- Avoid single-score conclusions without scenario-level tables.

## 10. Fairness Guardrails

- Keep scenario options identical across all matrix entries.
- Do not change component hierarchy between framework variants.
- Keep operation schedule deterministic.
- Report all scenarios for each framework and variant.

## 11. Suggested Improvements for Future Study

- Add browser version replication runs (for example Chrome stable and beta).
- Add controlled timer-frequency sensitivity study.
- Add flat-UI baseline dataset to support direct RQ3 mapping.
