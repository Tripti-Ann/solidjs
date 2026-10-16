// Pure helpers shared by chrome-metrics.mjs and report.mjs.

// Nearest-rank percentile, matching src/benchmark/runner.ts.
export function percentile(values, rank) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(rank * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

// Missing values (e.g. a trace without window markers) are dropped and n reports how many remain.
export function describeRuns(values) {
  const present = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (present.length === 0) {
    return { n: 0, median: null, q1: null, q3: null, min: null, max: null };
  }
  return {
    n: present.length,
    median: percentile(present, 0.5),
    q1: percentile(present, 0.25),
    q3: percentile(present, 0.75),
    min: Math.min(...present),
    max: Math.max(...present),
  };
}

// Reporting only; describeRuns stays unchanged because chrome-metrics.mjs writes its fields to raw reports.
export function describeSpread(values) {
  const stats = describeRuns(values);
  return { ...stats, iqr: stats.n === 0 ? null : stats.q3 - stats.q1 };
}

// mulberry32: small seeded PRNG so condition-order shuffles are reproducible.
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(items, seed) {
  const random = createRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function summarizeByOperationKind(measurements) {
  const byKind = {};
  for (const measurement of measurements) {
    if (measurement.phase === "measured") {
      (byKind[measurement.operationKind] ??= []).push(
        measurement.updateLatencyMs,
      );
    }
  }
  return Object.fromEntries(
    Object.entries(byKind).map(([kind, latencies]) => [
      kind,
      {
        count: latencies.length,
        medianMs: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
      },
    ]),
  );
}

// PrePaint and Layerize are the current Chrome pipeline steps; RecalculateStyles, UpdateLayerTree, and CompositeLayers are older names.
export const renderingEventNames = [
  "Layout",
  "RecalculateStyles",
  "UpdateLayoutTree",
  "PrePaint",
  "Paint",
  "Layerize",
  "UpdateLayerTree",
  "CompositeLayers",
  "Commit",
  "RasterTask",
];
export const garbageCollectionEventNames = ["MinorGC", "MajorGC"];

// Length of the union of [start, end) intervals in µs, and how many intervals overlapped an earlier one.
function intervalUnion(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let totalUs = 0;
  let overlapping = 0;
  let current = null;
  for (const [from, to] of sorted) {
    if (current && from < current[1]) {
      overlapping += 1;
      current[1] = Math.max(current[1], to);
      continue;
    }
    if (current) {
      totalUs += current[1] - current[0];
    }
    current = [from, to];
  }
  if (current) {
    totalUs += current[1] - current[0];
  }
  return { totalUs, overlapping };
}

/**
 * Window = the two performance.mark events emitted by the page (trace clock, µs).
 * Renderer = the process and thread that emitted the start marker.
 * Complete events (ph X) are clipped to the window; per-name sums are inclusive,
 * union totals on the renderer main thread remove nested and overlapping time.
 */
export function summarizeTrace(tracePayload, marks) {
  const events = Array.isArray(tracePayload?.traceEvents)
    ? tracePayload.traceEvents
    : [];
  const markers = (name) =>
    events.filter(
      (event) =>
        event.name === name && String(event.cat).includes("blink.user_timing"),
    );
  const startMarkers = markers(marks.start);
  const endMarkers = markers(marks.end);
  const base = {
    eventNames: {
      rendering: renderingEventNames,
      garbageCollection: garbageCollectionEventNames,
    },
    startMarkers: startMarkers.length,
    endMarkers: endMarkers.length,
  };
  if (
    startMarkers.length !== 1 ||
    endMarkers.length !== 1 ||
    startMarkers[0].pid !== endMarkers[0].pid ||
    endMarkers[0].ts <= startMarkers[0].ts
  ) {
    return { ...base, valid: false };
  }

  const [{ pid, tid, ts: start }] = startMarkers;
  const end = endMarkers[0].ts;
  const gcNames = new Set(garbageCollectionEventNames);
  const tracked = new Set([...renderingEventNames, ...gcNames]);
  const inclusiveMsByScope = {
    rendererMain: {},
    rendererOther: {},
    otherProcesses: {},
  };
  const mainIntervals = { rendering: [], garbageCollection: [] };
  let clippedEvents = 0;
  let nonCompleteTrackedEvents = 0;
  let rendererMainEvents = 0;

  for (const event of events) {
    if (event.pid === pid && event.tid === tid && event.ph !== "M") {
      rendererMainEvents += 1;
    }
    if (!tracked.has(event.name)) {
      continue;
    }
    if (event.ph !== "X" || typeof event.dur !== "number") {
      nonCompleteTrackedEvents += 1;
      continue;
    }
    const from = Math.max(event.ts, start);
    const to = Math.min(event.ts + event.dur, end);
    if (to <= from) {
      continue;
    }
    if (from !== event.ts || to !== event.ts + event.dur) {
      clippedEvents += 1;
    }
    const scope =
      event.pid !== pid
        ? "otherProcesses"
        : event.tid === tid
          ? "rendererMain"
          : "rendererOther";
    const byName = inclusiveMsByScope[scope];
    byName[event.name] = (byName[event.name] ?? 0) + (to - from) / 1000;
    if (scope === "rendererMain") {
      mainIntervals[
        gcNames.has(event.name) ? "garbageCollection" : "rendering"
      ].push([from, to]);
    }
  }

  const rendering = intervalUnion(mainIntervals.rendering);
  const garbageCollection = intervalUnion(mainIntervals.garbageCollection);
  const combined = intervalUnion([
    ...mainIntervals.rendering,
    ...mainIntervals.garbageCollection,
  ]);

  return {
    ...base,
    valid: true,
    rendererPid: pid,
    rendererMainTid: tid,
    rendererMainThreadName:
      events.find(
        (event) =>
          event.ph === "M" &&
          event.name === "thread_name" &&
          event.pid === pid &&
          event.tid === tid,
      )?.args?.name ?? null,
    rendererMainEvents,
    windowMs: (end - start) / 1000,
    rendererMainRenderingUnionMs: rendering.totalUs / 1000,
    rendererMainGcUnionMs: garbageCollection.totalUs / 1000,
    rendererMainRenderingOrGcUnionMs: combined.totalUs / 1000,
    overlappingMainThreadEvents: combined.overlapping,
    clippedEvents,
    nonCompleteTrackedEvents,
    inclusiveMsByScope,
  };
}

const processKey = (info) => `${info.type}:${info.id}`;
const sumOf = (entries, field) =>
  entries.reduce((sum, entry) => sum + entry[field], 0);

/**
 * Process set: every process SystemInfo.getProcessInfo reports for the dedicated browser instance at a sample.
 * It reports cumulative cpuTime (s) per process and no start time; processes that start and exit between
 * two samples are never observed. bothEndpointsCpuTimeMs is exact for processes present at both samples and a
 * lower bound for the browser's CPU in the window (assuming a process id is not reused within the window).
 * observedProcessesUpperEstimateMs adds the full cumulative readings of end-only processes; it covers observed
 * processes only, is not an upper bound on all browser CPU, and is null when a start-only process exists.
 */
export function summarizeProcessCpuTime(startSample, endSample) {
  const reading = ({ id, type, cpuTime }) => ({ id, type, cpuTime });
  const startByKey = new Map(
    startSample.map((info) => [processKey(info), info]),
  );
  const endKeys = new Set(endSample.map(processKey));
  const bothEndpoints = [];
  const endOnly = [];

  for (const info of endSample) {
    const before = startByKey.get(processKey(info));
    if (before) {
      bothEndpoints.push({
        id: info.id,
        type: info.type,
        cpuTimeDeltaMs: (info.cpuTime - before.cpuTime) * 1000,
      });
    } else {
      endOnly.push({
        id: info.id,
        type: info.type,
        cumulativeCpuTimeMs: info.cpuTime * 1000,
        lifecycle: "unclassified",
      });
    }
  }
  const startOnly = startSample
    .filter((info) => !endKeys.has(processKey(info)))
    .map((info) => ({
      id: info.id,
      type: info.type,
      cumulativeCpuTimeMs: info.cpuTime * 1000,
      lifecycle: "unclassified",
    }));
  const bothEndpointsCpuTimeMs = sumOf(bothEndpoints, "cpuTimeDeltaMs");

  return {
    endpoints: {
      start: startSample.map(reading),
      end: endSample.map(reading),
    },
    bothEndpointsCpuTimeMs,
    observedProcessesUpperEstimateMs:
      startOnly.length === 0
        ? bothEndpointsCpuTimeMs + sumOf(endOnly, "cumulativeCpuTimeMs")
        : null,
    bothEndpoints,
    endOnly,
    startOnly,
    sameProcessesAtBothEndpoints:
      endOnly.length === 0 && startOnly.length === 0,
  };
}

/**
 * Classifies end-only and start-only processes using every other sample of the session (execution order).
 * A process seen in an earlier sample was only missing from this window's start sample; one never seen
 * before was first observed at the end sample (most likely created in the window; CDP gives no start time).
 */
export function classifyProcessLifecycles(cpuMetricsInOrder) {
  const keysPerSample = cpuMetricsInOrder.map(
    ({ endpoints }) =>
      new Set([...endpoints.start, ...endpoints.end].map(processKey)),
  );
  const seen = (key, indices) => indices.some((i) => keysPerSample[i].has(key));
  const range = (from, to) =>
    Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

  cpuMetricsInOrder.forEach((metrics, index) => {
    const earlier = range(0, index);
    const later = range(index + 1, cpuMetricsInOrder.length);
    for (const entry of metrics.endOnly) {
      entry.lifecycle = seen(processKey(entry), earlier)
        ? "missing-from-start-sample"
        : "first-observed-at-end-sample";
    }
    for (const entry of metrics.startOnly) {
      entry.lifecycle = seen(processKey(entry), later)
        ? "missing-from-end-sample"
        : "not-observed-again";
    }
  });
  return cpuMetricsInOrder;
}
