import {
  createTree,
  getInternalPaths,
  getLeafPaths,
  pathsAtDepth,
} from "./tree";
import type {
  BenchmarkOperation,
  BenchmarkOptions,
  BenchmarkResult,
  BenchmarkScenarioKey,
  BenchmarkVariant,
  FrameworkName,
  TreeNode,
  TreePath,
} from "./types";

interface MountedTree {
  apply(operation: BenchmarkOperation): void;
  dispose(): void;
}

export interface BenchmarkAdapter {
  framework: FrameworkName;
  variant: BenchmarkVariant;
  mount(container: HTMLElement, initialTree: TreeNode): MountedTree;
}

export interface BenchmarkRuntimeOptions {
  visualMode?: boolean;
  visualHostParent?: HTMLElement;
  captureMetrics?: boolean;
  onAfterWarmup?: () => Promise<void> | void;
  onAfterMeasured?: () => Promise<void> | void;
}

const defaultOptions: BenchmarkOptions = {
  depth: 6,
  breadth: 3,
  warmupIterations: 5,
  iterations: 25,
};

interface ScenarioDefinition {
  key: BenchmarkScenarioKey;
  label: string;
  depth: (options: BenchmarkOptions) => number;
  breadth: (options: BenchmarkOptions) => number;
  schedule: (
    root: TreeNode,
    options: BenchmarkOptions,
    totalOperations: number,
  ) => BenchmarkOperation[];
}

function makeDeterministicIndex(
  count: number,
  seed: number,
  step: number,
): number {
  if (count <= 1) {
    return 0;
  }

  return Math.abs((seed * 1664525 + 1013904223 + step * 1103515245) % count);
}

function choosePath(pool: TreePath[], seed: number, step: number): TreePath {
  if (pool.length === 0) {
    return [];
  }

  return pool[makeDeterministicIndex(pool.length, seed, step)];
}

const scenarioDefinitions: Record<BenchmarkScenarioKey, ScenarioDefinition> = {
  "deep-leaf-updates": {
    key: "deep-leaf-updates",
    label: "Deep Tree Updates",
    depth: (options) => Math.max(options.depth, 100),
    breadth: () => 1,
    schedule: (root, _options, totalOperations) => {
      const leaves = getLeafPaths(root);
      const leaf = leaves[0] ?? [];
      return Array.from({ length: totalOperations }, (_, step) => ({
        kind: "point",
        path: leaf,
        nextValue: step,
      }));
    },
  },
  "context-propagation": {
    key: "context-propagation",
    label: "Context Propagation Stress",
    depth: (options) => Math.max(options.depth, 7),
    breadth: (options) => Math.max(options.breadth, 3),
    schedule: (_root, _options, totalOperations) =>
      Array.from({ length: totalOperations }, (_, step) => ({
        kind: "point",
        path: [],
        nextValue: step,
      })),
  },
  "partial-subtree-invalidation": {
    key: "partial-subtree-invalidation",
    label: "Partial Subtree Invalidation",
    depth: (options) => Math.max(options.depth, 8),
    breadth: (options) => Math.max(options.breadth, 3),
    schedule: (root, options, totalOperations) => {
      const midDepth = Math.max(2, Math.floor(Math.max(options.depth, 8) / 2));
      const pool = pathsAtDepth(root, midDepth);
      return Array.from({ length: totalOperations }, (_, step) => ({
        kind: "subtree",
        path: choosePath(pool, 31, step),
        nextValue: 1,
      }));
    },
  },
  "controlled-patterns": {
    key: "controlled-patterns",
    label: "Controlled Update Patterns",
    depth: (options) => Math.max(options.depth, 7),
    breadth: (options) => Math.max(options.breadth, 3),
    schedule: (root, options, totalOperations) => {
      const depth = Math.max(options.depth, 7);
      const leaves = getLeafPaths(root);
      const internals = getInternalPaths(root).filter(
        (path) => path.length > 0,
      );
      const midPool = pathsAtDepth(root, Math.max(2, Math.floor(depth / 2)));

      return Array.from({ length: totalOperations }, (_, step) => {
        const phase = step % 8;

        if (phase === 0) {
          return { kind: "point", path: [], nextValue: step };
        }

        if (phase === 1 || phase === 2 || phase === 5) {
          return {
            kind: "point",
            path: choosePath(leaves, 97, step),
            nextValue: step,
          };
        }

        if (phase === 3 || phase === 6) {
          return {
            kind: "subtree",
            path: choosePath(midPool, 53, step),
            nextValue: 1,
          };
        }

        return {
          kind: "point",
          path: choosePath(internals, 211, step),
          nextValue: step,
        };
      });
    },
  },
};

function percentile(values: number[], rank: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = Math.ceil(rank * sorted.length) - 1;
  const index = Math.max(0, Math.min(sorted.length - 1, rawIndex));
  return sorted[index];
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function runScenario(
  adapter: BenchmarkAdapter,
  scenarioKey: BenchmarkScenarioKey,
  options: BenchmarkOptions,
  runtimeOptions: BenchmarkRuntimeOptions,
): Promise<BenchmarkResult> {
  const definition = scenarioDefinitions[scenarioKey];
  const scenarioDepth = definition.depth(options);
  const scenarioBreadth = definition.breadth(options);

  const root = createTree(scenarioDepth, scenarioBreadth);
  const host = document.createElement("div");
  host.className = runtimeOptions.visualMode
    ? "bench-host bench-host--visible"
    : "bench-host";
  host.dataset.framework = adapter.framework;
  host.dataset.scenario = scenarioKey;

  const shouldKeepPreview = Boolean(
    runtimeOptions.visualMode && runtimeOptions.visualHostParent,
  );
  const hostParent = runtimeOptions.visualHostParent ?? document.body;
  if (shouldKeepPreview) {
    runtimeOptions.visualHostParent!.innerHTML = "";
  }
  hostParent.append(host);

  const mounted = adapter.mount(host, root);
  const totalOperations = options.warmupIterations + options.iterations;
  const schedule = definition.schedule(root, options, totalOperations);
  const resolvedOptions = {
    ...options,
    depth: scenarioDepth,
    breadth: scenarioBreadth,
  };
  const measurements: BenchmarkResult["measurements"] = [];

  for (let i = 0; i < options.warmupIterations; i += 1) {
    const start = performance.now();
    mounted.apply(schedule[i]);
    const updateLatencyMs = performance.now() - start;
    measurements.push({
      framework: adapter.framework,
      variant: adapter.variant,
      scenario: scenarioKey,
      iteration: i + 1,
      phase: "warmup",
      timestamp: new Date().toISOString(),
      options: resolvedOptions,
      operationKind: schedule[i].kind,
      updateLatencyMs,
      operationsPerSecond: updateLatencyMs > 0 ? 1000 / updateLatencyMs : 0,
    });
  }

  await runtimeOptions.onAfterWarmup?.();

  const iterationDurations: number[] = [];
  const shouldCaptureMetrics = Boolean(runtimeOptions.captureMetrics);

  for (let i = options.warmupIterations; i < schedule.length; i += 1) {
    const start = performance.now();
    mounted.apply(schedule[i]);
    const applyEnd = performance.now();
    iterationDurations.push(applyEnd - start);

    if (shouldCaptureMetrics) {
      await nextFrame();
    }

    measurements.push({
      framework: adapter.framework,
      variant: adapter.variant,
      scenario: scenarioKey,
      iteration: i + 1,
      phase: "measured",
      timestamp: new Date().toISOString(),
      options: resolvedOptions,
      operationKind: schedule[i].kind,
      updateLatencyMs: applyEnd - start,
      operationsPerSecond: applyEnd > start ? 1000 / (applyEnd - start) : 0,
    });
  }

  await runtimeOptions.onAfterMeasured?.();

  const totalMs = iterationDurations.reduce((sum, value) => sum + value, 0);
  const meanMs = totalMs / iterationDurations.length;
  const q1Ms = percentile(iterationDurations, 0.25);
  const medianMs = percentile(iterationDurations, 0.5);
  const q3Ms = percentile(iterationDurations, 0.75);
  const iqrMs = q3Ms - q1Ms;
  const p95Ms = percentile(iterationDurations, 0.95);
  const opsPerSecond = meanMs > 0 ? 1000 / meanMs : 0;

  if (!shouldKeepPreview) {
    mounted.dispose();
    host.remove();
  }

  return {
    framework: adapter.framework,
    variant: adapter.variant,
    scenario: scenarioKey,
    options: resolvedOptions,
    measurements,
    totalMs,
    meanMs,
    medianMs,
    q1Ms,
    q3Ms,
    iqrMs,
    p95Ms,
    opsPerSecond,
  };
}

export function getNestedBenchmarkScenarios(): Array<{
  key: BenchmarkScenarioKey;
  label: string;
}> {
  return Object.values(scenarioDefinitions).map((scenario) => ({
    key: scenario.key,
    label: scenario.label,
  }));
}

export async function runNestedResearchSuite(
  adapter: BenchmarkAdapter,
  options: Partial<BenchmarkOptions> = {},
  scenarios?: BenchmarkScenarioKey[],
  runtimeOptions: BenchmarkRuntimeOptions = {},
): Promise<BenchmarkResult[]> {
  const resolved = { ...defaultOptions, ...options };
  const activeScenarios =
    scenarios ?? (Object.keys(scenarioDefinitions) as BenchmarkScenarioKey[]);

  const results: BenchmarkResult[] = [];
  for (const scenarioKey of activeScenarios) {
    results.push(
      await runScenario(adapter, scenarioKey, resolved, runtimeOptions),
    );
  }
  return results;
}

export async function runNestedUpdateBenchmark(
  adapter: BenchmarkAdapter,
  options: Partial<BenchmarkOptions> = {},
  runtimeOptions: BenchmarkRuntimeOptions = {},
): Promise<BenchmarkResult> {
  const [result] = await runNestedResearchSuite(
    adapter,
    options,
    ["controlled-patterns"],
    runtimeOptions,
  );
  return result;
}
