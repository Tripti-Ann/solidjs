export type TreePath = number[];

export type BenchmarkOperationKind = "point" | "subtree";

export interface BenchmarkOperation {
  kind: BenchmarkOperationKind;
  path: TreePath;
  nextValue: number;
}

export type BenchmarkScenarioKey =
  | "deep-leaf-updates"
  | "root-update-propagation"
  | "partial-subtree-invalidation"
  | "controlled-patterns";

export type FrameworkName = "React" | "Solid" | "Control";

export type BenchmarkVariant = "baseline" | "optimized";

export interface TreeNode {
  id: number;
  value: number;
  children: TreeNode[];
}

export interface BenchmarkOptions {
  depth: number;
  breadth: number;
  warmupIterations: number;
  iterations: number;
}

export type BenchmarkRunOptions = Pick<
  BenchmarkOptions,
  "warmupIterations" | "iterations"
>;

export interface MountedTree {
  apply(operation: BenchmarkOperation): void;
  dispose(): void;
}

export interface BenchmarkAdapter {
  framework: FrameworkName;
  variant: BenchmarkVariant;
  mount(container: HTMLElement, initialTree: TreeNode): MountedTree;
}

export type BenchmarkMeasurementPhase = "warmup" | "measured";

export interface BenchmarkMeasurement {
  framework: FrameworkName;
  variant: BenchmarkVariant;
  scenario: BenchmarkScenarioKey;
  iteration: number;
  phase: BenchmarkMeasurementPhase;
  timestamp: string;
  operationKind: BenchmarkOperationKind;
  updateLatencyMs: number;
}

export interface BenchmarkResult {
  framework: FrameworkName;
  variant: BenchmarkVariant;
  scenario: BenchmarkScenarioKey;
  options: BenchmarkOptions;
  measurements: BenchmarkMeasurement[];
  totalMs: number;
  meanMs: number;
  medianMs: number;
  q1Ms: number;
  q3Ms: number;
  iqrMs: number;
  p95Ms: number;
  opsPerSecond: number | null;
  domMatchesModel: boolean;
}
