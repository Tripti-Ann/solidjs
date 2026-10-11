# SolidJS vs React Nested UI Benchmark

This project compares SolidJS and React performance for deeply nested UI workloads, with a fairness-first protocol inspired by js-framework-benchmark.

## Quick start

```
npm install
npm run metrics:chrome   # builds, serves, and measures the full matrix (about 8 minutes)
npm run report           # writes summary.md and summary.csv next to the newest report
```

## Requirements and setup

- Node.js `^20.19.0` or `>=22.12.0` (required by Vite 8)
- `npm install` (Puppeteer downloads its own Chrome build during install; on Windows the runner prefers an installed Google Chrome, or set `CHROME_EXECUTABLE_PATH`)

## Browser UI

For looking at and checking the benchmark, not for thesis numbers.

- Quick look (development build, distorted timings): `npm start` (same as `npm run dev`), then open http://localhost:5173.
- Production-like timings: `npm run build`, then `npm run preview -- --port 4174`, then open http://localhost:4174. Use a port other than 4173, because `npm run metrics:chrome` refuses to start while 4173 is in use.
- Set Warmup, Iterations, and Suite Runs, then click **Run Comparison**. **Export JSON** saves aggregates and raw warm-up/measured records. **Debug visual mode** shows the trees updating live but caps the runs.
- Suite Runs in the UI repeat the matrix in the same page without reloading and pool the latencies, so they are not independent. The default of 1 is deliberate; thesis results use the 10 independent runs of `npm run metrics:chrome`.
- The UI has no Control condition and collects no task-time, trace, or heap metrics; those are only in the Chrome report.

## Nested research scenarios

Each scenario has a fixed tree shape (depth × breadth).

- Deep tree updates (100 × 1)
- Root update propagation (7 × 3): repeated root updates; no framework Context API is used
- Partial subtree invalidation (8 × 3)
- Controlled mixed update patterns (7 × 3)

## Implementation variants

- React baseline: straightforward recursive rendering
- React optimized: `React.memo`, `useMemo`, and `useCallback`
- Solid baseline: single-root signal with immutable tree updates, rendered through `<Index>`
- Solid optimized: decomposed node-level signals with `createMemo`; subtree operations update all node signals inside one `batch()`, so each operation propagates once
- Control (Chrome runner only): the same markup rendered with plain DOM that ignores every update; it measures the harness overhead floor

## Scripts

- `npm start` / `npm run dev`: start local app (development build; use for debugging only, not for thesis timings)
- `npm run build`: type-check and production build
- `npm run preview`: preview production build
- `npm run test`: run test suite once
- `npm run test:watch`: run tests in watch mode
- `npm run metrics:chrome`: run Puppeteer + CDP and trace metric capture against the production build
- `npm run report [-- <results folder>]`: summarize a Chrome report (default: newest) into `summary.md` and `summary.csv`

## Automated Chrome Metrics Capture

This project includes `bench/chrome-metrics.mjs`, a Puppeteer-based runner that collects:

- In-app benchmark aggregates (median, IQR, mean, p95, ops/s) per independent suite run, plus the distribution of per-run medians across runs
- Raw operation records with warm-up/measured status and update latency
- Condition-level CDP metrics (`TaskDuration`, `ScriptDuration` deltas) and `nonApplyTaskDurationMs` (main-thread task time outside the timed `apply()` calls)
- Trace-event durations for named layout, paint, compositing, and garbage-collection events
- CDP memory metrics (`JSHeapUsedSize`, `JSHeapTotalSize`) after a forced garbage collection
- Observed `performance.now()` resolution and the number of latencies at or below it
- Per-run medians split by operation kind (point vs subtree)

The default executes 10 independent suite runs per condition, each with 5 warm-up and 25 measured operations, including a Control condition per scenario. Runs are interleaved (all conditions for run 1, then run 2, ...) in a seeded shuffled order, and the page is reloaded before every condition and before its traced pass. A full matrix takes about 8 minutes.

Steps:

1. Run `npm run metrics:chrome`. It runs `vite build`, starts `vite preview` on port 4173, and stops it at the end. If port 4173 is already in use, it stops with an error so an outdated build is never measured by accident.
2. To measure a server you started yourself, pass `--url=...` (the report records `buildMode` and warns when it is not `production`).
3. Run `npm run report` to get the summary tables, including 95% bootstrap confidence intervals and outside-apply time above the Control floor. Conditions limited by the timer resolution are marked † and get no confidence interval.

If a run fails part-way, the conditions finished so far are still saved, marked `"incomplete": true`, and the preview server is always stopped.

Flags (all optional, `--name=value`; `npm run metrics:chrome -- --help` lists them; unknown flags are rejected):

| Flag                        | Default                                    | Meaning                                                      |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `--url`                     | build + preview on `http://127.0.0.1:4173` | Benchmark page URL of a server you started                   |
| `--autoStartServer`         | `true`                                     | Build and start a preview server when `--url` is unreachable |
| `--framework`               | all                                        | `React` or `Solid`                                           |
| `--variant`                 | all                                        | `baseline` or `optimized`                                    |
| `--scenario`                | all                                        | One scenario key, e.g. `controlled-patterns`                 |
| `--control`                 | `true`                                     | Include the Control condition                                |
| `--suiteRuns`               | `10`                                       | Independent repeats per condition                            |
| `--shuffle` / `--seed`      | `true` / `1`                               | Seeded shuffle of condition order within each run            |
| `--warmup` / `--iterations` | `5` / `25`                                 | Warm-up and measured operations                              |
| `--saveTraces`              | `false`                                    | Save Chrome trace files (`--saveTraces` alone also works)    |
| `--chromeExecutablePath`    | auto                                       | Chrome binary (also `CHROME_EXECUTABLE_PATH`)                |

Output:

- Report path: `bench/results/<timestamp>/chrome-metrics-report.json`
- Summary (after `npm run report`): `bench/results/<timestamp>/summary.md` and `summary.csv`
- Optional trace files: `bench/results/<timestamp>/*.trace.json`

## Documentation

- `PERFORMANCE_PROTOCOL.md`: measurement procedure, metric definitions, and analysis guidance
- `FAIRNESS_SPEC.md`: fairness rules, adapter contract, and AI ethics rules
- `CONTEXT.md`: important prompts and the decision log
