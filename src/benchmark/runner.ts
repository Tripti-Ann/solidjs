import {
  createTree,
  getInternalPaths,
  getLeafPaths,
  pathsAtDepth,
} from "./tree";
import type {
  BenchmarkAdapter,
  BenchmarkMeasurementPhase,
  BenchmarkOperation,
  BenchmarkOptions,
  BenchmarkResult,
  BenchmarkRunOptions,
  BenchmarkScenarioKey,
  TreeNode,
  TreePath,
} from "./types";

export interface BenchmarkRuntimeOptions {
  visualMode?: boolean;
  visualHostParent?: HTMLElement;
  captureMetrics?: boolean;
  onAfterWarmup?: () => Promise<void> | void;
  onAfterMeasured?: () => Promise<void> | void;
}

const defaultOptions: BenchmarkRunOptions = {
  warmupIterations: 5,
  iterations: 25,
};

interface ScenarioDefinition {
  key: BenchmarkScenarioKey;
  label: string;
  depth: number;
  breadth: number;
  schedule: (
    root: TreeNode,
    depth: number,
    totalOperations: number,
  ) => BenchmarkOperation[];
}

export type LatencySummary = Pick<
  BenchmarkResult,
  | "totalMs"
  | "meanMs"
  | "medianMs"
  | "q1Ms"
  | "q3Ms"
  | "iqrMs"
  | "p95Ms"
  | "opsPerSecond"
>;

// Stateless 32-bit integer hash (lowbias32) so every (seed, step) pair maps uniformly onto the pool.
function makeDeterministicIndex(
  count: number,
  seed: number,
  step: number,
): number {
  let hash = Math.imul(seed, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) % count;
}

function choosePath(pool: TreePath[], seed: number, step: number): TreePath {
  if (pool.length === 0) {
    return [];
  }

  return pool[makeDeterministicIndex(pool.length, seed, step)];
}

const midDepth = (depth: number) => Math.max(2, Math.floor(depth / 2));

const scenarioDefinitions: Record<BenchmarkScenarioKey, ScenarioDefinition> = {
  "deep-leaf-updates": {
    key: "deep-leaf-updates",
    label: "Deep Tree Updates",
    depth: 100,
    breadth: 1,
    schedule: (root, _depth, totalOperations) => {
      const leaves = getLeafPaths(root);
      const leaf = leaves[0] ?? [];
      return Array.from({ length: totalOperations }, (_, step) => ({
        kind: "point",
        path: leaf,
        nextValue: step,
      }));
    },
  },
  "root-update-propagation": {
    key: "root-update-propagation",
    label: "Root Update Propagation",
    depth: 7,
    breadth: 3,
    schedule: (_root, _depth, totalOperations) =>
      Array.from({ length: totalOperations }, (_, step) => ({
        kind: "point",
        path: [],
        nextValue: step,
      })),
  },
  "partial-subtree-invalidation": {
    key: "partial-subtree-invalidation",
    label: "Partial Subtree Invalidation",
    depth: 8,
    breadth: 3,
    schedule: (root, depth, totalOperations) => {
      const pool = pathsAtDepth(root, midDepth(depth));
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
    depth: 7,
    breadth: 3,
    schedule: (root, depth, totalOperations) => {
      const leaves = getLeafPaths(root);
      const internals = getInternalPaths(root).filter(
        (path) => path.length > 0,
      );
      const midPool = pathsAtDepth(root, midDepth(depth));

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

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function summarizeLatencies(durations: number[]): LatencySummary {
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
  const meanMs = totalMs / durations.length;
  const q1Ms = percentile(durations, 0.25);
  const q3Ms = percentile(durations, 0.75);
  return {
    totalMs,
    meanMs,
    medianMs: percentile(durations, 0.5),
    q1Ms,
    q3Ms,
    iqrMs: q3Ms - q1Ms,
    p95Ms: percentile(durations, 0.95),
    opsPerSecond: meanMs > 0 ? 1000 / meanMs : 0,
  };
}

export function createScenario(
  scenarioKey: BenchmarkScenarioKey,
  options: BenchmarkRunOptions,
): {
  root: TreeNode;
  schedule: BenchmarkOperation[];
  options: BenchmarkOptions;
} {
  const { depth, breadth, schedule } = scenarioDefinitions[scenarioKey];
  const root = createTree(depth, breadth);
  return {
    root,
    schedule: schedule(
      root,
      depth,
      options.warmupIterations + options.iterations,
    ),
    options: {
      depth,
      breadth,
      warmupIterations: options.warmupIterations,
      iterations: options.iterations,
    },
  };
}

async function runScenario(
  adapter: BenchmarkAdapter,
  scenarioKey: BenchmarkScenarioKey,
  options: BenchmarkRunOptions,
  runtimeOptions: BenchmarkRuntimeOptions,
): Promise<BenchmarkResult> {
  const {
    root,
    schedule,
    options: resolvedOptions,
  } = createScenario(scenarioKey, options);
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
  const measurements: BenchmarkResult["measurements"] = [];

  const runOperation = (
    index: number,
    phase: BenchmarkMeasurementPhase,
  ): number => {
    const start = performance.now();
    mounted.apply(schedule[index]);
    const updateLatencyMs = performance.now() - start;
    measurements.push({
      framework: adapter.framework,
      variant: adapter.variant,
      scenario: scenarioKey,
      iteration: index + 1,
      phase,
      timestamp: new Date().toISOString(),
      operationKind: schedule[index].kind,
      updateLatencyMs,
    });
    return updateLatencyMs;
  };

  for (let i = 0; i < options.warmupIterations; i += 1) {
    runOperation(i, "warmup");
  }

  await runtimeOptions.onAfterWarmup?.();

  const iterationDurations: number[] = [];

  for (let i = options.warmupIterations; i < schedule.length; i += 1) {
    iterationDurations.push(runOperation(i, "measured"));

    if (runtimeOptions.captureMetrics) {
      await nextFrame();
    }
  }

  await runtimeOptions.onAfterMeasured?.();

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
    ...summarizeLatencies(iterationDurations),
  };
}

export function getNestedBenchmarkScenarios(): Array<{
  key: BenchmarkScenarioKey;
  label: string;
  depth: number;
  breadth: number;
}> {
  return Object.values(scenarioDefinitions).map(
    ({ key, label, depth, breadth }) => ({ key, label, depth, breadth }),
  );
}

export async function runNestedResearchSuite(
  adapter: BenchmarkAdapter,
  options: Partial<BenchmarkRunOptions> = {},
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
