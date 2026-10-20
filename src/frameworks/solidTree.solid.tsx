/** @jsxImportSource solid-js */
import {
  batch,
  createMemo,
  createSignal,
  Index,
  type Accessor,
} from "solid-js";
import { render } from "solid-js/web";
import type {
  BenchmarkOperation,
  MountedTree,
  TreeNode,
} from "../benchmark/types";
import { applyOperation } from "../benchmark/tree";

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
          {/* Index reuses child components and patches them in place on immutable updates. */}
          <Index each={props.node.children}>
            {(child) => (
              <SolidTreeNode node={child()} level={props.level + 1} />
            )}
          </Index>
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
          {/* Children never change after mount; direct mapping avoids list reconciliation work. */}
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
    apply(operation) {
      setTree((previous) => applyOperation(previous, operation));
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
        // One propagation per operation, matching React's single flushSync render.
        batch(() => applyDeltaToReactiveSubtree(target, operation.nextValue));
        return;
      }

      target.setValue(operation.nextValue);
    },
    dispose,
  };
}
