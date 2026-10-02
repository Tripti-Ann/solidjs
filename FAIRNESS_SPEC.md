# Nested UI Benchmark Fairness Specification

## Purpose

Define a strict, reproducible protocol for comparing framework behavior on nested UI workloads, inspired by the fairness philosophy of js-framework-benchmark but scoped to deep tree updates.

## Scope

This specification applies to all benchmark adapters and scenario runs in this repository.

In scope:

- Deeply nested tree update performance
- Deterministic operation schedules
- Cross-framework comparability for identical workloads

Out of scope:

- Startup and bundle size ranking
- Memory profiling and garbage collector attribution
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
   Scenario-specific depth and breadth must be identical for all frameworks within the same run.

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

## Scenario Definitions

The benchmark suite currently includes four scenarios.

1. deep-leaf-updates:

- Target: recursion depth stress
- Shape: depth >= 100, breadth = 1
- Operation mix: point updates on the deepest leaf

2. context-propagation:

- Target: top-down invalidation pressure
- Shape: depth >= 7, breadth >= 3
- Operation mix: point updates at root path

3. partial-subtree-invalidation:

- Target: selective branch invalidation cost
- Shape: depth >= 8, breadth >= 3
- Operation mix: subtree updates at deterministic mid-depth paths

4. controlled-patterns:

- Target: mixed real-world style workload
- Shape: depth >= 7, breadth >= 3
- Operation mix: deterministic blend of root point, leaf point, internal point, and subtree operations

## Determinism Requirements

Path selection must be deterministic. Any pseudo-random-like path selection must be seeded and formula-stable so runs are reproducible.

## Measurement Protocol

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
- opsPerSecond

6. Dispose adapter and remove host.

## Reporting Protocol

Report results by framework and scenario, never only a single aggregate score.

Minimum table columns:

- scenario
- framework
- variant
- medianMs
- iqrMs
- meanMs
- p95Ms
- opsPerSecond

Do not collapse results into an overall framework ranking; report scenario-level results for every framework and variant.

## Validity Threats and Guardrails

1. JIT warmup variance:

- Use the configured warmup operations and retain raw records for every independent run.

2. Event loop interference:

- Keep benchmark host isolated and avoid unrelated UI work during runs.

3. Adapter drift:

- Keep adapter APIs minimal and symmetric.
- Review adapter diffs for behavior parity after every change.

4. Regression masking:

- Maintain tests for tree helpers, scenario exposure, and runner behavior.

## Change Control

Any change to scenario semantics, operation definitions, or measurement formulas requires:

1. Update this specification.
2. Update benchmark runner and tests.
3. Add an entry to CONTEXT.md decision log with date and rationale.
