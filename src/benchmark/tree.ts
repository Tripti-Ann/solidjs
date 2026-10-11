import type { BenchmarkOperation, TreeNode, TreePath } from "./types";

export function createTree(depth: number, breadth: number): TreeNode {
  let idCounter = 0;

  function build(level: number): TreeNode {
    const nodeId = idCounter;
    idCounter += 1;

    if (level >= depth) {
      return {
        id: nodeId,
        value: 0,
        children: [],
      };
    }

    return {
      id: nodeId,
      value: 0,
      children: Array.from({ length: breadth }, () => build(level + 1)),
    };
  }

  return build(0);
}

export function getLeafPaths(node: TreeNode): TreePath[] {
  const paths: TreePath[] = [];

  function walk(current: TreeNode, path: TreePath): void {
    if (current.children.length === 0) {
      paths.push(path);
      return;
    }

    current.children.forEach((child, index) => {
      walk(child, [...path, index]);
    });
  }

  walk(node, []);
  return paths;
}

export function getInternalPaths(node: TreeNode): TreePath[] {
  const paths: TreePath[] = [];

  function walk(current: TreeNode, path: TreePath): void {
    if (current.children.length > 0) {
      paths.push(path);
    }

    current.children.forEach((child, index) => {
      walk(child, [...path, index]);
    });
  }

  walk(node, []);
  return paths;
}

export function pathsAtDepth(node: TreeNode, depth: number): TreePath[] {
  const matches: TreePath[] = [];

  function walk(current: TreeNode, path: TreePath): void {
    if (path.length === depth) {
      matches.push(path);
      return;
    }

    current.children.forEach((child, index) => {
      walk(child, [...path, index]);
    });
  }

  walk(node, []);
  return matches;
}

export function updateTreeAtPath(
  node: TreeNode,
  path: TreePath,
  nextValue: number,
): TreeNode {
  if (path.length === 0) {
    return {
      ...node,
      value: nextValue,
    };
  }

  const [head, ...tail] = path;
  return {
    ...node,
    children: node.children.map((child, index) =>
      index === head ? updateTreeAtPath(child, tail, nextValue) : child,
    ),
  };
}

function applyDeltaToSubtree(node: TreeNode, delta: number): TreeNode {
  return {
    ...node,
    value: node.value + delta,
    children: node.children.map((child) => applyDeltaToSubtree(child, delta)),
  };
}

export function updateSubtreeAtPath(
  node: TreeNode,
  path: TreePath,
  delta: number,
): TreeNode {
  if (path.length === 0) {
    return applyDeltaToSubtree(node, delta);
  }

  const [head, ...tail] = path;
  return {
    ...node,
    children: node.children.map((child, index) =>
      index === head ? updateSubtreeAtPath(child, tail, delta) : child,
    ),
  };
}

export function applyOperation(
  node: TreeNode,
  operation: BenchmarkOperation,
): TreeNode {
  return operation.kind === "subtree"
    ? updateSubtreeAtPath(node, operation.path, operation.nextValue)
    : updateTreeAtPath(node, operation.path, operation.nextValue);
}
