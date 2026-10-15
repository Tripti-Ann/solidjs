import { version as reactVersion } from "react";
import { version as reactDomVersion } from "react-dom";
import type { BenchmarkMeasurement, BenchmarkResult } from "./types";

declare const __SOLID_VERSION__: string;

// Smallest non-zero performance.now() step; browsers coarsen the clock (5 µs when cross-origin isolated).
function measureTimerResolutionMs(samples = 1000): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    let next = performance.now();
    while (next === start) {
      next = performance.now();
    }
    smallest = Math.min(smallest, next - start);
  }
  return smallest;
}

// OS and CPU model are not exposed to pages; the Chrome runner adds them from Node.
export function getExperimentEnvironment() {
  return {
    userAgent: navigator.userAgent,
    logicalProcessors: navigator.hardwareConcurrency,
    crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
    timerResolutionMs: measureTimerResolutionMs(),
    react: reactVersion,
    reactDom: reactDomVersion,
    solidJs: __SOLID_VERSION__,
    reactCompiler: "not configured (no babel-plugin-react-compiler)",
  };
}

export type ExportedBenchmarkResult = Omit<BenchmarkResult, "measurements">;

export interface BenchmarkDownloadPayload {
  generatedAt: string;
  configuration: {
    environment: ReturnType<typeof getExperimentEnvironment>;
    operationsPerCondition: { warmup: number; measured: number; total: number };
  };
  conditionCount: number;
  aggregates: ExportedBenchmarkResult[];
  rawMeasurements: BenchmarkMeasurement[];
}

export function buildBenchmarkDownloadPayload(
  results: BenchmarkResult[],
  rawMeasurements: BenchmarkMeasurement[],
): BenchmarkDownloadPayload {
  const { warmupIterations, iterations } = results[0].options;
  return {
    generatedAt: new Date().toISOString(),
    configuration: {
      environment: getExperimentEnvironment(),
      operationsPerCondition: {
        warmup: warmupIterations,
        measured: iterations,
        total: warmupIterations + iterations,
      },
    },
    conditionCount: results.length,
    aggregates: results.map(
      ({ measurements: _measurements, ...result }) => result,
    ),
    rawMeasurements,
  };
}
