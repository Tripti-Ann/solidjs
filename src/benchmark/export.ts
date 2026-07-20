import type { BenchmarkResult } from "./types";

export interface ExportedBenchmarkResult extends BenchmarkResult {
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
  secondaryMetrics: {
    cpuUsagePercent: number | null;
    renderingTimeMs: number | null;
    memoryUsageMb: number | null;
  };
}

export interface BenchmarkDownloadPayload {
  generatedAt: string;
  scenarioCount: number;
  metricCoverage: {
    updateLatency: string;
    throughput: string;
    iqr: string;
    cpuUsage: string;
    renderingTime: string;
    memoryUsage: string;
  };
  results: ExportedBenchmarkResult[];
}

export function buildBenchmarkDownloadPayload(
  results: BenchmarkResult[],
): BenchmarkDownloadPayload {
  return {
    generatedAt: new Date().toISOString(),
    scenarioCount: results.length,
    metricCoverage: {
      updateLatency: "captured",
      throughput: "captured",
      iqr: "captured",
      cpuUsage: "captured-if-browser-supports-performance-metrics",
      renderingTime: "captured-if-browser-trace-is-available",
      memoryUsage: "captured-if-browser-supports-performance-memory",
    },
    results: results.map((result) => ({
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
      secondaryMetrics: {
        cpuUsagePercent: result.cpuUsagePercent,
        renderingTimeMs: result.renderingTimeMs,
        memoryUsageMb: result.memoryUsageMb,
      },
    })),
  };
}
