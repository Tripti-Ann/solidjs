// Pure helpers shared by chrome-metrics.mjs and report.mjs.

// Nearest-rank percentile, matching src/benchmark/runner.ts.
export function percentile(values, rank) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(rank * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

export function describeRuns(values) {
  return {
    median: percentile(values, 0.5),
    q1: percentile(values, 0.25),
    q3: percentile(values, 0.75),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

// mulberry32: small seeded PRNG so shuffles and bootstrap resamples are reproducible.
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

// Percentile bootstrap confidence interval for the median.
export function bootstrapMedianCi(
  values,
  { resamples = 2000, level = 0.95, seed = 1 } = {},
) {
  const random = createRandom(seed);
  const medians = Array.from({ length: resamples }, () =>
    percentile(
      Array.from(
        { length: values.length },
        () => values[Math.floor(random() * values.length)],
      ),
      0.5,
    ),
  );
  const tail = (1 - level) / 2;
  return {
    level,
    low: percentile(medians, tail),
    high: percentile(medians, 1 - tail),
  };
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

const renderingAndPaintingEventNames = [
  "Layout",
  "RecalculateStyles",
  "UpdateLayoutTree",
  "UpdateLayerTree",
  "CompositeLayers",
  "Commit",
  "Paint",
  "RasterTask",
];
const garbageCollectionEventNames = ["MinorGC", "MajorGC"];

export function summarizeTrace(tracePayload) {
  const events = Array.isArray(tracePayload?.traceEvents)
    ? tracePayload.traceEvents
    : [];
  const tracked = new Set([
    ...renderingAndPaintingEventNames,
    ...garbageCollectionEventNames,
  ]);
  const durationsByEventMs = {};

  for (const event of events) {
    if (
      event?.ph === "X" &&
      typeof event.dur === "number" &&
      tracked.has(event.name)
    ) {
      durationsByEventMs[event.name] =
        (durationsByEventMs[event.name] ?? 0) + event.dur / 1000;
    }
  }

  const total = (names) =>
    names.reduce((sum, name) => sum + (durationsByEventMs[name] ?? 0), 0);

  return {
    eventNames: renderingAndPaintingEventNames,
    traceRenderingAndPaintingDurationMs: total(renderingAndPaintingEventNames),
    garbageCollectionEventNames,
    traceGarbageCollectionDurationMs: total(garbageCollectionEventNames),
    durationsByEventMs,
  };
}

function processSnapshotKey(processInfo) {
  return `${processInfo.type}:${processInfo.id}`;
}

export function summarizeBrowserProcessCpuTime(
  beforeProcessInfo,
  afterProcessInfo,
) {
  const beforeByKey = new Map(
    beforeProcessInfo.map((info) => [processSnapshotKey(info), info]),
  );
  const afterKeys = new Set(afterProcessInfo.map(processSnapshotKey));
  const includedProcesses = afterProcessInfo.map((info) => {
    const before = beforeByKey.get(processSnapshotKey(info));
    return {
      id: info.id,
      type: info.type,
      snapshotMembership: before ? "both" : "after-only",
      cpuTimeDeltaMs: Math.max(
        0,
        (info.cpuTime - (before?.cpuTime ?? 0)) * 1000,
      ),
    };
  });
  const exitedProcesses = beforeProcessInfo
    .filter((info) => !afterKeys.has(processSnapshotKey(info)))
    .map((info) => ({
      id: info.id,
      type: info.type,
      cpuTimeAtInitialSnapshotMs: info.cpuTime * 1000,
    }));

  return {
    browserProcessGroupCpuTimeMs: includedProcesses.reduce(
      (sum, info) => sum + info.cpuTimeDeltaMs,
      0,
    ),
    processCount: includedProcesses.length,
    includedProcesses,
    exitedProcesses,
    completeProcessCoverage: exitedProcesses.length === 0,
  };
}
