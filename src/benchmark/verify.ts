import type {
  BenchmarkAdapter,
  BenchmarkOperation,
  BenchmarkOperationKind,
  BenchmarkScenarioKey,
  TreeNode,
} from "./types";

// Expected display state kept separately from tree.ts update helpers, which the adapters use themselves.
export function createOracle(root: TreeNode) {
  const order: TreeNode[] = [];
  const levels: number[] = [];
  const walk = (node: TreeNode, level: number): void => {
    order.push(node);
    levels.push(level);
    node.children.forEach((child) => walk(child, level + 1));
  };
  walk(root, 0);

  const values = new Map(order.map((node) => [node.id, node.value]));
  const subtreeIds = (node: TreeNode): number[] => [
    node.id,
    ...node.children.flatMap(subtreeIds),
  ];

  return {
    levels,
    apply(operation: BenchmarkOperation): void {
      const target = operation.path.reduce<TreeNode | undefined>(
        (node, index) => node?.children[index],
        root,
      );
      if (!target) {
        throw new Error(`Invalid path ${operation.path.join(".")}`);
      }
      if (operation.kind === "point") {
        values.set(target.id, operation.nextValue);
        return;
      }
      for (const id of subtreeIds(target)) {
        values.set(id, values.get(id)! + operation.nextValue);
      }
    },
    labels: (): string[] =>
      order.map((node) => `#${node.id}: ${values.get(node.id)}`),
  };
}

export function expectedFinalLabels(
  adapter: Pick<BenchmarkAdapter, "framework">,
  root: TreeNode,
  schedule: BenchmarkOperation[],
): string[] {
  const oracle = createOracle(root);
  // Control ignores updates by design, so it must keep showing the initial tree.
  if (adapter.framework !== "Control") {
    schedule.forEach((operation) => oracle.apply(operation));
  }
  return oracle.labels();
}

export function renderedLabelsMatch(
  host: HTMLElement,
  expected: string[],
): boolean {
  const pills = host.querySelectorAll(".node-pill");
  return (
    pills.length === expected.length &&
    expected.every((label, index) => pills[index].textContent === label)
  );
}

export interface CorrectnessStep {
  step: number;
  kind: BenchmarkOperationKind | "mount";
  pathDepth: number | null;
  labelsMatch: boolean;
  structureMatches: boolean;
  changedLabels: number;
  mutatedPills: number;
  unchangedPillsMutated: number;
  mutationRecords: number;
  mutationsOutsidePills: number;
  firstMismatch: {
    index: number;
    expected: string;
    actual: string | null;
  } | null;
}

export interface CorrectnessResult {
  framework: BenchmarkAdapter["framework"];
  variant: BenchmarkAdapter["variant"];
  scenario: BenchmarkScenarioKey;
  passed: boolean;
  steps: CorrectnessStep[];
}

function attributeMutationsToPills(
  records: MutationRecord[],
  pills: Element[],
): { mutated: Set<number>; mutationsOutsidePills: number } {
  // Attribute each observer record to its containing label; these diagnostics do not decide pass/fail.
  const pillIndex = new Map(pills.map((pill, index) => [pill, index]));
  const mutated = new Set<number>();
  let mutationsOutsidePills = 0;

  for (const record of records) {
    const element =
      record.target instanceof Element
        ? record.target
        : record.target.parentElement;
    const pill = element?.closest(".node-pill");
    const index = pill ? pillIndex.get(pill) : undefined;
    if (index === undefined) {
      mutationsOutsidePills += 1;
    } else {
      mutated.add(index);
    }
  }

  return { mutated, mutationsOutsidePills };
}

function inspectDom(
  host: HTMLElement,
  levels: number[],
  previous: string[],
  expected: string[],
  records: MutationRecord[],
  step: number,
  kind: CorrectnessStep["kind"],
  pathDepth: number | null,
): CorrectnessStep {
  const pills = [...host.querySelectorAll(".node-pill")];
  const nodes = [...host.querySelectorAll<HTMLElement>(".tree-node")];
  const { mutated, mutationsOutsidePills } = attributeMutationsToPills(
    records,
    pills,
  );

  const mismatch = expected.findIndex(
    (label, index) => pills[index]?.textContent !== label,
  );

  return {
    step,
    kind,
    pathDepth,
    labelsMatch: pills.length === expected.length && mismatch === -1,
    structureMatches:
      nodes.length === levels.length &&
      levels.every(
        (level, index) => nodes[index].dataset.level === String(level),
      ),
    changedLabels: expected.filter((label, index) => label !== previous[index])
      .length,
    mutatedPills: mutated.size,
    unchangedPillsMutated: [...mutated].filter(
      (index) => expected[index] === previous[index],
    ).length,
    mutationRecords: records.length,
    mutationsOutsidePills,
    firstMismatch:
      mismatch === -1
        ? null
        : {
            index: mismatch,
            expected: expected[mismatch],
            actual: pills[mismatch]?.textContent ?? null,
          },
  };
}

// Checks every pill after each apply() returns, before yielding, so deferred framework work cannot hide a stale DOM.
export function verifyScenario(
  adapter: BenchmarkAdapter,
  scenario: BenchmarkScenarioKey,
  root: TreeNode,
  schedule: BenchmarkOperation[],
): CorrectnessResult {
  const host = document.createElement("div");
  host.className = "bench-host";
  document.body.append(host);
  const mounted = adapter.mount(host, root);
  const oracle = createOracle(root);
  const appliesUpdates = adapter.framework !== "Control";
  const observer = new MutationObserver(() => {});
  // apply() must finish DOM work synchronously for this benchmark; records are drained per operation.
  observer.observe(host, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });

  let previous = oracle.labels();
  const steps = [
    inspectDom(host, oracle.levels, previous, previous, [], 0, "mount", null),
  ];

  schedule.forEach((operation, index) => {
    mounted.apply(operation);
    const records = observer.takeRecords();
    if (appliesUpdates) {
      oracle.apply(operation);
    }
    const expected = oracle.labels();
    steps.push(
      inspectDom(
        host,
        oracle.levels,
        previous,
        expected,
        records,
        index + 1,
        operation.kind,
        operation.path.length,
      ),
    );
    previous = expected;
  });

  observer.disconnect();
  mounted.dispose();
  host.remove();

  return {
    framework: adapter.framework,
    variant: adapter.variant,
    scenario,
    passed: steps.every((step) => step.labelsMatch && step.structureMatches),
    steps,
  };
}
