import type {
  BenchmarkAdapter,
  MountedTree,
  TreeNode,
} from "../benchmark/types";
import { mountReactTree, mountReactTreeOptimized } from "./reactTree.react";
import { mountSolidTree, mountSolidTreeOptimized } from "./solidTree.solid";

export const adapters: BenchmarkAdapter[] = [
  { framework: "React", variant: "baseline", mount: mountReactTree },
  { framework: "React", variant: "optimized", mount: mountReactTreeOptimized },
  { framework: "Solid", variant: "baseline", mount: mountSolidTree },
  { framework: "Solid", variant: "optimized", mount: mountSolidTreeOptimized },
];

function renderStaticNode(node: TreeNode, level: number): HTMLElement {
  const element = document.createElement("div");
  element.className = "tree-node";
  element.dataset.level = String(level);
  const pill = document.createElement("div");
  pill.className = "node-pill";
  pill.textContent = `#${node.id}: ${node.value}`;
  element.append(pill);
  if (node.children.length > 0) {
    const children = document.createElement("div");
    children.className = "node-children";
    children.append(
      ...node.children.map((child) => renderStaticNode(child, level + 1)),
    );
    element.append(children);
  }
  return element;
}

// Same markup, no framework, ignores updates: measures the harness overhead floor.
function mountControlTree(
  container: HTMLElement,
  initialTree: TreeNode,
): MountedTree {
  container.append(renderStaticNode(initialTree, 0));
  return {
    apply() {},
    dispose: () => container.replaceChildren(),
  };
}

export const controlAdapter: BenchmarkAdapter = {
  framework: "Control",
  variant: "baseline",
  mount: mountControlTree,
};
