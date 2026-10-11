# CONTEXT

## Project Goal

Build and maintain a reproducible benchmark application that compares SolidJS and React performance for deeply nested UI updates.

## AI Assistance

- Edits and suggestions have been assisted by an automated coding agent; all changes are reviewed by project maintainers.

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

## Operating Protocol For Future Updates

1. Add each important user prompt under "Important Prompts Log" with date.
2. Record AI model/agent changes under "AI Assistance".
3. Document architecture changes under "Decision Log" with rationale.
4. Ensure every benchmark change has matching test updates.
5. Keep entries concise, factual, and time-ordered.
