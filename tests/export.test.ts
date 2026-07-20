import { describe, expect, it } from "vitest";
import { buildBenchmarkDownloadPayload } from "../src/benchmark/export";
import type { BenchmarkResult } from "../src/benchmark/types";

describe("benchmark download payload", () => {
  it("includes primary and secondary metrics in the same export", () => {
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
      totalMs: 10,
      meanMs: 12.5,
      medianMs: 11.75,
      q1Ms: 10.5,
      q3Ms: 13.25,
      iqrMs: 2.75,
      p95Ms: 15.5,
      opsPerSecond: 80,
      cpuUsagePercent: 42.5,
      renderingTimeMs: 7.25,
      memoryUsageMb: 128.5,
    };

    const payload = buildBenchmarkDownloadPayload([result]);

    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].primaryMetrics).toEqual({
      totalMs: 10,
      meanMs: 12.5,
      medianMs: 11.75,
      q1Ms: 10.5,
      q3Ms: 13.25,
      iqrMs: 2.75,
      p95Ms: 15.5,
      opsPerSecond: 80,
    });
    expect(payload.results[0].secondaryMetrics).toEqual({
      cpuUsagePercent: 42.5,
      renderingTimeMs: 7.25,
      memoryUsageMb: 128.5,
    });
  });
});
