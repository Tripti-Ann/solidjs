import type { BenchmarkMeasurement, BenchmarkResult } from "./types";

const experimentConfiguration = {
  environment: {
    os: "Microsoft Windows 11 Pro",
    osVersionBuild: "10.0.26200 / build 26200",
    cpu: "AMD Ryzen 5 5625U with Radeon Graphics",
    logicalProcessors: 12,
    ramGiB: 16,
    browser: "Google Chrome 154.0.8037.93 (Official Build, 64-bit)",
    react: "19.2.5",
    reactDom: "19.2.5",
    solidJs: "1.9.12",
    reactCompiler: "disabled",
  },
  operationsPerCondition: {
    warmup: 5,
    measured: 25,
    total: 30,
  },
};

export interface ExportedBenchmarkResult extends Omit<
  BenchmarkResult,
  "measurements"
> {
  primaryMetrics: {
    totalMs: number;
    meanMs: number;
    medianMs: number;
    q1Ms: number;
    q3Ms: number;
    iqrMs: number;
    p95Ms: number;
    opsPerSecond: number;
  };
}

export interface BenchmarkDownloadPayload {
  generatedAt: string;
  configuration: typeof experimentConfiguration;
  scenarioCount: number;
  metricCoverage: {
    updateLatency: string;
    throughput: string;
    iqr: string;
  };
  aggregates: ExportedBenchmarkResult[];
  rawMeasurements: BenchmarkMeasurement[];
}

export function buildBenchmarkDownloadPayload(
  results: BenchmarkResult[],
  rawMeasurements: BenchmarkMeasurement[],
): BenchmarkDownloadPayload {
  return {
    generatedAt: new Date().toISOString(),
    configuration: experimentConfiguration,
    scenarioCount: results.length,
    metricCoverage: {
      updateLatency: "captured",
      throughput: "captured",
      iqr: "captured",
    },
    aggregates: results.map(({ measurements: _measurements, ...result }) => ({
      ...result,
      primaryMetrics: {
        totalMs: result.totalMs,
        meanMs: result.meanMs,
        medianMs: result.medianMs,
        q1Ms: result.q1Ms,
        q3Ms: result.q3Ms,
        iqrMs: result.iqrMs,
        p95Ms: result.p95Ms,
        opsPerSecond: result.opsPerSecond,
      },
    })),
    rawMeasurements,
  };
}
