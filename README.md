# SolidJS vs React Nested UI Benchmark

This project compares SolidJS and React performance for deeply nested UI workloads, with a fairness-first protocol inspired by js-framework-benchmark.

## What this includes

- Shared deterministic benchmark scenarios and update schedules
- React and Solid adapters with baseline and optimized variants
- Browser UI to run repeated benchmark suites and view aggregate results
- JSON export for scenario/framework/variant aggregate results
- Automated tests with Vitest
- Benchmark runner with Vitest bench mode

## Nested research scenarios

- Deep tree updates
- Context propagation stress
- Partial subtree invalidation
- Controlled mixed update patterns

## Implementation variants

- React baseline: straightforward recursive rendering
- React optimized: `React.memo`, `useMemo`, and `useCallback`
- Solid baseline: single-root signal with immutable tree updates
- Solid optimized: decomposed node-level signals with `createMemo`

## Scripts

- `npm run dev`: start local app
- `npm run build`: type-check and production build
- `npm run preview`: preview production build
- `npm run test`: run test suite once
- `npm run test:watch`: run tests in watch mode
- `npm run bench`: run benchmark suite in bench mode
- `npm run metrics:chrome`: run Puppeteer + CDP metric capture (CPU/rendering/memory)

## Methodology notes

- The browser UI runs a full matrix: scenario x framework x variant.
- Results table includes framework variant, mean, IQR, p95, and ops/s.
- Use Export JSON to persist aggregate outputs for thesis analysis.
- CPU and rendering-time collection are marked as external DevTools metrics in export metadata.
- Memory usage is exported when the browser supports the non-standard `performance.memory` API.
- Protocol details are documented in `PERFORMANCE_PROTOCOL.md`.

## Automated Chrome Metrics Capture

This project includes `bench/chrome-metrics.mjs`, a Puppeteer-based runner that collects:

- In-app benchmark aggregates (mean, IQR, p95, ops/s)
- CDP CPU-related metrics (`TaskDuration`, `ScriptDuration` deltas)
- Trace-derived rendering and painting duration buckets
- CDP memory metrics (`JSHeapUsedSize`, `JSHeapTotalSize`)

Steps:

1. Start the benchmark app:
   - `npm run dev`

2. In another terminal, run the metrics script:
   - `npm run metrics:chrome`

3. Optional flags:
   - `npm run metrics:chrome -- --url=http://127.0.0.1:5173`
   - `npm run metrics:chrome -- --suiteRuns=10 --depth=5 --breadth=3 --warmup=60 --iterations=240`
   - `npm run metrics:chrome -- --saveTraces=true`

Output:

- Report path: `bench/results/<timestamp>/chrome-metrics-report.json`
- Optional trace files: `bench/results/<timestamp>/*.trace.json`

## Benchmark fairness rules

- Same tree depth and breadth
- Same warmup and measured iteration counts
- Same update path traversal strategy

See FAIRNESS_SPEC.md for the formal fairness protocol, adapter requirements, AI ethics rules, and reporting standards.

## Continuous context documentation

All important prompts, model details, and implementation decisions are tracked in CONTEXT.md.
