# CONTEXT

## Project Goal

Build and maintain a reproducible benchmark application that compares SolidJS and React performance for deeply nested UI updates.

## AI Assistance

- Edits and suggestions have been assisted by an automated coding agent; all changes are reviewed by project maintainers.
- 2026-10-15: GitHub Copilot agent mode (Claude Opus 5.5) performed a critical methodology review and implemented protocol 2 (FAIRNESS_SPEC 2.0). ChatGPT reviewed the change plan and requested the revisions recorded below. AI review does not satisfy FAIRNESS_SPEC AI rule 8.
- Independent verification (AI rule 8) of protocols 2–3 and their experiments: **pending**; no non-author human verification has taken place yet.

## Important Prompts Log

- 2026-04-16: "Can you help me design a test runner with tests for SolidJS, React. I need an application to compare the performance of SolidJS and React in updating nested UI elements."
- 2026-04-16: "Continue with #new workspace setup"
- 2026-04-16: "Can you also continuously document the important prompts and the AI agent/model used for building this application. Create a CONTEXT.md file with important instructions. Follow industry best practices."
- 2026-04-21: "Are the test runners ready? If so, explain what has been done and what needs to be done next."
- 2026-04-21: "Refer to what Krausest has done for flat UIs... I want a similar test for nested UIs..."
- 2026-04-21: "How is this application similar and different from krausest's benchmark?"
- 2026-04-21: "Yes please" (request to draft a formal fairness spec for this benchmark)
- 2026-04-21: "Ensure that AI is used ethically for this research and implementation. Include rules in the file where it should be included."
- 2026-07-05: "Please check my application..." (thesis objective and RQ alignment review request)
- 2026-07-05: "Yes please... methodology that you can follow... suggest improvements" (request to implement baseline vs optimized matrix and methodology-aligned reporting)
- 2026-10-01: Approved a minimal measurement/export update: preserve the existing workload and implementations, use 5 warmups plus 25 measured operations, retain raw records, and accurately name CDP/trace metrics.
- 2026-10-11: Requested verification and fixes for an external review (usability, code quality, correctness) without breaking functionality; approved methodology-changing fixes listed in the decision log.
- 2026-10-11: Implemented supervisor feedback: more independent suite runs with per-run medians, visibility of work outside the measurement window, and timer-resolution wording.
- 2026-10-11: Requested a fresh usability/code-quality/correctness review and approved implementing its follow-up plan.
- 2026-10-11: Third review round: approved adding `batch()` to Solid optimized subtree updates and the remaining robustness fixes.
- 2026-10-15: Requested a critical research-code review (scenarios, runs, boundaries, captured pass, Control, environment, analysis), then: "DO what is important" plus usability, code quality, and correctness.
- 2026-10-15: Plan revision requested via ChatGPT: treat trace filtering and CPU accounting as measurement-method changes; resolve root-update semantics, CPU lifecycle handling, trace boundaries, and per-operation Chrome correctness with evidence; record full provenance; preserve earlier outputs; run a new experiment; keep rule 8 pending.
- 2026-10-15: Finalisation request (RQ1–RQ3 fixed, workloads unchanged, "Root Value Updates" naming): define CPU process set and bounds; record trace data loss; separate GC from rendering unions; remove unsupported nonApply interpretation and bootstrap coverage claims; run-level values as main evidence; document Control and step-0 no-ops; report outliers without causal inference; verify preservation by hashes; prepare a clean committed review candidate.

## Important Implementation Instructions

- Keep benchmark scenario identical for both frameworks.
- Use the same fixed tree shape, warmup, and iteration counts for fair comparison.
- Keep test coverage for core scenario functions and runner behavior.
- Keep benchmark automation executable with npm scripts.
- Update this file for every major prompt, architecture decision, dependency change, and test strategy change.

## Decision Log

- 2026-04-16: Chose Vite + TypeScript as shared host and tooling baseline.
- 2026-04-16: Chose framework-specific adapters with one shared benchmark runner for fairness.
- 2026-04-16: Chose Vitest for both tests and benchmark runner to keep one test stack.
- 2026-04-21: Enabled Solid transform in Vitest with refresh disabled to keep `.solid.tsx` compilation active in tests.
- 2026-04-21: Added Vitest-only alias for `solid-js/web` to force the client renderer entry and avoid server-only API failures in benchmark runs.
- 2026-04-21: Added explicit jsdom environment directive in benchmark file for consistent DOM-capable benchmark execution.
- 2026-04-21: Added FAIRNESS_SPEC.md to formalize benchmark parity rules, deterministic workload requirements, and scenario-first reporting guidance.
- 2026-04-21: Added explicit AI ethics and responsible research rules to FAIRNESS_SPEC.md, including transparency, non-fabrication, parity protection, and independent verification requirements.
- 2026-07-05: Added baseline and optimized variants for React and Solid benchmark adapters, and surfaced variant as a first-class benchmark dimension.
- 2026-07-05: Added UI support for framework-variant matrix runs and aggregate JSON export for reproducible analysis.
- 2026-07-05: Added PERFORMANCE_PROTOCOL.md to align run procedure, CPU profiling workflow, and reporting strategy with thesis methodology.
- 2026-10-01: Updated measurement/export handling to retain raw warmup and measured operation records, calculate aggregates from the 25 measured records, and report condition-level CDP `TaskDuration` and named trace-event totals without describing them as CPU utilisation.
- 2026-10-11: Replaced the path picker with a lowbias32 hash; the old step multiplier (3^5 x 4541215) selected one path for every partial-subtree operation. Results before this date are not comparable.
- 2026-10-11: Solid baseline renders children through `<Index>` so immutable updates patch the DOM instead of rebuilding everything below the root.
- 2026-10-11: Chrome runner measures the production build (`vite build` + `vite preview`), reloads the page per condition, forces GC before heap snapshots, and detects environment details instead of hard-coding them.
- 2026-10-11: Multi-run aggregates pool measured latencies instead of averaging per-run percentiles; UI shows median; export drops duplicated `primaryMetrics` and renames `scenarioCount` to `conditionCount`.
- 2026-10-11: Added adapter DOM-parity/correctness tests; `context-propagation` relabelled as root update propagation (no Context API).
- 2026-10-11: Chrome runner defaults to 10 interleaved, seeded-shuffled independent suite runs (fresh page per condition) and reports per-run medians; adds `nonApplyTaskDurationMs`, GC trace events, per-event trace breakdown, observed timer resolution, and counts of latencies at or below it.
- 2026-10-11: Added a Control condition (plain DOM, ignores updates) to measure the harness floor; replaced boundary polling with a single awaited promise (polling had added main-thread work inside the measured window); reload before the traced pass; per-operation-kind medians; records show effective tree shape; runner refuses an already-occupied port to avoid measuring stale builds.
- 2026-10-11: Tree shapes are fixed per scenario (depth/breadth inputs and flags removed); raw records no longer repeat options or per-operation ops/s; added `npm run report` (summary.md/summary.csv with bootstrap CIs) and shared, unit-tested helpers in `bench/report-utils.mjs`; CLI rejects unknown flags and supports `--help`.
- 2026-10-11: Solid optimized wraps subtree updates in `batch()` so one operation propagates once, matching React's single `flushSync` render (fairness rule 5); results before this change are not comparable for subtree operations.
- 2026-10-11: `npm run report` marks timer-limited conditions (>10% of latencies at or below timer resolution) and omits their confidence intervals; the Chrome runner always stops the preview server, rejects zero run/iteration counts, and saves a partial report (`incomplete: true`) if a run fails.
- 2026-10-11: Aligned code and protocol with the thesis introduction: scenario key renamed from `context-propagation` to `root-update-propagation`; update latency is the only primary measure (`TaskDuration` is supporting); `npm run report` adds browser process-group CPU time.
- 2026-10-11: Removed the Vitest bench mode (`npm run bench`, `bench/nested-update.bench.ts`): its jsdom timings have no layout or paint and are not usable as results; correctness is covered by `npm test` and measurements by `npm run metrics:chrome`.
- 2026-10-15 (protocol 2, FAIRNESS_SPEC 2.0). Workload, tree shapes, host visibility, `flushSync` scope, and Solid per-operation `batch()` are unchanged.
  - Validation: a correctness pass in a separate Chrome launch checks every label and the tree structure after each `apply()` (before yielding) against an oracle independent of `tree.ts` update helpers, with MutationObserver counts; measurements are skipped on failure. A final-state check runs after all endpoints of each measured pass. Rationale: the previous checks were jsdom-only and final-state only.
  - Measurement (trace): window from page `performance.mark` events in the trace clock; renderer = process/thread of the start marker; events clipped to the window; renderer-main-thread union metrics remove nesting; inclusive sums kept per thread group; `PrePaint` and `Layerize` added because current Chrome emits them instead of `UpdateLayerTree`/`CompositeLayers`. Rationale: the old sum had no window boundaries, no process/thread scope, and double-counted nested events.
  - Measurement (CPU): raw endpoint samples kept; the reported value is restricted to processes present at both samples (a lower bound, labelled as such); one-sample processes kept with cumulative readings, an upper bound when defined, and lifecycle classification from the session's other samples. Rationale: the old sum added end-only processes' lifetime CPU. The 2026-10-11 outlier (Solid baseline root run 5: 1051.7 ms, browser process 786.7 ms over a 408 ms window, the only run with OnDeviceModelService and ProcessorMetrics processes present) is kept; its cause is not determined.
  - Measurement: captured-pass raw latencies kept; `nonApplyTaskDurationMs` and wall duration no longer clamped; `scriptDurationMs` dropped (0.2–2.5 ms against up to ~650 ms of apply time).
  - Provenance: git commit, status entries, tracked diff saved as `source.patch`, untracked files copied and hashed, tool versions, configuration-file hashes, served-bundle hashes, executed order (`executionLog`). Reports carry `protocolVersion: 2`; `npm run report` refuses older reports so their original summaries are not overwritten.
  - Analysis/reporting: separate across-run (median of run medians, Q1–Q3, IQR) and within-run (median, IQR, mean, p95, 1000/mean) tables; nearest-rank quantiles documented; n per table; timer-floor flags (° any, † >10%); ops/s null when the mean is 0 and labelled as reciprocal mean `apply()` latency; runs described as repeated measurements in one browser session.
  - Reporting: root scenario described as root-value updates (label "Root Value Updates"; key unchanged).
  - The 2026-10-11 raw report is unchanged. Its summary.md/summary.csv were regenerated twice during this session by intermediate generators and then regenerated with the original generator from commit 6687fcf. Their sizes match the originals (5103 and 5496 bytes), but the original bytes were not archived (no copy in git or VS Code local history), so byte identity is not established.
- 2026-10-15: First protocol-2 experiment: `bench/results/2026-10-15T12-11-24-197Z` (Chrome 155.0.8059.79; HEAD 6687fcf plus the saved `source.patch` and copied untracked `verify.ts`; 20 conditions × 10 runs; traces saved). Correctness pass 20/20; final-state checks 200/200; all 200 traces had valid markers; no process appeared or disappeared between CPU samples. Observation kept, cause not determined: 13 of 200 captured passes (including Control) had CPU above 2 × their condition's median, with GPU-process CPU of 392–507 ms; in the inspected trace the renderer main thread had one 504 ms task without traced child events in the same window as about 502 ms of GPU-process GPUTask events. Temporal overlap is not treated as a cause; GPU-process CPU is not GPU hardware execution time. Smoke outputs `2026-10-15T11-38-22-991Z` (intermediate protocol) and `2026-10-15T12-07-21-382Z` (protocol 2, one run) are not results.
- 2026-10-15 (protocol 3, FAIRNESS_SPEC 2.1). Workload unchanged.
  - Measurement (trace): tracing now uses CDP `Tracing.start`/`Tracing.end` on the page session that also samples metrics (same categories and stream transfer as Puppeteer's `page.tracing`), so `Tracing.tracingComplete.dataLossOccurred` is recorded per run ("unknown" when absent; protocol-2 reports show unknown). Rationale: Puppeteer does not expose the field.
  - Measurement: `nonApplyTaskDurationMs` and "above Control" removed; TaskDuration and summed captured `apply()` latency are reported side by side. Rationale: they cover different windows and kinds of time, so the difference cannot isolate work outside `apply()`.
  - Measurement (CPU, naming only): `upperBoundCpuTimeMs` renamed `observedProcessesUpperEstimateMs`; process set and assumptions documented (unobserved short-lived processes, no pid reuse).
  - Analysis/reporting: bootstrap intervals removed (dependent within-session repetitions); individual run medians and per-run CPU with GPU-process CPU listed in execution order; exact-zero counts; descriptive CPU flag (> 2 × condition median, nothing excluded); combined trace union renamed `rendererMainRenderingOrGcUnionMs`; scenario labels recorded and shown; summary header records the report's SHA-256; existing summaries are moved to `superseded/` instead of overwritten. `tsconfig.json` excludes `bench/results` (copied untracked sources there are not part of the build).
  - Validation: unit test for MutationObserver attribution (redundant write to an unchanged pill and a mutation outside pills are counted separately).
  - The protocol-2 run `2026-10-15T12-11-24-197Z` was re-summarised from its raw data with the protocol-3 generator; its earlier summaries are in `superseded/2026-10-15T13-19-26-041Z-*`. Smoke output `2026-10-15T13-19-39-568Z` (protocol 3, one run; `dataLossOccurred: false`) is not a result.
  - SHA-256 of preserved datasets: 2026-10-11 `chrome-metrics-report.json` e63a3d7b7853a351ab4782c738eb85f396253e58fd5b525139479fffdf1ded9e, `summary.csv` f273f956a3774d30c1002c5f88838c5277d7f50d35f2765580b19a8d05a438af, `summary.md` 6596d0dc73f165507aab2a70b2af871fb03b6715d9d90f34eba95f8b95aeaa6f; 2026-10-15T12-11-24 `chrome-metrics-report.json` 5725651b4406843010c7ce936abe11ec49318dc84cc17a98ac3c1a19bb28cfcc, `source.patch` bee504922f4956c6542222ee15283cb572dd32b5a27e8728dda00bc84c91b5b1.
- 2026-10-15: Commit 620cbbb labels the heap column as a post-GC snapshot and adds the `npm run metrics` alias (no measurement change).
- 2026-10-15: Final protocol-3 experiment `bench/results/2026-10-15T13-36-05-932Z` from clean commit 620cbbb2796c8740d1e605c61fedf1fe73a0206d (`npm run metrics -- --suiteRuns=10 --saveTraces`, then `npm run report -- bench/results/2026-10-15T13-36-05-932Z`). Chrome 155.0.8059.79 headless, Node v22.20.0, production build, crossOriginIsolated, 5 µs timer step. Correctness pass 20/20 conditions (31 checks each); 20 conditions × 10 runs = 200 runs, 30 primary and 30 captured observations each; executed order equals the planned seeded order (seed 1); final-state DOM checks 200/200; trace `dataLossOccurred` false in 200/200; valid trace markers 200/200; 200 gzipped traces. One run had process changes and the only CPU flag (> 2 × median): React optimized controlled-patterns run 5, 988.9 ms (condition runs 197–268 ms; browser process 731 ms, renderer 237 ms), with OnDeviceModelService (245 ms cumulative) and ProcessorMetrics first observed at the end sample. Kept; cause not determined. SHA-256: `chrome-metrics-report.json` 58d5bf1929fd560fe7a7818c1a4776f03fe33f13067b338e9179712f8349dcbd, `summary.md` 3e26aedd1ffc93acd5a4ddfa67ebcbbf467d0de3a08fe3f4d74954e5e83eccee, `summary.csv` b52184353bacdc78ad80b9cbe893e22af9fcf2177aa47afcf75394f7ded6c010. Independent verification (AI rule 8): pending.

## Operating Protocol For Future Updates

1. Add each important user prompt under "Important Prompts Log" with date.
2. Record AI model/agent changes under "AI Assistance".
3. Document architecture changes under "Decision Log" with rationale.
4. Ensure every benchmark change has matching test updates.
5. Keep entries concise, factual, and time-ordered.
