import { describe, expect, it } from "vitest";
import {
  bootstrapMedianCi,
  describeRuns,
  percentile,
  shuffled,
  summarizeBrowserProcessCpuTime,
  summarizeByOperationKind,
  summarizeTrace,
} from "../bench/report-utils.mjs";

describe("report utilities", () => {
  it("uses nearest-rank percentiles and describes run spreads", () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
    expect(describeRuns([5, 1, 3, 2, 4])).toEqual({
      median: 3,
      q1: 2,
      q3: 4,
      min: 1,
      max: 5,
    });
  });

  it("shuffles reproducibly without losing items", () => {
    const items = Array.from({ length: 16 }, (_, index) => index);

    expect(shuffled(items, 7)).toEqual(shuffled(items, 7));
    expect(shuffled(items, 7)).not.toEqual(items);
    expect([...shuffled(items, 7)].sort((a, b) => a - b)).toEqual(items);
  });

  it("brackets the sample median with a reproducible bootstrap interval", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ci = bootstrapMedianCi(values);

    expect(ci).toEqual(bootstrapMedianCi(values));
    expect(ci.low).toBeLessThanOrEqual(5);
    expect(ci.high).toBeGreaterThanOrEqual(5);
    expect(ci.low).toBeGreaterThanOrEqual(1);
    expect(ci.high).toBeLessThanOrEqual(10);
  });

  it("summarizes measured latencies by operation kind", () => {
    const measurement = (
      phase: string,
      operationKind: string,
      updateLatencyMs: number,
    ) => ({
      phase,
      operationKind,
      updateLatencyMs,
    });

    expect(
      summarizeByOperationKind([
        measurement("warmup", "point", 100),
        measurement("measured", "point", 1),
        measurement("measured", "point", 3),
        measurement("measured", "subtree", 10),
      ]),
    ).toEqual({
      point: { count: 2, medianMs: 1, p95Ms: 3 },
      subtree: { count: 1, medianMs: 10, p95Ms: 10 },
    });
  });

  it("sums only complete, tracked trace events", () => {
    const summary = summarizeTrace({
      traceEvents: [
        { ph: "X", name: "Layout", dur: 2000 },
        { ph: "X", name: "Paint", dur: 1000 },
        { ph: "X", name: "MinorGC", dur: 500 },
        { ph: "B", name: "Layout", dur: 9000 },
        { ph: "X", name: "FunctionCall", dur: 9000 },
      ],
    });

    expect(summary.traceRenderingAndPaintingDurationMs).toBe(3);
    expect(summary.traceGarbageCollectionDurationMs).toBe(0.5);
    expect(summary.durationsByEventMs).toEqual({
      Layout: 2,
      Paint: 1,
      MinorGC: 0.5,
    });
  });

  it("reports CPU time deltas and flags processes that exited", () => {
    const summary = summarizeBrowserProcessCpuTime(
      [
        { id: 1, type: "browser", cpuTime: 1 },
        { id: 2, type: "renderer", cpuTime: 2 },
      ],
      [
        { id: 1, type: "browser", cpuTime: 1.5 },
        { id: 3, type: "gpu", cpuTime: 0.25 },
      ],
    );

    expect(summary.browserProcessGroupCpuTimeMs).toBe(750);
    expect(summary.completeProcessCoverage).toBe(false);
    expect(summary.exitedProcesses).toEqual([
      { id: 2, type: "renderer", cpuTimeAtInitialSnapshotMs: 2000 },
    ]);
  });
});
