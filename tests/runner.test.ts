import { describe, expect, it } from "vitest";
import {
  createScenario,
  getNestedBenchmarkScenarios,
  runNestedResearchSuite,
  summarizeLatencies,
} from "../src/benchmark/runner";
import { applyOperation } from "../src/benchmark/tree";
import type {
  BenchmarkAdapter,
  BenchmarkVariant,
  FrameworkName,
  TreeNode,
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

function expectedLabels(node: TreeNode): string[] {
  return [
    `#${node.id}: ${node.value}`,
    ...node.children.flatMap(expectedLabels),
  ];
}

function renderedLabels(host: HTMLElement): Array<string | null> {
  return [...host.querySelectorAll(".node-pill")].map(
    (pill) => pill.textContent,
  );
}

describe("nested update benchmark runner", () => {
  it.each(getNestedBenchmarkScenarios().map((scenario) => scenario.key))(
    "all adapters render the same, correct tree after the %s schedule",
    (scenarioKey) => {
      const { root, schedule } = createScenario(scenarioKey, thesisOptions);
      const expected = expectedLabels(schedule.reduce(applyOperation, root));

      for (const adapter of adapters) {
        const host = document.createElement("div");
        const mounted = adapter.mount(host, root);
        schedule.forEach((operation) => mounted.apply(operation));
        const rendered = renderedLabels(host);
        mounted.dispose();

        expect(rendered, `${adapter.framework} ${adapter.variant}`).toEqual(
          expected,
        );
      }
    },
    60_000,
  );

  it("control adapter renders the same markup and ignores updates", () => {
    const { root, schedule } = createScenario(
      "controlled-patterns",
      thesisOptions,
    );
    const host = document.createElement("div");
    const mounted = controlAdapter.mount(host, root);
    schedule.forEach((operation) => mounted.apply(operation));

    expect(renderedLabels(host)).toEqual(expectedLabels(root));
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
    },
  );

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
