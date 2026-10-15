# Performance Measurement Protocol

Protocol 3 (2026-10-15; FAIRNESS_SPEC.md version 2.1). Reports from protocol 1 are kept unchanged and are not comparable for CPU and trace metrics; protocol-2 reports can be re-summarised from their raw data.

This protocol aligns benchmark execution with thesis methodology and improves reproducibility.

## 1. Objective

Measure React and Solid performance for nested real-time updates across baseline and optimized implementations.

Primary focus:

- Update latency of the primary pass (run-level medians: their median, IQR, and individual values)

Supporting focus (captured pass):

- Chrome DevTools Protocol `TaskDuration` and the summed captured `apply()` latency, reported side by side (no difference is computed)
- Renderer-main-thread union time of named rendering events, and separately of garbage-collection events
- CPU time of browser processes present at both CPU samples (lower bound)
- Post-GC JavaScript heap snapshots

All of these come from `npm run metrics:chrome`; the browser UI export contains update latencies only.

## 2. Test Matrix

Run all combinations:

- Framework: React, Solid
- Variant: baseline, optimized
- Scenarios: Deep Tree Updates (`deep-leaf-updates`), Root Value Updates (`root-update-propagation`), Partial Subtree Invalidation (`partial-subtree-invalidation`), Controlled Update Patterns (`controlled-patterns`)
- Plus the Control condition per scenario (same markup, `apply()` ignores the operation)

Each full matrix run should use the same options for all entries.

## 3. Run Counts and Warmup

Required configuration:

- Per-run warmup iterations (in-app `Warmup`): 5
- Per-run measured iterations (in-app `Iterations`): 25
- Suite runs (repeated runs in one browser session, `npm run metrics:chrome`): 10

Notes:

- Each framework/variant/scenario condition executes 30 operations per run: 5 warm-up operations excluded from analysis, followed by 25 measured operations.
- Raw records retain both phases. Median, IQR, p95, and aggregate ops/s use only the 25 measured latencies of a run.
- Each suite run uses a fresh page load per condition, plus another before the traced pass. Runs are interleaved and the condition order within a run is a seeded shuffle, so slow drift (for example CPU thermal state) is spread across conditions instead of being shared by the 25 operations of one condition.
- All runs share one browser launch (and usually one renderer process), so they are repeated measurements within one browser session, not independent fresh-process replications. The planned order (`conditionOrder.perRun`) and the executed order (`executionLog`) are saved.
- Within-run statistics (from the 25 measured latencies of one run) and across-run statistics (from one value per run) are reported in separate tables. The main descriptive evidence is the run-level median latency: the median of the run medians, their nearest-rank Q1–Q3 and IQR, and every run median in execution order. For mixed scenarios also report the per-kind medians.
- No confidence intervals are reported: the runs are dependent repetitions within one browser session, so the coverage of a resampling interval is not established.
- Quantiles are nearest-rank: sort n values and take index `ceil(p·n) − 1`. For an even n this is the lower median (10 runs: value 5; Q1 value 3; Q3 value 8). Within a run (n = 25): median value 13, Q1 value 7, Q3 value 19, p95 value 24.
- Both passes keep their individual latencies: `rawMeasurements` (primary) and `capturedRawMeasurements` (captured). Exact zeros (below the 5 µs timer step) are kept and counted.
- Step 1 of deep-leaf-updates, Root Value Updates, and controlled-patterns sets a value from 0 to 0. It is a warm-up step, so no value no-op occurs among the measured operations (correctness-pass evidence: "Steps without label changes").

## 4. Environment Control

The Chrome runner launches headless Chrome with extensions and background throttling disabled. Each report records OS, CPU, browser, and library versions; Puppeteer, Vite, plugin, and TypeScript versions; Chrome launch arguments; SHA-256 of `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, and `index.html`; SHA-256 of the files the preview server actually served; the git commit; `git status` entries; the tracked diff (`source.patch`); and copies plus hashes of untracked files. Commit before a thesis run for a clean source revision. Before each session:

- Use the same machine, OS power mode, and browser version.
- Close unrelated heavy apps.

Record these details in the thesis appendix.

## 5. Correctness Pass

Before measuring, the runner launches a separate Chrome instance with the same flags and served bundle. For every condition it loads the page, mounts the initial tree in a `bench-host`, and after each of the 30 `apply()` calls (before yielding) compares every rendered label and the tree-node level sequence with an oracle that keeps expected values by node id and does not use `tree.ts` update helpers. A MutationObserver records which pills each operation mutated. If any condition fails, no measurements are taken. Each measured pass additionally checks the final labels after all of its measurement endpoints (`domMatchesModel`).

## 6. Browser UI

The browser UI is for checking and demonstration only (see README). Its suite runs share one page, so its exports are not used for thesis results.

## 7. CDP TaskDuration Measurement

The automated Chrome runner captures this condition-level metric for each framework, variant, and scenario:

1. Run `npm run metrics:chrome`. It builds and serves the production bundle on port 4173 and refuses to run if that port is already in use, so an outdated build is never measured by accident.
2. Read the generated `chrome-metrics-report.json` and confirm `buildMode` is `production`, or run `npm run report` for summary tables.
3. Retain optional trace files when `--saveTraces` is supplied.

Definition:

- `TaskDuration` is the CDP `Performance.getMetrics` cumulative task-duration value. The script records the before/after delta and converts seconds to milliseconds.
- Its scope is one traced capture pass for a framework, variant, and scenario. It includes benchmark JavaScript and any `requestAnimationFrame` callbacks executed by that pass; it excludes idle wall-clock time.
- It is not labelled as CPU usage, CPU utilisation, or a percentage.
- Tracing and DevTools instrumentation introduce overhead. Compare only conditions captured with the same process.

## 8. Trace Event Measurement

- Session and data loss: tracing is started and ended with CDP `Tracing.start`/`Tracing.end` (stream transfer, categories `devtools.timeline`, `v8`, `blink.user_timing`, `disabled-by-default-devtools.timeline`) on the page-target session that also samples `Performance.getMetrics`. `Tracing.tracingComplete.dataLossOccurred` is recorded per run; `"unknown"` if the event lacks the field.
- Boundaries: the captured pass emits `performance.mark` events (`configuration.traceWindowMarks`) just before the first measured operation and after the frame that follows the last one. Their trace timestamps (µs) define the window, so no clock mapping between Node and the browser is needed. A trace without exactly one start and one end marker is `valid: false` and excluded (n is reported).
- Processes and threads: the renderer is the process and thread that emitted the start marker (`rendererMainThreadName`, normally `CrRendererMain`). Events are grouped as renderer main thread, other renderer threads, and other processes (browser, GPU).
- Event names: `Layout`, `RecalculateStyles`, `UpdateLayoutTree`, `PrePaint`, `Paint`, `Layerize`, `UpdateLayerTree`, `CompositeLayers`, `Commit`, `RasterTask` (rendering) and `MinorGC`, `MajorGC` (garbage collection). Names that do not occur in a Chrome version contribute 0.
- Units and boundary handling: complete events (`ph = "X"`) are clipped to the window; `clippedEvents` counts events crossing a boundary and `nonCompleteTrackedEvents` counts tracked events in other phases, which are not used.
- Nesting: `inclusiveMsByScope` sums clipped durations per name and scope; these are inclusive event-duration sums, not elapsed rendering time. `rendererMainRenderingUnionMs` (rendering names) and `rendererMainGcUnionMs` (GC names) are separate lengths of interval unions on the renderer main thread, so nested or overlapping events count once (`overlappingMainThreadEvents`); the rendering union can contain GC that ran inside a rendering event. `rendererMainRenderingOrGcUnionMs` is the union of both sets. Units: ms.
- The trace window differs from the TaskDuration and CPU windows (those are delimited by CDP calls from Node).
- `--saveTraces` stores each trace gzipped (`*.trace.json.gz`).

## 9. CPU Time Measurement

`SystemInfo.getProcessInfo` returns cumulative `cpuTime` (seconds) per process and no process start time. Process set: every process it reports for the dedicated browser instance at a sample. The runner samples it just before resuming the measured operations and just after they finish, and keeps both raw samples (`cpuMetrics.endpoints`). Processes that start and exit between the two samples are never observed. Policy:

- `bothEndpointsCpuTimeMs`: sum of deltas of processes present in both samples. Exact for those processes (assuming a process id is not reused within the window) and a lower bound for the browser's CPU in the window; reported under that label, not as complete process-group CPU time.
- `endOnly` processes: only a cumulative reading exists, which can include CPU from before the window. `observedProcessesUpperEstimateMs` adds these readings in full. It covers observed processes only and is not an upper bound on all browser CPU; it is null when a `startOnly` process exists.
- Lifecycle, from the session's other samples: `missing-from-start-sample` (seen earlier in the session), `first-observed-at-end-sample` (never seen before), `missing-from-end-sample` (seen later), `not-observed-again`.
- GPU-process CPU is CPU time of Chrome's GPU process, not GPU hardware execution time.
- Large values are kept. `npm run report` counts runs above 2 × the condition's median per condition (a descriptive flag) and lists every run's CPU with its GPU-process share in execution order. Temporal overlap with other events is not treated as a cause.

## 10. Memory Measurement

The automated Chrome runner reloads the page before every condition. It forces a garbage collection (`HeapProfiler.collectGarbage`) outside the timed window after warm-up and again after the measured operations, then stores `JSHeapUsedSize` and `JSHeapTotalSize` from the second snapshot (tree still mounted) plus `jsHeapUsedDeltaMb` between the two. These are JavaScript heap snapshots, not total process or system memory. Interpret individual snapshots cautiously.

## 11. Analysis Guidance

Work outside the update-latency window:

- Update latency times `apply()` synchronously and back-to-back, so style recalculation, layout, paint, and deferred garbage collection are not included.
- `TaskDuration` and the summed captured `apply()` latency (`tracedApplyTotalMs`) cover different windows and kinds of time (main-thread task time between Node-side CDP samples versus wall time inside `apply()`), so their difference cannot isolate work outside `apply()`. Protocol 3 reports them side by side and computes no difference (`nonApplyTaskDurationMs` and "above Control" were removed).
- The Control condition shows the harness floor for the same markup; compare it descriptively, not by subtraction.
- `scriptDurationMs` was dropped in protocol 2: the CDP `ScriptDuration` delta was 0.2–2.5 ms where the traced `apply()` total was up to about 650 ms, so it did not capture the timed work.
- Interpret latency together with these metrics; a lower synchronous latency does not imply less total work.

Timer resolution:

- `environment.timerResolutionMs` records the smallest observed `performance.now()` step (5 µs when cross-origin isolated). Latencies at or below it are reported as below the effective timer resolution, not as zero (`atOrBelowTimerResolutionCount`).
- `npm run report` flags rows with any measured latency at or below the resolution (°) and rows where more than 10% are (†). † rows are quantised to timer ticks and must not be used for precise comparisons or ratios.

For each metric:

- Use median as primary estimator.
- Report IQR for spread.
- Include p95 latency.
- Calculate p95 with nearest-rank: sort the 25 measured latencies and select index `ceil(0.95 * n) - 1`.
- Calculate IQR as the nearest-rank 75th percentile minus the nearest-rank 25th percentile.
- Calculate ops/s as `1000 / mean measured latency in milliseconds` (null when the mean is 0) and label it as the reciprocal of the mean synchronous `apply()` latency, not application throughput.
- Avoid single-score conclusions without scenario-level tables.

Interpretation limits:

- The benchmark host is attached to the page but positioned off-screen with `visibility: hidden`, so painting of the tree is minimal; update latency measures framework JavaScript and DOM mutation, not visible rendering.
- Root Value Updates (key `root-update-propagation`) changes the root value per operation while descendant values remain unchanged. Measured in the correctness pass: one label changes and at most one pill is mutated per operation in every variant. Code-derived (not measured): React baseline re-renders every component (no memoization); React optimized (memo plus memoized children of an unchanged children array), Solid baseline (`<Index>` over an unchanged children array), and Solid optimized (one root signal) do not re-execute descendants.
- Do not compute latency ratios for conditions marked † (timer-limited).
- Exclude any condition whose correctness pass or `domMatchesModel` check failed.

## 12. Fairness Guardrails

- Keep scenario options identical across all matrix entries.
- Do not change component hierarchy between framework variants.
- Keep operation schedule deterministic.
- Report all scenarios for each framework and variant.

## 13. Suggested Improvements for Future Study

- Add browser version replication runs (for example Chrome stable and beta).
- Add controlled timer-frequency sensitivity study.
- Add flat-UI baseline dataset to support direct RQ3 mapping.
