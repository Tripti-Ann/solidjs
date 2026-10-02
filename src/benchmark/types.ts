export type TreePath = number[];

export type BenchmarkOperationKind = "point" | "subtree";

export interface BenchmarkOperation {
  kind: BenchmarkOperationKind;
  path: TreePath;
  nextValue: number;
}

export type BenchmarkScenarioKey =
  | "deep-leaf-updates"
  | "context-propagation"
  | "partial-subtree-invalidation"
  | "controlled-patterns";

export type FrameworkName = "React" | "Solid";

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

export type BenchmarkMeasurementPhase = "warmup" | "measured";

export interface BenchmarkMeasurement {
  framework: FrameworkName;
  variant: BenchmarkVariant;
  scenario: BenchmarkScenarioKey;
  iteration: number;
  phase: BenchmarkMeasurementPhase;
  timestamp: string;
  options: BenchmarkOptions;
  operationKind: BenchmarkOperationKind;
  updateLatencyMs: number;
  operationsPerSecond: number;
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
  opsPerSecond: number;
}
