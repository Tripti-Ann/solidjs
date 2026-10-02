# SolidJS vs React Nested UI Benchmark

This project compares SolidJS and React performance for deeply nested UI workloads, with a fairness-first protocol inspired by js-framework-benchmark.

## What this includes

- Shared deterministic benchmark scenarios and update schedules
- React and Solid adapters with baseline and optimized variants
- Browser UI to run the benchmark matrix and view aggregate results
- JSON export with separate raw operation records and aggregate results
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
- `npm run metrics:chrome`: run Puppeteer + CDP and trace metric capture

## Methodology notes

- The browser UI runs a full matrix: scenario x framework x variant.
- Results table includes framework variant, mean, IQR, p95, and ops/s.
- Export JSON preserves raw warm-up and measured operation records separately from aggregate outputs.
- CDP and trace measurements are stored in the automated Chrome report, not in the browser export.
- JavaScript heap snapshots are stored as CDP `JSHeapUsedSize` and `JSHeapTotalSize` in the automated Chrome report.
- Protocol details are documented in `PERFORMANCE_PROTOCOL.md`.

## Automated Chrome Metrics Capture

This project includes `bench/chrome-metrics.mjs`, a Puppeteer-based runner that collects:

- In-app benchmark aggregates (mean, IQR, p95, ops/s)
- Raw operation records with warm-up/measured status and update latency
- Condition-level CDP metrics (`TaskDuration`, `ScriptDuration` deltas)
- Trace-event duration total for explicitly named layout, paint, and compositing events
- CDP memory metrics (`JSHeapUsedSize`, `JSHeapTotalSize`)

The default condition executes 5 warm-up operations and 25 measured operations (`suiteRuns=1`).

Steps:

1. Start the benchmark app:
   - `npm run dev`

2. In another terminal, run the metrics script:
   - `npm run metrics:chrome`

3. Optional flags:
   - `npm run metrics:chrome -- --url=http://127.0.0.1:5173`
   - `npm run metrics:chrome -- --suiteRuns=1 --depth=5 --breadth=3 --warmup=5 --iterations=25`
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
