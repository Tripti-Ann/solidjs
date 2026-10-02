# Performance Measurement Protocol

This protocol aligns benchmark execution with thesis methodology and improves reproducibility.

## 1. Objective

Measure React and Solid performance for nested real-time updates across baseline and optimized implementations.

Primary focus:

- Update latency
- Chrome DevTools Protocol `TaskDuration`

Supporting focus:

- Trace-event duration total
- Memory trend during sustained updates

Captured directly by app export:

- Raw update-latency records and their aggregate distribution (including IQR)
- Throughput (ops/s) derived from mean measured latency

Collected externally:

- Condition-level CDP `TaskDuration` (Chrome DevTools Performance domain)
- Trace-event duration total (Chrome DevTools trace)
- Condition-level CDP JavaScript heap snapshots (`JSHeapUsedSize`, `JSHeapTotalSize`)

## 2. Test Matrix

Run all combinations:

- Framework: React, Solid
- Variant: baseline, optimized
- Scenarios: deep-leaf-updates, context-propagation, partial-subtree-invalidation, controlled-patterns

Each full matrix run should use the same options for all entries.

## 3. Run Counts and Warmup

Required configuration:

- Per-run warmup iterations (in-app `Warmup`): 5
- Per-run measured iterations (in-app `Iterations`): 25
- Suite runs (independent repeats): 1

Notes:

- Each framework/variant/scenario condition therefore executes 30 operations: 5 warm-up operations excluded from analysis, followed by 25 measured operations.
- Raw records retain both phases. Median, IQR, p95, and aggregate ops/s use only the 25 measured latencies.

## 4. Environment Control

Before each session:

- Use the same machine, OS power mode, and browser version.
- Close unrelated heavy apps.
- Disable browser extensions.
- Keep hardware acceleration enabled.
- Keep the tab focused during active measurements.

Record these details in the thesis appendix.

## 5. App Execution Steps

1. Start app with `npm run dev`.
2. Open the benchmark page in Chrome.
3. Set depth, breadth, warmup, iterations, and suite runs.
4. Keep visual mode off for fair timing.
5. Run comparison.
6. Export JSON.
7. Preserve each independent export as a separate experiment run.

## 6. CDP TaskDuration Measurement

The automated Chrome runner captures this condition-level metric for each framework, variant, and scenario:

1. Start the benchmark application.
2. Run `npm run metrics:chrome`.
3. Read the generated `chrome-metrics-report.json`.
4. Retain optional trace files when `--saveTraces=true` is supplied.

Definition:

- `TaskDuration` is the CDP `Performance.getMetrics` cumulative task-duration value. The script records the before/after delta and converts seconds to milliseconds.
- Its scope is one traced capture pass for a framework, variant, and scenario. It includes benchmark JavaScript and any `requestAnimationFrame` callbacks executed by that pass; it excludes idle wall-clock time.
- It is not labelled as CPU usage, CPU utilisation, or a percentage.
- Tracing and DevTools instrumentation introduce overhead. Compare only conditions captured with the same process.

## 7. Trace Event Duration Measurement

The automation records `traceRenderingAndPaintingDurationMs`: the sum of complete trace events (`ph = "X"`) for `Layout`, `RecalculateStyles`, `UpdateLayoutTree`, `UpdateLayerTree`, `CompositeLayers`, `Commit`, `Paint`, and `RasterTask`. Trace durations are converted from microseconds to milliseconds. This is a named trace-event total, not a CPU utilisation metric and not a complete browser rendering cost.

## 8. Memory Measurement

The automated Chrome report stores `JSHeapUsedSize` and `JSHeapTotalSize` as condition-level CDP snapshots after the measured capture pass. These are JavaScript heap snapshots, not total process or system memory. Interpret individual snapshots cautiously.

## 9. Analysis Guidance

For each metric:

- Use median as primary estimator.
- Report IQR for spread.
- Include p95 latency from exported JSON.
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

- Add automated CSV/JSON merge script for all run exports.
- Add confidence intervals via bootstrap resampling.
- Add browser version replication runs (for example Chrome stable and beta).
- Add controlled timer-frequency sensitivity study.
- Add flat-UI baseline dataset to support direct RQ3 mapping.
