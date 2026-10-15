# Nested UI Benchmark Fairness Specification

Version 2.1 (2026-10-15), matching report `protocolVersion: 3`. See the version history at the end.

Independent verification under AI rule 8 for version 2.1: **pending** (no non-author human verification has taken place yet; AI review does not count).

## Purpose

Define a strict, reproducible protocol for comparing framework behavior on nested UI workloads, inspired by the fairness philosophy of js-framework-benchmark but scoped to deep tree updates.

## Scope

This specification applies to all benchmark adapters and scenario runs in this repository.

In scope:

- Deeply nested tree update performance
- Deterministic operation schedules
- Cross-framework comparability for identical workloads
- Descriptive supporting metrics: post-GC JavaScript heap snapshots and garbage-collection trace time

Out of scope:

- Startup and bundle size ranking
- Allocation-level memory profiling and causal garbage-collector attribution
- Network or server rendering performance

## AI Ethics and Responsible Research Rules

1. Human accountability:
   AI assistance can be used for drafting code, tests, and documentation, but a human maintainer is responsible for review, approval, and publication decisions.

2. Reproducibility over claims:
   AI-generated conclusions must not be treated as evidence on their own. Any comparative claim must be backed by reproducible benchmark runs and raw outputs.

3. No fabricated or selective reporting:
   Do not invent benchmark numbers, omit unfavorable scenario results, or cherry-pick runs without disclosure. Report scenario-level outcomes for both frameworks.

4. Transparency of AI use:
   Major AI-assisted design decisions, methodology changes, and protocol updates must be recorded in CONTEXT.md.

5. Fairness preservation:
   AI-suggested optimizations must not violate parity constraints in this specification. Any optimization must be available to all framework adapters under equivalent rules.

6. Privacy and data minimization:
   Do not include secrets, personal data, or proprietary benchmark inputs in prompts or committed artifacts.

7. Safety and respectful communication:
   Documentation and outputs must avoid deceptive, discriminatory, or harmful language and should present limitations and uncertainty clearly.

8. Independent verification:
   Before publication, at least one maintainer who did not author the AI-assisted change should verify that methodology, code, and reported results match this specification.

## Core Fairness Rules

1. Same workload schedule across frameworks:
   Each framework must execute the same ordered list of operations for a given scenario.

2. Same tree topology for a scenario:
   Each scenario has one fixed depth and breadth, identical for all frameworks.

3. Same operation semantics:

- point operation: update one node value at a path.
- subtree operation: apply a delta to all nodes in a subtree rooted at a path.

4. Same warmup and measured iterations:
   Each condition uses 5 warmup operations excluded from timing, followed by 25 measured operations timed one-by-one using the same timer source.

5. Same host conditions:
   All adapters mount into an offscreen host and are disposed after each scenario.

6. No scenario-specific shortcuts:
   Adapter code must not hardcode optimization branches keyed by scenario name or known path constants.

7. No semantic degradation:
   Adapters must preserve update correctness. A faster adapter that skips required updates is invalid.

## Adapter Contract

Each adapter must implement:

- mount(container, initialTree) -> mounted handle
- mounted.apply(operation)
- mounted.dispose()

The apply method must interpret operations exactly as defined in this spec. Implementations may use framework-idiomatic APIs but cannot alter operation meaning.

The Control adapter is the only exception: it mounts the same markup with plain DOM (the initial tree) and its `apply()` ignores the operation it receives. It receives the identical schedule, so its DOM must show the initial tree after every operation. It is never compared as a framework; it shows the harness floor.

## Scenario Definitions

The benchmark suite currently includes four scenarios.

1. deep-leaf-updates:

- Target: recursion depth stress
- Shape: depth 100, breadth 1
- Operation mix: point updates on the deepest leaf

2. root-update-propagation (key kept for data continuity; displayed as "Root Value Updates"):

- Target: repeated root-value updates within a nested tree (no framework Context API is used)
- Shape: depth 7, breadth 3
- Operation mix: point updates at root path
- Semantics: each operation changes one model value, the root's, so only the root's displayed label changes; no descendant value changes. Whether descendant components or computations re-execute is an implementation property (React baseline re-renders every component; React optimized, Solid baseline, and Solid optimized do not). The scenario does not propagate changed values through descendants.

3. partial-subtree-invalidation:

- Target: selective branch invalidation cost
- Shape: depth 8, breadth 3
- Operation mix: subtree updates at deterministic mid-depth paths

4. controlled-patterns:

- Target: mixed real-world style workload
- Shape: depth 7, breadth 3
- Operation mix: deterministic blend of root point, leaf point, internal point, and subtree operations

## Determinism Requirements

Path selection must be deterministic. Any pseudo-random-like path selection must be seeded and formula-stable so runs are reproducible. The runner hashes `(seed, step)` with a 32-bit integer mixer (lowbias32) and takes the result modulo the pool size; tests assert that subtree paths are spread across the pool.

## Measurement Protocol

0. Correctness pass (before any measurement, separate browser launch with the same served bundle and browser flags): for every condition, mount the initial tree in an offscreen host and, after each `apply()` returns and before yielding, compare every rendered label and the tree-node level sequence with an oracle that does not use the adapters' update helpers. Any failure stops the experiment before measurements.
1. Build scenario tree.
2. Mount adapter.
3. Execute warmup operations.
4. For each measured operation:

- record start time
- apply operation
- record end time
- store duration

5. Compute metrics:

- totalMs
- meanMs
- medianMs
- iqrMs
- p95Ms
- opsPerSecond (1000 / meanMs; null when meanMs is 0, i.e. every latency is below the timer resolution)

6. After every latency, CPU, trace-window, and heap endpoint of the pass, verify that the rendered node labels match the oracle after the full schedule (Control: the initial tree) and record the result as `domMatchesModel`.
7. Dispose adapter and remove host.

## Reporting Protocol

Report results by framework, variant, and scenario; never collapse them into a single score or overall framework ranking.

Minimum table columns:

- scenario
- framework
- variant
- medianMs
- iqrMs
- meanMs
- p95Ms
- opsPerSecond

Within-run statistics (computed from the 25 measured latencies of one run) and across-run statistics (computed from one value per run) are reported in separate tables. The main descriptive evidence is the run-level median latency: the median of run medians, the nearest-rank Q1–Q3 and IQR of the run medians, and every individual run median in execution order. The within-run table gives medianMs, iqrMs, meanMs, p95Ms, and opsPerSecond, each summarised by the median across runs; opsPerSecond is the reciprocal of the mean synchronous `apply()` latency, a derived statistic and not measured application throughput. Quantiles are nearest-rank (index `ceil(p·n) − 1`); for an even n this is the lower median. No confidence intervals are reported, because runs are dependent repetitions within one browser session. No speedup ratios are computed; values at the timer floor are flagged and zero observations are kept. Every table states its n. Each report records the source commit, working-tree changes (with the tracked diff and untracked files), tool versions, configuration-file hashes, hashes of the served bundle, scenario labels, and the executed condition order.

## Validity Threats and Guardrails

1. JIT warmup variance:

- Use the configured warmup operations and retain raw records for every repeated run.
- Repeated runs share one browser session (fresh page load per pass), so they are repeated measurements, not independent samples.

2. Event loop interference:

- Keep benchmark host isolated and avoid unrelated UI work during runs.

3. Adapter drift:

- Keep adapter APIs minimal and symmetric.
- Review adapter diffs for behavior parity after every change.

4. Regression masking:

- Maintain tests for tree helpers, scenario exposure, and runner behavior.
- Tests apply every scenario schedule to all adapters and assert, after each operation, identical, correct rendered node labels and structure against the oracle (rule 7).
- The Chrome runner repeats the per-operation check in the browser before measuring (correctness pass) and a final-state check after every measured pass (`domMatchesModel`); `npm run report` shows both.

## Independent Verification Package (AI rule 8)

A maintainer who did not author the AI-assisted changes needs: this specification and PERFORMANCE_PROTOCOL.md; CONTEXT.md (decision log and AI use); the review-candidate commit and `git diff` against `6687fcf`; `npm test` output; the final report folder (`chrome-metrics-report.json`, `summary.md`, `summary.csv`, gzipped traces, `source.patch` if any); the earlier datasets with their SHA-256 values in CONTEXT.md; and the open issues listed there. The verifier records name, date, revision, and outcome in CONTEXT.md; until then this verification is pending.

## Change Control

Any change to scenario semantics, operation definitions, or measurement formulas requires:

1. Update this specification.
2. Update benchmark runner and tests.
3. Add an entry to CONTEXT.md decision log with date and rationale.

## Version History

- 2.1 (2026-10-15, protocol 3): Workload unchanged. Tracing runs on the page CDP session that also samples metrics, recording `Tracing.tracingComplete.dataLossOccurred` (or "unknown"). CPU observed-process estimate renamed and documented as not an upper bound on all browser CPU. `nonApplyTaskDurationMs` and "above Control" removed (subtraction across different windows). Bootstrap intervals removed. Reports add individual run medians, exact-zero counts, per-run CPU with GPU-process CPU, scenario labels, and preserve earlier summaries in `superseded/`.
- 2.0 (2026-10-15): Workload, tree shapes, host visibility, `flushSync` scope, and Solid per-operation `batch()` unchanged. Added the in-browser per-operation correctness pass and oracle; post-endpoint final-state check; trace window from page markers with renderer-main-thread union metrics; CPU restricted to processes present at both samples with raw endpoints and lifecycle flags; captured-pass raw latencies kept; provenance (diff, untracked files, configuration and served-bundle hashes); separate within-run and across-run tables; `opsPerSecond` null when the mean is 0; `scriptDurationMs` dropped. Root scenario described as root-value updates. Reports from version 1.x (protocol 1) are not comparable for CPU and trace metrics and are not re-summarised.
- 1.x (until 2026-10-11): previous protocol.
