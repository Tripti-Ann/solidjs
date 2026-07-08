// @vitest-environment jsdom
import { bench, describe } from "vitest";
import {
  getNestedBenchmarkScenarios,
  runNestedResearchSuite,
} from "../src/benchmark/runner";
import {
  mountReactTree,
  mountReactTreeOptimized,
} from "../src/frameworks/reactTree.react";
import {
  mountSolidTree,
  mountSolidTreeOptimized,
} from "../src/frameworks/solidTree.solid";

const options = {
  depth: 5,
  breadth: 3,
  warmupIterations: 5,
  iterations: 20,
};

describe("nested UI update benchmark", () => {
  const scenarios = getNestedBenchmarkScenarios();

  for (const scenario of scenarios) {
    bench(`React :: ${scenario.key}`, () => {
      runNestedResearchSuite(
        {
          framework: "React",
          variant: "baseline",
          mount: mountReactTree,
        },
        options,
        [scenario.key],
      );
    });

    bench(`React (optimized) :: ${scenario.key}`, () => {
      runNestedResearchSuite(
        {
          framework: "React",
          variant: "optimized",
          mount: mountReactTreeOptimized,
        },
        options,
        [scenario.key],
      );
    });

    bench(`Solid :: ${scenario.key}`, () => {
      runNestedResearchSuite(
        {
          framework: "Solid",
          variant: "baseline",
          mount: mountSolidTree,
        },
        options,
        [scenario.key],
      );
    });

    bench(`Solid (optimized) :: ${scenario.key}`, () => {
      runNestedResearchSuite(
        {
          framework: "Solid",
          variant: "optimized",
          mount: mountSolidTreeOptimized,
        },
        options,
        [scenario.key],
      );
    });
  }
});
