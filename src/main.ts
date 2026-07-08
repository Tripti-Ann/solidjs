import "./style.css";
import {
  getNestedBenchmarkScenarios,
  runNestedResearchSuite,
} from "./benchmark/runner";
import type { BenchmarkAdapter } from "./benchmark/runner";
import {
  mountReactTree,
  mountReactTreeOptimized,
} from "./frameworks/reactTree.react";
import {
  mountSolidTree,
  mountSolidTreeOptimized,
} from "./frameworks/solidTree.solid";
import type {
  BenchmarkOptions,
  BenchmarkResult,
  BenchmarkScenarioKey,
  BenchmarkVariant,
  FrameworkName,
} from "./benchmark/types";

interface AutomationConditionInput {
  framework: FrameworkName;
  variant: BenchmarkVariant;
  scenario: BenchmarkScenarioKey;
  options: BenchmarkOptions;
  suiteRuns: number;
}

interface AutomationApi {
  scenarios: BenchmarkScenarioKey[];
  runCondition(input: AutomationConditionInput): Promise<{
    aggregate: BenchmarkResult;
    runs: BenchmarkResult[];
  }>;
}

declare global {
  interface Window {
    __nestedUiBenchmark?: AutomationApi;
  }
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root was not found.");
}

app.innerHTML = `
  <div class="ambient"></div>
  <main class="layout">
    <header class="hero">
      <p class="eyebrow">Nested UI Research Benchmark</p>
      <h1>SolidJS vs React</h1>
      <p class="lead">Compare deep-tree updates, context-like propagation pressure, partial subtree invalidation, and controlled update patterns using deterministic schedules.</p>
    </header>

    <section class="panel controls">
      <h2>Benchmark Controls</h2>
      <div class="control-grid">
        <label>Depth <input id="depth" type="number" min="2" max="7" value="5" /></label>
        <label>Breadth <input id="breadth" type="number" min="2" max="5" value="3" /></label>
        <label>Warmup <input id="warmup" type="number" min="0" max="300" value="60" /></label>
        <label>Iterations <input id="iterations" type="number" min="10" max="1000" value="240" /></label>
        <label>Suite Runs <input id="suiteRuns" type="number" min="1" max="20" value="5" /></label>
      </div>
      <label class="toggle-row">
        <input id="visualMode" type="checkbox" />
        <span>Debug visual mode (shows live tree updates; not for fair timing comparisons)</span>
      </label>
      <div class="actions">
        <button id="runSuite" class="run-button">Run Comparison</button>
        <button id="downloadResults" class="run-button" disabled>Export JSON</button>
      </div>
      <p id="status" class="status">Idle</p>
    </section>

    <section class="panel visual-panel">
      <h2>Live Tree Preview</h2>
      <p class="visual-note">Enable debug visual mode to watch updates in-flight. The preview renders one scenario/framework run at a time.</p>
      <div id="visualHost" class="visual-host"></div>
    </section>

    <section class="panel">
      <h2>Results</h2>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Framework</th>
            <th>Variant</th>
            <th>Avg Mean (ms)</th>
            <th>Avg IQR (ms)</th>
            <th>Avg p95 (ms)</th>
            <th>Avg Ops/s</th>
          </tr>
        </thead>
        <tbody id="resultsBody"></tbody>
      </table>
    </section>

    <section class="panel log-panel">
      <h2>Run Log</h2>
      <pre id="runLog"></pre>
    </section>
  </main>
`;

const depthInput = document.querySelector<HTMLInputElement>("#depth");
const breadthInput = document.querySelector<HTMLInputElement>("#breadth");
const warmupInput = document.querySelector<HTMLInputElement>("#warmup");
const iterationsInput = document.querySelector<HTMLInputElement>("#iterations");
const suiteRunsInput = document.querySelector<HTMLInputElement>("#suiteRuns");
const visualModeInput = document.querySelector<HTMLInputElement>("#visualMode");
const runSuiteButton = document.querySelector<HTMLButtonElement>("#runSuite");
const downloadResultsButton =
  document.querySelector<HTMLButtonElement>("#downloadResults");
const status = document.querySelector<HTMLParagraphElement>("#status");
const resultsBody =
  document.querySelector<HTMLTableSectionElement>("#resultsBody");
const runLog = document.querySelector<HTMLPreElement>("#runLog");
const visualHost = document.querySelector<HTMLDivElement>("#visualHost");

if (
  !depthInput ||
  !breadthInput ||
  !warmupInput ||
  !iterationsInput ||
  !suiteRunsInput ||
  !visualModeInput ||
  !runSuiteButton ||
  !downloadResultsButton ||
  !status ||
  !resultsBody ||
  !runLog ||
  !visualHost
) {
  throw new Error("Benchmark controls could not be initialized.");
}

const depthEl = depthInput;
const breadthEl = breadthInput;
const warmupEl = warmupInput;
const iterationsEl = iterationsInput;
const suiteRunsEl = suiteRunsInput;
const visualModeEl = visualModeInput;
const runSuiteBtn = runSuiteButton;
const downloadResultsBtn = downloadResultsButton;
const statusEl = status;
const resultsBodyEl = resultsBody;
const runLogEl = runLog;
const visualHostEl = visualHost;
let lastAggregates: BenchmarkResult[] = [];

type BenchmarkAdapterWithVariant = BenchmarkAdapter;

function adapterKey(
  entry: Pick<BenchmarkAdapterWithVariant, "framework" | "variant">,
): `${FrameworkName}-${BenchmarkVariant}` {
  return `${entry.framework}-${entry.variant}`;
}

function parseInput(input: HTMLInputElement): number {
  return Number.parseInt(input.value, 10);
}

function aggregate(
  scenario: BenchmarkScenarioKey,
  framework: FrameworkName,
  variant: BenchmarkVariant,
  values: BenchmarkResult[],
): BenchmarkResult {
  const total = values.reduce(
    (acc, item) => {
      acc.totalMs += item.totalMs;
      acc.meanMs += item.meanMs;
      acc.medianMs += item.medianMs;
      acc.q1Ms += item.q1Ms;
      acc.q3Ms += item.q3Ms;
      acc.iqrMs += item.iqrMs;
      acc.p95Ms += item.p95Ms;
      acc.opsPerSecond += item.opsPerSecond;
      return acc;
    },
    {
      totalMs: 0,
      meanMs: 0,
      medianMs: 0,
      q1Ms: 0,
      q3Ms: 0,
      iqrMs: 0,
      p95Ms: 0,
      opsPerSecond: 0,
    },
  );

  const count = values.length;
  return {
    scenario,
    framework,
    variant,
    options: values[0].options,
    totalMs: total.totalMs / count,
    meanMs: total.meanMs / count,
    medianMs: total.medianMs / count,
    q1Ms: total.q1Ms / count,
    q3Ms: total.q3Ms / count,
    iqrMs: total.iqrMs / count,
    p95Ms: total.p95Ms / count,
    opsPerSecond: total.opsPerSecond / count,
    cpuUsagePercent: null,
    renderingTimeMs: null,
    memoryUsageMb: null,
  };
}

function formatResult(result: BenchmarkResult): string {
  return `${result.scenario.padEnd(30)} | ${result.framework.padEnd(5)} | ${result.variant.padEnd(9)} | mean=${result.meanMs.toFixed(4)}ms | p95=${result.p95Ms.toFixed(4)}ms | ops/s=${result.opsPerSecond.toFixed(2)}`;
}

function downloadAggregates(results: BenchmarkResult[]): void {
  const payload = {
    generatedAt: new Date().toISOString(),
    scenarioCount: results.length,
    metricCoverage: {
      updateLatency: "captured",
      throughput: "captured",
      iqr: "captured",
      cpuUsage: "external-devtools-required",
      renderingTime: "external-devtools-required",
      memoryUsage: "captured-if-browser-supports-performance-memory",
    },
    results,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nested-ui-benchmark-results.json";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const adapterRegistry: BenchmarkAdapterWithVariant[] = [
  {
    framework: "React" as const,
    variant: "baseline" as const,
    mount: mountReactTree,
  },
  {
    framework: "React" as const,
    variant: "optimized" as const,
    mount: mountReactTreeOptimized,
  },
  {
    framework: "Solid" as const,
    variant: "baseline" as const,
    mount: mountSolidTree,
  },
  {
    framework: "Solid" as const,
    variant: "optimized" as const,
    mount: mountSolidTreeOptimized,
  },
];

function resolveAdapter(
  framework: FrameworkName,
  variant: BenchmarkVariant,
): BenchmarkAdapterWithVariant {
  const adapter = adapterRegistry.find(
    (entry) => entry.framework === framework && entry.variant === variant,
  );

  if (!adapter) {
    throw new Error(`Adapter not found for ${framework} ${variant}`);
  }

  return adapter;
}

async function runConditionForAutomation(
  input: AutomationConditionInput,
): Promise<{ aggregate: BenchmarkResult; runs: BenchmarkResult[] }> {
  const adapter = resolveAdapter(input.framework, input.variant);
  const runs: BenchmarkResult[] = [];

  for (let run = 0; run < input.suiteRuns; run += 1) {
    const [result] = runNestedResearchSuite(
      adapter,
      input.options,
      [input.scenario],
      { visualMode: false },
    );
    if (result) {
      runs.push(result);
    }
    await nextFrame();
  }

  if (runs.length === 0) {
    throw new Error("No benchmark runs were captured.");
  }

  return {
    aggregate: aggregate(input.scenario, input.framework, input.variant, runs),
    runs,
  };
}

window.__nestedUiBenchmark = {
  scenarios: getNestedBenchmarkScenarios().map((scenario) => scenario.key),
  runCondition: runConditionForAutomation,
};

function getEffectiveOptions(
  options: BenchmarkOptions,
  visualMode: boolean,
): BenchmarkOptions {
  if (!visualMode) {
    return options;
  }

  // Visual mode prioritizes responsiveness over benchmark rigor.
  return {
    depth: Math.min(options.depth, 5),
    breadth: Math.min(options.breadth, 2),
    warmupIterations: Math.min(options.warmupIterations, 3),
    iterations: Math.min(options.iterations, 12),
  };
}

async function runSuite(): Promise<void> {
  runSuiteBtn.disabled = true;
  downloadResultsBtn.disabled = true;
  resultsBodyEl.innerHTML = "";
  runLogEl.textContent = "";
  visualHostEl.innerHTML = "";
  lastAggregates = [];

  const options = {
    depth: parseInput(depthEl),
    breadth: parseInput(breadthEl),
    warmupIterations: parseInput(warmupEl),
    iterations: parseInput(iterationsEl),
  };

  const suiteRuns = parseInput(suiteRunsEl);
  const visualMode = visualModeEl.checked;
  const effectiveOptions = getEffectiveOptions(options, visualMode);
  const effectiveSuiteRuns = visualMode ? Math.min(suiteRuns, 2) : suiteRuns;

  statusEl.textContent = visualMode
    ? `Running ${effectiveSuiteRuns} visual suite iteration(s) with reduced workload...`
    : `Running ${effectiveSuiteRuns} suite iterations...`;

  const scenarioKeys = getNestedBenchmarkScenarios().map(
    (scenario) => scenario.key,
  );
  const grouped: Record<
    BenchmarkScenarioKey,
    Record<`${FrameworkName}-${BenchmarkVariant}`, BenchmarkResult[]>
  > = scenarioKeys.reduce(
    (acc, scenario) => {
      acc[scenario] = {
        "React-baseline": [],
        "React-optimized": [],
        "Solid-baseline": [],
        "Solid-optimized": [],
      };
      return acc;
    },
    {} as Record<
      BenchmarkScenarioKey,
      Record<`${FrameworkName}-${BenchmarkVariant}`, BenchmarkResult[]>
    >,
  );

  try {
    for (let run = 1; run <= effectiveSuiteRuns; run += 1) {
      for (const adapter of adapterRegistry) {
        for (const scenarioKey of scenarioKeys) {
          statusEl.textContent = `Run ${run}/${effectiveSuiteRuns} - ${adapter.framework} ${adapter.variant} - ${scenarioKey}`;
          const [result] = runNestedResearchSuite(
            adapter,
            effectiveOptions,
            [scenarioKey],
            {
              visualMode,
              visualHostParent: visualMode ? visualHostEl : undefined,
            },
          );

          if (!result) {
            continue;
          }

          grouped[result.scenario][adapterKey(adapter)].push(result);
          runLogEl.textContent += `Run ${run} ${formatResult(result)}\n`;
          await nextFrame();
        }
      }
      await nextFrame();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown benchmark failure";
    statusEl.textContent = `Benchmark failed: ${message}`;
    runLogEl.textContent += `\nError: ${message}\n`;
    return;
  } finally {
    runSuiteBtn.disabled = false;
  }

  const aggregatePlan: Array<{
    framework: FrameworkName;
    variant: BenchmarkVariant;
  }> = [
    { framework: "React", variant: "baseline" },
    { framework: "React", variant: "optimized" },
    { framework: "Solid", variant: "baseline" },
    { framework: "Solid", variant: "optimized" },
  ];

  const aggregates = scenarioKeys.flatMap((scenarioKey) =>
    aggregatePlan.map((entry) =>
      aggregate(
        scenarioKey,
        entry.framework,
        entry.variant,
        grouped[scenarioKey][`${entry.framework}-${entry.variant}`],
      ),
    ),
  );

  lastAggregates = aggregates;
  downloadResultsBtn.disabled = aggregates.length === 0;

  resultsBodyEl.innerHTML = aggregates
    .map(
      (result) =>
        `<tr><td>${result.scenario}</td><td>${result.framework}</td><td>${result.variant}</td><td>${result.meanMs.toFixed(4)}</td><td>${result.iqrMs.toFixed(4)}</td><td>${result.p95Ms.toFixed(4)}</td><td>${result.opsPerSecond.toFixed(2)}</td></tr>`,
    )
    .join("");

  const totals = aggregates.reduce(
    (acc, result) => {
      acc[adapterKey(result)] += result.opsPerSecond;
      return acc;
    },
    {
      "React-baseline": 0,
      "React-optimized": 0,
      "Solid-baseline": 0,
      "Solid-optimized": 0,
    },
  );

  const winner =
    Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
  statusEl.textContent = `Completed. Higher combined ops/s across scenarios: ${winner}`;
}

runSuiteBtn.addEventListener("click", () => {
  void runSuite();
});

downloadResultsBtn.addEventListener("click", () => {
  if (lastAggregates.length === 0) {
    return;
  }

  downloadAggregates(lastAggregates);
});
