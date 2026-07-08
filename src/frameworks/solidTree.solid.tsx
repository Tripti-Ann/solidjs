/** @jsxImportSource solid-js */
import { createMemo, createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import type { BenchmarkOperation, TreeNode } from "../benchmark/types";
import { updateSubtreeAtPath, updateTreeAtPath } from "../benchmark/tree";

interface MountedTree {
  apply(operation: BenchmarkOperation): void;
  dispose(): void;
}

interface ReactiveTreeNode {
  id: number;
  value: Accessor<number>;
  setValue: (next: number | ((previous: number) => number)) => number;
  children: ReactiveTreeNode[];
}

function SolidTreeNode(props: { node: TreeNode; level: number }) {
  return (
    <div class="tree-node" data-level={props.level}>
      <div class="node-pill">
        #{props.node.id}: {props.node.value}
      </div>
      {props.node.children.length > 0 ? (
        <div class="node-children">
          {props.node.children.map((child) => (
            <SolidTreeNode node={child} level={props.level + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SolidReactiveTreeNode(props: {
  node: ReactiveTreeNode;
  level: number;
}) {
  const label = createMemo(() => `#${props.node.id}: ${props.node.value()}`);

  return (
    <div class="tree-node" data-level={props.level}>
      <div class="node-pill">{label()}</div>
      {props.node.children.length > 0 ? (
        <div class="node-children">
          {props.node.children.map((child) => (
            <SolidReactiveTreeNode node={child} level={props.level + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildReactiveTree(node: TreeNode): ReactiveTreeNode {
  const [value, setValue] = createSignal(node.value);

  return {
    id: node.id,
    value,
    setValue,
    children: node.children.map(buildReactiveTree),
  };
}

function getReactiveNodeAtPath(
  node: ReactiveTreeNode,
  path: number[],
): ReactiveTreeNode {
  let current = node;

  for (const index of path) {
    current = current.children[index] ?? current;
  }

  return current;
}

function applyDeltaToReactiveSubtree(
  node: ReactiveTreeNode,
  delta: number,
): void {
  node.setValue((previous) => previous + delta);
  node.children.forEach((child) => applyDeltaToReactiveSubtree(child, delta));
}

export function mountSolidTree(
  container: HTMLElement,
  initialTree: TreeNode,
): MountedTree {
  const [tree, setTree] = createSignal(initialTree);
  const dispose = render(
    () => <SolidTreeNode node={tree()} level={0} />,
    container,
  );

  return {
    apply(operation: BenchmarkOperation) {
      setTree((previous) =>
        operation.kind === "subtree"
          ? updateSubtreeAtPath(previous, operation.path, operation.nextValue)
          : updateTreeAtPath(previous, operation.path, operation.nextValue),
      );
    },
    dispose,
  };
}

export function mountSolidTreeOptimized(
  container: HTMLElement,
  initialTree: TreeNode,
): MountedTree {
  const root = buildReactiveTree(initialTree);
  const dispose = render(
    () => <SolidReactiveTreeNode node={root} level={0} />,
    container,
  );

  return {
    apply(operation: BenchmarkOperation) {
      const target = getReactiveNodeAtPath(root, operation.path);
      if (operation.kind === "subtree") {
        applyDeltaToReactiveSubtree(target, operation.nextValue);
        return;
      }

      target.setValue(operation.nextValue);
    },
    dispose,
  };
}
