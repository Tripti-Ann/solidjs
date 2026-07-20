# CONTEXT

## Project Goal

Build and maintain a reproducible benchmark application that compares SolidJS and React performance for deeply nested UI updates.

## AI Assistance

- Edits and suggestions have been assisted by an automated coding agent; all changes are reviewed by project maintainers.

## Environment Note

- This repository is developed and tested on developer machines; do not rely on recorded local paths or environment-specific details in this file.

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

## Important Implementation Instructions

- Keep benchmark scenario identical for both frameworks.
- Use the same tree depth, breadth, warmup, and iteration counts for fair comparison.
- Keep test coverage for core scenario functions and runner behavior.
- Keep benchmark automation executable with npm scripts and Vitest bench mode.
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

## Operating Protocol For Future Updates

1. Add each important user prompt under "Important Prompts Log" with date.
2. Record AI model/agent changes immediately under "AI Agent and Model".
3. Document architecture changes under "Decision Log" with rationale.
4. Ensure every benchmark change has matching test updates.
5. Keep entries concise, factual, and time-ordered.
