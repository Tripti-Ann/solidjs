import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import solid from "vite-plugin-solid";
import solidPackage from "solid-js/package.json" with { type: "json" };

const isVitest = Boolean(
  (globalThis as { process?: { env?: { VITEST?: string } } }).process?.env
    ?.VITEST,
);

const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  define: {
    __SOLID_VERSION__: JSON.stringify(solidPackage.version),
  },
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
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
