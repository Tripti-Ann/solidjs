import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import type { MountedTree, TreeNode } from "../benchmark/types";
import { applyOperation } from "../benchmark/tree";

function ReactTreeNode(props: { node: TreeNode; level: number }) {
  return (
    <div className="tree-node" data-level={props.level}>
      <div className="node-pill">
        #{props.node.id}: {props.node.value}
      </div>
      {props.node.children.length > 0 ? (
        <div className="node-children">
          {props.node.children.map((child) => (
            <ReactTreeNode
              key={child.id}
              node={child}
              level={props.level + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const ReactTreeNodeOptimized = memo(function ReactTreeNodeOptimized(props: {
  node: TreeNode;
  level: number;
}) {
  const level = props.level;
  const renderChild = useCallback(
    (child: TreeNode) => (
      <ReactTreeNodeOptimized key={child.id} node={child} level={level + 1} />
    ),
    [level],
  );
  const label = useMemo(
    () => `#${props.node.id}: ${props.node.value}`,
    [props.node.id, props.node.value],
  );
  const children = useMemo(
    () => props.node.children.map(renderChild),
    [props.node.children, renderChild],
  );

  return (
    <div className="tree-node" data-level={level}>
      <div className="node-pill">{label}</div>
      {props.node.children.length > 0 ? (
        <div className="node-children">{children}</div>
      ) : null}
    </div>
  );
});

function mountReactTreeWithView(
  container: HTMLElement,
  initialTree: TreeNode,
  renderer: (tree: TreeNode) => ReactElement,
): MountedTree {
  let current = initialTree;
  const root: Root = createRoot(container);

  function renderTree() {
    root.render(renderer(current));
  }

  flushSync(renderTree);

  return {
    apply(operation) {
      current = applyOperation(current, operation);
      flushSync(renderTree);
    },
    dispose() {
      root.unmount();
    },
  };
}

export function mountReactTree(
  container: HTMLElement,
  initialTree: TreeNode,
): MountedTree {
  return mountReactTreeWithView(container, initialTree, (tree) => (
    <ReactTreeNode node={tree} level={0} />
  ));
}

export function mountReactTreeOptimized(
  container: HTMLElement,
  initialTree: TreeNode,
): MountedTree {
  return mountReactTreeWithView(container, initialTree, (tree) => (
    <ReactTreeNodeOptimized node={tree} level={0} />
  ));
}
