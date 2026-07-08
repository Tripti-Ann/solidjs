import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import solid from "vite-plugin-solid";

const isVitest = Boolean(
  (globalThis as { process?: { env?: { VITEST?: string } } }).process?.env
    ?.VITEST,
);

export default defineConfig({
  plugins: [
    react({ include: /\.react\.tsx$/ }),
    // Keep Solid JSX transform enabled in Vitest, but disable refresh injection there.
    solid({ include: /\.solid\.tsx$/, hot: !isVitest }),
  ],
  resolve: {
    alias: isVitest
      ? {
          "solid-js/web": "solid-js/web/dist/web.js",
        }
      : {},
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
  },
});
