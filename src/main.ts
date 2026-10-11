import "./style.css";
import {
  getNestedBenchmarkScenarios,
  nextFrame,
  runNestedResearchSuite,
  summarizeLatencies,
} from "./benchmark/runner";
import { adapters, controlAdapter } from "./frameworks/adapters";
import {
  buildBenchmarkDownloadPayload,
  getExperimentEnvironment,
} from "./benchmark/export";
import type {
  BenchmarkAdapter,
  BenchmarkMeasurement,
  BenchmarkResult,
  BenchmarkRunOptions,
  BenchmarkScenarioKey,
  BenchmarkVariant,
  FrameworkName,
} from "./benchmark/types";

interface AutomationConditionInput {
  framework: FrameworkName;
  variant: BenchmarkVariant;
  scenario: BenchmarkScenarioKey;
  options: BenchmarkRunOptions;
  suiteRuns: number;
  captureMetrics?: boolean;
  pauseAtMeasurementBoundaries?: boolean;
}

type BoundaryPhase = "after-warmup" | "after-measured";

interface AutomationApi {
  scenarios: BenchmarkScenarioKey[];
  adapters: Array<Pick<BenchmarkAdapter, "framework" | "variant">>;
  buildMode: string;
  environment: ReturnType<typeof getExperimentEnvironment>;
  runCondition(input: AutomationConditionInput): Promise<{
    aggregate: BenchmarkResult;
    runs: BenchmarkResult[];
  }>;
  boundaryPhase: BoundaryPhase | null;
  waitForBoundary(phase: BoundaryPhase): Promise<void>;
  resumeAtMeasurementBoundary(): void;
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
      <p class="lead">Compare deep-tree updates, root update propagation, partial subtree invalidation, and controlled update patterns using deterministic schedules.</p>
    </header>

    <section class="panel controls">
      <h2>Benchmark Controls</h2>
      <div class="control-grid">
        <label>Warmup <input id="warmup" type="number" min="0" max="300" value="5" /></label>
        <label>Iterations <input id="iterations" type="number" min="10" max="1000" value="25" /></label>
        <label>Suite Runs <input id="suiteRuns" type="number" min="1" max="20" value="1" /></label>
      </div>
      <p class="protocol-summary">Thesis configuration per run: 5 warm-ups, 25 measured operations. Thesis results use independent suite runs from <code>npm run metrics:chrome</code>; this page is for single runs and debugging. Tree shapes are fixed per scenario (${getNestedBenchmarkScenarios()
        .map(
          (scenario) =>
            `${scenario.label}: ${scenario.depth} &times; ${scenario.breadth}`,
        )
        .join("; ")}).</p>
      <label class="toggle-row">
        <input id="visualMode" type="checkbox" />
        <span>Debug visual mode</span>
      </label>
      <div class="actions">
        <button id="runSuite" class="run-button">Run Comparison</button>
        <button id="downloadResults" class="run-button" disabled>Export JSON</button>
      </div>
      <p id="status" class="status">Idle</p>
    </section>

    <section id="visualPanel" class="panel visual-panel" hidden>
      <h2>Live Tree Preview</h2>
      <p class="visual-note">Enable debug visual mode to watch updates in-flight. The preview renders one scenario/framework run at a time.</p>
      <div id="visualHost" class="visual-host"></div>
    </section>

    <section class="panel results-panel">
      <h2>Results</h2>
      <p id="resultsSummary" class="results-summary">No results yet.</p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Framework</th>
              <th>Variant</th>
              <th>Median (ms)</th>
              <th>IQR (ms)</th>
              <th>Mean (ms)</th>
              <th>p95 (ms)</th>
              <th>Ops/s</th>
            </tr>
          </thead>
          <tbody id="resultsBody"></tbody>
        </table>
      </div>
    </section>

    <section class="panel log-panel">
      <h2>Run Log</h2>
      <pre id="runLog"></pre>
    </section>
  </main>
`;

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Benchmark element ${selector} was not found.`);
  }
  return element;
}

const warmupEl = getElement<HTMLInputElement>("#warmup");
const iterationsEl = getElement<HTMLInputElement>("#iterations");
const suiteRunsEl = getElement<HTMLInputElement>("#suiteRuns");
const visualModeEl = getElement<HTMLInputElement>("#visualMode");
const runSuiteBtn = getElement<HTMLButtonElement>("#runSuite");
const downloadResultsBtn = getElement<HTMLButtonElement>("#downloadResults");
const statusEl = getElement<HTMLParagraphElement>("#status");
const resultsBodyEl = getElement<HTMLTableSectionElement>("#resultsBody");
const runLogEl = getElement<HTMLPreElement>("#runLog");
const visualHostEl = getElement<HTMLDivElement>("#visualHost");
const visualPanelEl = getElement<HTMLElement>("#visualPanel");
const resultsSummaryEl = getElement<HTMLParagraphElement>("#resultsSummary");
let lastAggregates: BenchmarkResult[] = [];
let lastRawMeasurements: BenchmarkMeasurement[] = [];
let boundaryPhase: BoundaryPhase | null = null;
let boundaryWaiter: { phase: BoundaryPhase; resolve: () => void } | undefined;
let resumeAtMeasurementBoundary: (() => void) | undefined;

function parseInput(input: HTMLInputElement): number {
  return Number.parseInt(input.value, 10);
}

function usesThesisConfiguration(
  options: BenchmarkRunOptions,
  suiteRuns: number,
  visualMode: boolean,
): boolean {
  return (
    options.warmupIterations === 5 &&
    options.iterations === 25 &&
    suiteRuns === 1 &&
    !visualMode
  );
}

function updateVisualModeVisibility(): void {
  visualPanelEl.hidden = !visualModeEl.checked;
  if (!visualModeEl.checked) {
    visualHostEl.innerHTML = "";
  }
}

// Pools measured latencies across suite runs; averaging per-run percentiles would not yield valid percentiles.
function aggregate(runs: BenchmarkResult[]): BenchmarkResult {
  const measurements = runs.flatMap((run) => run.measurements);
  return {
    ...runs[0],
    ...summarizeLatencies(
      measurements
        .filter((measurement) => measurement.phase === "measured")
        .map((measurement) => measurement.updateLatencyMs),
    ),
    measurements,
  };
}

function formatResult(result: BenchmarkResult): string {
  return `${result.scenario.padEnd(30)} | ${result.framework.padEnd(5)} | ${result.variant.padEnd(9)} | shape=${result.options.depth}x${result.options.breadth} | median=${result.medianMs.toFixed(4)}ms | mean=${result.meanMs.toFixed(4)}ms | p95=${result.p95Ms.toFixed(4)}ms | ops/s=${result.opsPerSecond.toFixed(2)}`;
}

function downloadAggregates(
  results: BenchmarkResult[],
  rawMeasurements: BenchmarkMeasurement[],
): void {
  const payload = buildBenchmarkDownloadPayload(results, rawMeasurements);
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

function pauseAtMeasurementBoundary(phase: BoundaryPhase): Promise<void> {
  if (resumeAtMeasurementBoundary) {
    throw new Error("A benchmark measurement boundary is already paused.");
  }

  boundaryPhase = phase;
  if (boundaryWaiter?.phase === phase) {
    boundaryWaiter.resolve();
    boundaryWaiter = undefined;
  }
  return new Promise((resolve) => {
    resumeAtMeasurementBoundary = () => {
      resumeAtMeasurementBoundary = undefined;
      boundaryPhase = null;
      resolve();
    };
  });
}

// Lets automation await a boundary without polling inside the measured window.
function waitForBoundary(phase: BoundaryPhase): Promise<void> {
  if (boundaryPhase === phase) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    boundaryWaiter = { phase, resolve };
  });
}

const automationAdapters = [...adapters, controlAdapter];

function resolveAdapter(
  framework: FrameworkName,
  variant: BenchmarkVariant,
): BenchmarkAdapter {
  const adapter = automationAdapters.find(
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
  const capture = input.captureMetrics ?? true;

  if (input.pauseAtMeasurementBoundaries && input.suiteRuns !== 1) {
    throw new Error(
      "Boundary-paused automation requires suiteRuns to equal 1.",
    );
  }

  for (let run = 0; run < input.suiteRuns; run += 1) {
    const [result] = await runNestedResearchSuite(
      adapter,
      input.options,
      [input.scenario],
      {
        visualMode: false,
        captureMetrics: capture,
        onAfterWarmup: input.pauseAtMeasurementBoundaries
          ? () => pauseAtMeasurementBoundary("after-warmup")
          : undefined,
        onAfterMeasured: input.pauseAtMeasurementBoundaries
          ? () => pauseAtMeasurementBoundary("after-measured")
          : undefined,
      },
    );
    runs.push(result);
    await nextFrame();
  }

  return {
    aggregate: aggregate(runs),
    runs,
  };
}

window.__nestedUiBenchmark = {
  scenarios: getNestedBenchmarkScenarios().map((scenario) => scenario.key),
  adapters: automationAdapters.map(({ framework, variant }) => ({
    framework,
    variant,
  })),
  buildMode: import.meta.env.MODE,
  environment: getExperimentEnvironment(),
  runCondition: runConditionForAutomation,
  get boundaryPhase() {
    return boundaryPhase;
  },
  waitForBoundary,
  resumeAtMeasurementBoundary() {
    if (!resumeAtMeasurementBoundary) {
      throw new Error("No benchmark measurement boundary is paused.");
    }

    resumeAtMeasurementBoundary();
  },
};

function getEffectiveOptions(
  options: BenchmarkRunOptions,
  visualMode: boolean,
): BenchmarkRunOptions {
  if (!visualMode) {
    return options;
  }

  // Visual mode prioritizes responsiveness over benchmark rigor.
  return {
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
  resultsSummaryEl.textContent = "Running benchmark matrix...";
  lastAggregates = [];
  lastRawMeasurements = [];

  const options = {
    warmupIterations: parseInput(warmupEl),
    iterations: parseInput(iterationsEl),
  };

  const suiteRuns = parseInput(suiteRunsEl);
  const visualMode = visualModeEl.checked;
  const effectiveOptions = getEffectiveOptions(options, visualMode);
  const thesisConfiguration = usesThesisConfiguration(
    options,
    suiteRuns,
    visualMode,
  );

  statusEl.textContent = `Running ${suiteRuns} ${visualMode ? "visual " : ""}suite iteration(s)...`;

  const scenarioKeys = getNestedBenchmarkScenarios().map(
    (scenario) => scenario.key,
  );
  const results: BenchmarkResult[] = [];

  try {
    for (let run = 1; run <= suiteRuns; run += 1) {
      for (const adapter of adapters) {
        for (const scenarioKey of scenarioKeys) {
          statusEl.textContent = `Run ${run}/${suiteRuns} - ${adapter.framework} ${adapter.variant} - ${scenarioKey}`;
          const [result] = await runNestedResearchSuite(
            adapter,
            effectiveOptions,
            [scenarioKey],
            {
              visualMode,
              visualHostParent: visualMode ? visualHostEl : undefined,
              captureMetrics: visualMode,
            },
          );

          results.push(result);
          lastRawMeasurements.push(...result.measurements);
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
    resultsSummaryEl.textContent = "No valid results were produced.";
    return;
  } finally {
    runSuiteBtn.disabled = false;
  }

  const aggregates = scenarioKeys.flatMap((scenarioKey) =>
    adapters.map((adapter) =>
      aggregate(
        results.filter(
          (result) =>
            result.scenario === scenarioKey &&
            result.framework === adapter.framework &&
            result.variant === adapter.variant,
        ),
      ),
    ),
  );

  lastAggregates = aggregates;
  downloadResultsBtn.disabled = aggregates.length === 0;

  resultsBodyEl.innerHTML = aggregates
    .map(
      (result) =>
        `<tr><td>${result.scenario}</td><td>${result.framework}</td><td>${result.variant}</td><td>${result.medianMs.toFixed(4)}</td><td>${result.iqrMs.toFixed(4)}</td><td>${result.meanMs.toFixed(4)}</td><td>${result.p95Ms.toFixed(4)}</td><td>${result.opsPerSecond.toFixed(2)}</td></tr>`,
    )
    .join("");
  resultsSummaryEl.textContent = thesisConfiguration
    ? `${aggregates.length} condition summaries; 25 measured operations per condition.`
    : `Custom configuration: ${effectiveOptions.warmupIterations} warm-ups and ${effectiveOptions.iterations} measured operations per condition.`;
  statusEl.textContent = thesisConfiguration
    ? "Completed with the thesis per-run configuration."
    : visualMode
      ? "Debug preview completed; do not use these values for thesis analysis."
      : "Completed with a custom configuration.";
}

visualModeEl.addEventListener("change", updateVisualModeVisibility);

runSuiteBtn.addEventListener("click", () => {
  void runSuite();
});

downloadResultsBtn.addEventListener("click", () => {
  if (lastAggregates.length === 0) {
    return;
  }

  downloadAggregates(lastAggregates, lastRawMeasurements);
});
