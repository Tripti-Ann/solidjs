import { describe, expect, it } from "vitest";
import { buildBenchmarkDownloadPayload } from "../src/benchmark/export";
import type { BenchmarkResult } from "../src/benchmark/types";

describe("benchmark download payload", () => {
  it("separates aggregate metrics from raw measurements", () => {
    const result: BenchmarkResult = {
      framework: "React",
      variant: "baseline",
      scenario: "controlled-patterns",
      options: {
        depth: 3,
        breadth: 2,
        warmupIterations: 5,
        iterations: 10,
      },
      measurements: [],
      totalMs: 10,
      meanMs: 12.5,
      medianMs: 11.75,
      q1Ms: 10.5,
      q3Ms: 13.25,
      iqrMs: 2.75,
      p95Ms: 15.5,
      opsPerSecond: 80,
      domMatchesModel: true,
    };
    const rawMeasurements = [
      {
        framework: "React" as const,
        variant: "baseline" as const,
        scenario: "controlled-patterns" as const,
        iteration: 6,
        phase: "measured" as const,
        timestamp: "2026-10-01T00:00:00.000Z",
        operationKind: "point" as const,
        updateLatencyMs: 12.5,
      },
    ];

    const payload = buildBenchmarkDownloadPayload([result], rawMeasurements);

    expect(payload.aggregates).toHaveLength(1);
    expect(payload.conditionCount).toBe(1);
    expect(payload.configuration.operationsPerCondition).toEqual({
      warmup: 5,
      measured: 10,
      total: 15,
    });
    expect(payload.rawMeasurements).toEqual(rawMeasurements);
    expect(payload.aggregates[0]).not.toHaveProperty("measurements");
    expect(payload.aggregates[0]).toMatchObject({
      totalMs: 10,
      meanMs: 12.5,
      medianMs: 11.75,
      q1Ms: 10.5,
      q3Ms: 13.25,
      iqrMs: 2.75,
      p95Ms: 15.5,
      opsPerSecond: 80,
    });
  });
});
