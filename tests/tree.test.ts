import { describe, expect, it } from "vitest";
import {
  createTree,
  getInternalPaths,
  getLeafPaths,
  pathsAtDepth,
  updateSubtreeAtPath,
  updateTreeAtPath,
} from "../src/benchmark/tree";

describe("tree scenario helpers", () => {
  it("builds a complete tree and returns all leaf paths", () => {
    const tree = createTree(3, 2);
    const leafPaths = getLeafPaths(tree);

    expect(leafPaths.length).toBe(8);
    expect(leafPaths.every((path) => path.length === 3)).toBe(true);
  });

  it("updates only the selected branch", () => {
    const tree = createTree(2, 2);
    const updated = updateTreeAtPath(tree, [1, 0], 42);

    expect(updated.children[1].children[0].value).toBe(42);
    expect(updated.children[0].children[0].value).toBe(0);
    expect(updated.children[0]).toBe(tree.children[0]);
    expect(updated.children[1]).not.toBe(tree.children[1]);
  });

  it("returns internal paths including root", () => {
    const tree = createTree(2, 2);
    const internalPaths = getInternalPaths(tree);

    expect(internalPaths).toContainEqual([]);
    expect(internalPaths).toContainEqual([0]);
    expect(internalPaths).toContainEqual([1]);
    expect(internalPaths).not.toContainEqual([0, 0]);
  });

  it("finds all paths at a specific depth", () => {
    const tree = createTree(3, 2);
    const depthTwo = pathsAtDepth(tree, 2);

    expect(depthTwo.length).toBe(4);
    expect(depthTwo).toContainEqual([0, 0]);
    expect(depthTwo).toContainEqual([1, 1]);
  });

  it("updates every node in a selected subtree", () => {
    const tree = createTree(2, 2);
    const updated = updateSubtreeAtPath(tree, [1], 3);

    expect(updated.children[1].value).toBe(3);
    expect(updated.children[1].children[0].value).toBe(3);
    expect(updated.children[0].children[0].value).toBe(0);
    expect(updated.children[0]).toBe(tree.children[0]);
  });
});
