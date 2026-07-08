import { describe, expect, it } from "vitest";
import {
  getNestedBenchmarkScenarios,
  runNestedResearchSuite,
  runNestedUpdateBenchmark,
} from "../src/benchmark/runner";
import {
  mountReactTree,
  mountReactTreeOptimized,
} from "../src/frameworks/reactTree.react";
import {
  mountSolidTree,
  mountSolidTreeOptimized,
} from "../src/frameworks/solidTree.solid";

describe("nested update benchmark runner", () => {
  it("exposes expected research scenarios", () => {
    const scenarios = getNestedBenchmarkScenarios();

    expect(scenarios.map((scenario) => scenario.key)).toEqual([
      "deep-leaf-updates",
      "context-propagation",
      "partial-subtree-invalidation",
      "controlled-patterns",
    ]);
  });

  it("runs a single selected scenario for React", () => {
    const results = runNestedResearchSuite(
      {
        framework: "React",
        variant: "baseline",
        mount: mountReactTree,
      },
      {
        depth: 2,
        breadth: 1,
        warmupIterations: 1,
        iterations: 2,
      },
      ["deep-leaf-updates"],
    );

    expect(results).toHaveLength(1);
    expect(results[0].scenario).toBe("deep-leaf-updates");
    expect(results[0].framework).toBe("React");
    expect(results[0].variant).toBe("baseline");
    expect(results[0].opsPerSecond).toBeGreaterThanOrEqual(0);
  });

  it("produces metrics for React", () => {
    const result = runNestedUpdateBenchmark(
      {
        framework: "React",
        variant: "baseline",
        mount: mountReactTree,
      },
      {
        depth: 2,
        breadth: 2,
        warmupIterations: 1,
        iterations: 2,
      },
    );

    expect(result.framework).toBe("React");
    expect(result.variant).toBe("baseline");
    expect(result.scenario).toBe("controlled-patterns");
    expect(result.meanMs).toBeGreaterThanOrEqual(0);
    expect(result.opsPerSecond).toBeGreaterThanOrEqual(0);
  });

  it("produces metrics for Solid", () => {
    const result = runNestedUpdateBenchmark(
      {
        framework: "Solid",
        variant: "baseline",
        mount: mountSolidTree,
      },
      {
        depth: 2,
        breadth: 2,
        warmupIterations: 1,
        iterations: 2,
      },
    );

    expect(result.framework).toBe("Solid");
    expect(result.variant).toBe("baseline");
    expect(result.scenario).toBe("controlled-patterns");
    expect(result.meanMs).toBeGreaterThanOrEqual(0);
    expect(result.opsPerSecond).toBeGreaterThanOrEqual(0);
  });

  it("produces metrics for optimized variants", () => {
    const reactOptimized = runNestedUpdateBenchmark(
      {
        framework: "React",
        variant: "optimized",
        mount: mountReactTreeOptimized,
      },
      {
        depth: 2,
        breadth: 2,
        warmupIterations: 1,
        iterations: 2,
      },
    );

    const solidOptimized = runNestedUpdateBenchmark(
      {
        framework: "Solid",
        variant: "optimized",
        mount: mountSolidTreeOptimized,
      },
      {
        depth: 2,
        breadth: 2,
        warmupIterations: 1,
        iterations: 2,
      },
    );

    expect(reactOptimized.variant).toBe("optimized");
    expect(solidOptimized.variant).toBe("optimized");
    expect(reactOptimized.meanMs).toBeGreaterThanOrEqual(0);
    expect(solidOptimized.meanMs).toBeGreaterThanOrEqual(0);
  });
});
