# Performance Measurement Protocol

This protocol aligns benchmark execution with thesis methodology and improves reproducibility.

## 1. Objective

Measure React and Solid performance for nested real-time updates across baseline and optimized implementations.

Primary focus:

- Update latency
- CPU usage

Supporting focus:

- Rendering time composition
- Memory trend during sustained updates

Captured directly by app export:

- Update latency distribution (including IQR)
- Throughput (ops/s)
- Optional memory snapshot when `performance.memory` is available

Collected externally:

- CPU usage (Chrome DevTools Performance)
- Rendering-time composition (Chrome DevTools trace breakdown)

## 2. Test Matrix

Run all combinations:

- Framework: React, Solid
- Variant: baseline, optimized
- Scenarios: deep-leaf-updates, context-propagation, partial-subtree-invalidation, controlled-patterns

Each full matrix run should use the same options for all entries.

## 3. Run Counts and Warmup

Recommended for thesis runs:

- Suite runs: 30
- Warmup runs excluded from analysis: first 5 suite runs
- Aggregation target: median across kept runs
- Variability reporting: interquartile range (IQR)

The in-app warmupIterations are per-operation warmups. Keep this value constant for all matrix entries.

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
7. Repeat until target run count is reached.

## 6. CPU Measurement (Chrome DevTools)

For each framework-variant pair and scenario:

1. Open DevTools Performance panel.
2. Start recording.
3. Run one suite iteration focused on the target condition.
4. Stop recording after completion.
5. Capture CPU time summary from Main thread and scripting breakdown.
6. Store trace filename with run metadata.

Notes:

- DevTools introduces observer overhead.
- Compare conditions only within the same profiling method.
- Do not compare profiled and non-profiled runs directly.

## 7. Memory Measurement

Use one approach consistently:

- Preferred: DevTools Performance memory lane and heap trend.
- Optional: Performance Memory API in Chrome (where available).

Collect memory under sustained updates (higher iterations) and report trend, not single snapshots.

## 8. Analysis Guidance

For each metric:

- Use median as primary estimator.
- Report IQR for spread.
- Include p95 latency from exported JSON.
- Avoid single-score conclusions without scenario-level tables.

## 9. Fairness Guardrails

- Keep scenario options identical across all matrix entries.
- Do not change component hierarchy between framework variants.
- Keep operation schedule deterministic.
- Report all scenarios for each framework and variant.

## 10. Suggested Improvements for Future Study

- Add automated CSV/JSON merge script for all run exports.
- Add confidence intervals via bootstrap resampling.
- Add browser version replication runs (for example Chrome stable and beta).
- Add controlled timer-frequency sensitivity study.
- Add flat-UI baseline dataset to support direct RQ3 mapping.
