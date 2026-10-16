import { describe, expect, it } from "vitest";
import {
  createScenario,
  getNestedBenchmarkScenarios,
  runNestedResearchSuite,
  summarizeLatencies,
} from "../src/benchmark/runner";
import { applyOperation, createTree } from "../src/benchmark/tree";
import {
  createOracle,
  expectedFinalLabels,
  renderedLabelsMatch,
  verifyScenario,
} from "../src/benchmark/verify";
import type {
  BenchmarkAdapter,
  BenchmarkVariant,
  FrameworkName,
} from "../src/benchmark/types";
import { adapters, controlAdapter } from "../src/frameworks/adapters";

function adapterFor(
  framework: FrameworkName,
  variant: BenchmarkVariant,
): BenchmarkAdapter {
  const adapter = adapters.find(
    (entry) => entry.framework === framework && entry.variant === variant,
  );
  if (!adapter) {
    throw new Error(`No adapter for ${framework} ${variant}`);
  }
  return adapter;
}

const reactBaseline = adapterFor("React", "baseline");
const solidBaseline = adapterFor("Solid", "baseline");

const thesisOptions = {
  warmupIterations: 5,
  iterations: 25,
};

describe("nested update benchmark runner", () => {
  it.each(getNestedBenchmarkScenarios().map((scenario) => scenario.key))(
    "every adapter shows the oracle's labels after each operation of the %s schedule",
    (scenarioKey) => {
      const { root, schedule } = createScenario(scenarioKey, thesisOptions);

      for (const adapter of [...adapters, controlAdapter]) {
        const result = verifyScenario(adapter, scenarioKey, root, schedule);
        const failed = result.steps.find(
          (step) => !step.labelsMatch || !step.structureMatches,
        );

        expect(
          failed,
          `${adapter.framework} ${adapter.variant}`,
        ).toBeUndefined();
        expect(result.steps).toHaveLength(schedule.length + 1);
      }
    },
    120_000,
  );

  it("derives expected labels independently of the adapters' update helpers", () => {
    const root = createTree(2, 2);
    const oracle = createOracle(root);
    oracle.apply({ kind: "point", path: [], nextValue: 7 });
    oracle.apply({ kind: "subtree", path: [1], nextValue: 3 });

    expect(oracle.labels()).toEqual([
      "#0: 7",
      "#1: 0",
      "#2: 0",
      "#3: 0",
      "#4: 3",
      "#5: 3",
      "#6: 3",
    ]);
    expect(oracle.levels).toEqual([0, 1, 2, 2, 1, 2, 2]);
    const { schedule } = createScenario("controlled-patterns", thesisOptions);
    const tree = createTree(7, 3);
    expect(expectedFinalLabels(reactBaseline, tree, schedule)).toEqual(
      createOracle(schedule.reduce(applyOperation, tree)).labels(),
    );
  });

  it("root updates change only the root label in every variant", () => {
    const { root, schedule } = createScenario(
      "root-update-propagation",
      thesisOptions,
    );

    for (const adapter of adapters) {
      const [, ...operations] = verifyScenario(
        adapter,
        "root-update-propagation",
        root,
        schedule,
      ).steps;

      // Step 1 sets the root from 0 to 0, so no label changes.
      expect(operations.map((step) => step.changedLabels)).toEqual(
        schedule.map((_, index) => (index === 0 ? 0 : 1)),
      );
      expect(
        operations.every((step) => step.unchangedPillsMutated === 0),
        `${adapter.framework} ${adapter.variant}`,
      ).toBe(true);
    }
  }, 60_000);

  it("detects an adapter that skips subtree updates", () => {
    const { root, schedule } = createScenario(
      "partial-subtree-invalidation",
      thesisOptions,
    );
    const broken: BenchmarkAdapter = {
      ...reactBaseline,
      mount(container, initialTree) {
        const mounted = reactBaseline.mount(container, initialTree);
        return {
          apply: (operation) =>
            operation.kind === "point" ? mounted.apply(operation) : undefined,
          dispose: mounted.dispose,
        };
      },
    };

    const result = verifyScenario(
      broken,
      "partial-subtree-invalidation",
      root,
      schedule,
    );

    expect(result.passed).toBe(false);
    expect(result.steps[1].firstMismatch).not.toBeNull();
  });

  it("attributes DOM mutations to the pill they touch", () => {
    const { root, schedule } = createScenario(
      "deep-leaf-updates",
      thesisOptions,
    );
    // Writes the expected update plus one redundant write to the root pill and one outside any pill.
    const noisy: BenchmarkAdapter = {
      ...reactBaseline,
      mount(container, initialTree) {
        const mounted = reactBaseline.mount(container, initialTree);
        return {
          apply(operation) {
            mounted.apply(operation);
            const rootPill = container.querySelector(".node-pill")!;
            rootPill.firstChild!.textContent = rootPill.firstChild!.textContent;
            container.firstElementChild!.setAttribute("data-noise", "1");
          },
          dispose: mounted.dispose,
        };
      },
    };

    const step = verifyScenario(noisy, "deep-leaf-updates", root, schedule)
      .steps[2];

    expect(step).toMatchObject({
      labelsMatch: true,
      changedLabels: 1,
      mutatedPills: 2,
      unchangedPillsMutated: 1,
      mutationsOutsidePills: 1,
    });
  });

  it("control adapter renders the same markup and ignores updates", () => {
    const { root, schedule } = createScenario(
      "controlled-patterns",
      thesisOptions,
    );
    const host = document.createElement("div");
    const mounted = controlAdapter.mount(host, root);
    schedule.forEach((operation) => mounted.apply(operation));

    expect(
      renderedLabelsMatch(
        host,
        expectedFinalLabels(controlAdapter, root, schedule),
      ),
    ).toBe(true);
    expect(
      renderedLabelsMatch(
        host,
        expectedFinalLabels(reactBaseline, root, schedule),
      ),
    ).toBe(false);
    mounted.dispose();
    expect(host.childElementCount).toBe(0);
  });

  it("spreads deterministic path selection across the pool", () => {
    const pathKeys = (
      key: "partial-subtree-invalidation" | "controlled-patterns",
    ) =>
      new Set(
        createScenario(key, thesisOptions)
          .schedule.filter((operation) => operation.kind === "subtree")
          .map((operation) => operation.path.join(".")),
      ).size;

    expect(pathKeys("partial-subtree-invalidation")).toBeGreaterThan(15);
    expect(pathKeys("controlled-patterns")).toBeGreaterThan(4);
    expect(
      createScenario("controlled-patterns", thesisOptions).schedule,
    ).toEqual(createScenario("controlled-patterns", thesisOptions).schedule);
  });

  it("summarizes latencies with nearest-rank percentiles", () => {
    const summary = summarizeLatencies([4, 1, 3, 2]);

    expect(summary).toEqual({
      totalMs: 10,
      meanMs: 2.5,
      medianMs: 2,
      q1Ms: 1,
      q3Ms: 3,
      iqrMs: 2,
      p95Ms: 4,
      opsPerSecond: 400,
    });
    expect(summarizeLatencies([0, 0]).opsPerSecond).toBeNull();
  });

  it("exposes expected research scenarios", () => {
    const scenarios = getNestedBenchmarkScenarios();

    expect(
      scenarios.map(({ key, depth, breadth }) => [key, depth, breadth]),
    ).toEqual([
      ["deep-leaf-updates", 100, 1],
      ["root-update-propagation", 7, 3],
      ["partial-subtree-invalidation", 8, 3],
      ["controlled-patterns", 7, 3],
    ]);
  });

  it.each(adapters)(
    "runs a selected scenario and keeps warm-up and measured records for $framework $variant",
    async (adapter) => {
      const [result] = await runNestedResearchSuite(adapter, thesisOptions, [
        "deep-leaf-updates",
      ]);
      const measured = result.measurements.filter(
        (measurement) => measurement.phase === "measured",
      );

      expect(result).toMatchObject({
        framework: adapter.framework,
        variant: adapter.variant,
        scenario: "deep-leaf-updates",
      });
      expect(result.measurements).toHaveLength(30);
      expect(measured).toHaveLength(25);
      expect(result.meanMs).toBeGreaterThanOrEqual(0);
      expect(result.domMatchesModel).toBe(true);
    },
  );

  it("verifies the Control DOM against the initial tree", async () => {
    const [result] = await runNestedResearchSuite(
      controlAdapter,
      thesisOptions,
      ["controlled-patterns"],
    );

    expect(result.domMatchesModel).toBe(true);
  });

  it("calls external measurement hooks after warmup and measured operations", async () => {
    const phases: string[] = [];

    await runNestedResearchSuite(
      solidBaseline,
      thesisOptions,
      ["deep-leaf-updates"],
      {
        onAfterWarmup: () => {
          phases.push("after-warmup");
        },
        onAfterMeasured: () => {
          phases.push("after-measured");
        },
      },
    );

    expect(phases).toEqual(["after-warmup", "after-measured"]);
  });

  it("keeps a visual preview host mounted when visual mode is enabled", async () => {
    const previewHost = document.createElement("div");
    document.body.appendChild(previewHost);

    await runNestedResearchSuite(
      reactBaseline,
      { warmupIterations: 1, iterations: 1 },
      ["controlled-patterns"],
      {
        visualMode: true,
        visualHostParent: previewHost,
      },
    );

    const mountedHost = previewHost.querySelector(".bench-host");
    expect(mountedHost).not.toBeNull();
    expect(mountedHost?.classList.contains("bench-host--visible")).toBe(true);

    previewHost.remove();
  });
});
