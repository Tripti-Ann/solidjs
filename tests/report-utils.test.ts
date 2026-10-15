import { describe, expect, it } from "vitest";
import {
  classifyProcessLifecycles,
  describeRuns,
  percentile,
  shuffled,
  summarizeByOperationKind,
  summarizeProcessCpuTime,
  summarizeTrace,
} from "../bench/report-utils.mjs";

describe("report utilities", () => {
  it("uses nearest-rank percentiles and describes run spreads", () => {
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
    expect(describeRuns([5, 1, 3, 2, 4])).toEqual({
      n: 5,
      median: 3,
      q1: 2,
      q3: 4,
      min: 1,
      max: 5,
    });
    expect(describeRuns([4, undefined, 2, null])).toMatchObject({
      n: 2,
      median: 2,
    });
    expect(describeRuns([undefined]).median).toBeNull();
  });

  it("shuffles reproducibly without losing items", () => {
    const items = Array.from({ length: 16 }, (_, index) => index);

    expect(shuffled(items, 7)).toEqual(shuffled(items, 7));
    expect(shuffled(items, 7)).not.toEqual(items);
    expect([...shuffled(items, 7)].sort((a, b) => a - b)).toEqual(items);
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

  const marks = { start: "bench:start", end: "bench:end" };
  const mark = (name: string, ts: number) => ({
    name,
    cat: "blink.user_timing",
    ph: "R",
    pid: 1,
    tid: 10,
    ts,
  });
  const complete = (name: string, ts: number, dur: number, pid = 1, tid = 10) => ({
    name,
    ph: "X",
    pid,
    tid,
    ts,
    dur,
  });

  it("clips trace events to the marker window and separates renderer threads and processes", () => {
    const summary = summarizeTrace(
      {
        traceEvents: [
          { ph: "M", name: "thread_name", pid: 1, tid: 10, args: { name: "CrRendererMain" } },
          mark(marks.start, 1000),
          mark(marks.end, 11000),
          complete("Layout", 0, 2000), // crosses the start: 1000 µs inside
          complete("UpdateLayoutTree", 3000, 2000),
          complete("Layout", 3500, 500), // nested in UpdateLayoutTree
          complete("MinorGC", 4000, 2000), // overlaps the rendering events
          complete("Paint", 10500, 2000), // crosses the end: 500 µs inside
          complete("Paint", 20000, 1000), // outside
          complete("RasterTask", 5000, 1000, 1, 11),
          complete("Commit", 5000, 1000, 2, 20),
          { name: "Layout", ph: "B", pid: 1, tid: 10, ts: 2000 },
        ],
      },
      marks,
    );

    expect(summary).toMatchObject({
      valid: true,
      rendererPid: 1,
      rendererMainTid: 10,
      rendererMainThreadName: "CrRendererMain",
      windowMs: 10,
      clippedEvents: 2,
      nonCompleteTrackedEvents: 1,
      rendererMainRenderingUnionMs: 3.5,
      rendererMainGcUnionMs: 2,
      rendererMainRenderingOrGcUnionMs: 4.5,
    });
    expect("inclusiveMsByScope" in summary && summary.inclusiveMsByScope).toEqual({
      rendererMain: { Layout: 1.5, UpdateLayoutTree: 2, MinorGC: 2, Paint: 0.5 },
      rendererOther: { RasterTask: 1 },
      otherProcesses: { Commit: 1 },
    });
  });

  it("marks a trace without exactly one pair of window markers as invalid", () => {
    expect(
      summarizeTrace({ traceEvents: [mark(marks.start, 1)] }, marks),
    ).toMatchObject({ valid: false, startMarkers: 1, endMarkers: 0 });
  });

  it("keeps raw CPU endpoints and bounds CPU for processes seen at one sample only", () => {
    const appeared = summarizeProcessCpuTime(
      [{ id: 1, type: "browser", cpuTime: 1 }],
      [
        { id: 1, type: "browser", cpuTime: 1.5 },
        { id: 3, type: "utility", cpuTime: 0.25 },
      ],
    );

    expect(appeared).toMatchObject({
      bothEndpointsCpuTimeMs: 500,
      observedProcessesUpperEstimateMs: 750,
      sameProcessesAtBothEndpoints: false,
      endOnly: [{ id: 3, type: "utility", cumulativeCpuTimeMs: 250 }],
      startOnly: [],
    });
    expect(appeared.endpoints.start).toEqual([
      { id: 1, type: "browser", cpuTime: 1 },
    ]);

    const exited = summarizeProcessCpuTime(
      [
        { id: 1, type: "browser", cpuTime: 1 },
        { id: 2, type: "renderer", cpuTime: 2 },
      ],
      [{ id: 1, type: "browser", cpuTime: 1.5 }],
    );

    expect(exited.bothEndpointsCpuTimeMs).toBe(500);
    expect(exited.observedProcessesUpperEstimateMs).toBeNull();
    expect(exited.startOnly).toMatchObject([{ id: 2, cumulativeCpuTimeMs: 2000 }]);
  });

  it("classifies one-sample processes using the session's other samples", () => {
    const sample = (
      start: Array<{ id: number }>,
      end: Array<{ id: number }>,
    ) =>
      summarizeProcessCpuTime(
        start.map(({ id }) => ({ id, type: "utility", cpuTime: 1 })),
        end.map(({ id }) => ({ id, type: "utility", cpuTime: 2 })),
      );
    const samples = classifyProcessLifecycles([
      sample([{ id: 1 }], [{ id: 1 }]),
      sample([], [{ id: 1 }, { id: 2 }]),
      sample([{ id: 3 }, { id: 4 }], []),
      sample([{ id: 3 }], [{ id: 3 }]),
    ]);

    const lifecycles = (entries: Array<{ lifecycle: string }>) =>
      entries.map((entry) => entry.lifecycle);
    expect(lifecycles(samples[1].endOnly)).toEqual([
      "missing-from-start-sample",
      "first-observed-at-end-sample",
    ]);
    expect(lifecycles(samples[2].startOnly)).toEqual([
      "missing-from-end-sample",
      "not-observed-again",
    ]);
  });
});
