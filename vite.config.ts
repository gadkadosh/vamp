import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Tests start their own Workers runtime through Wrangler's test harness.
    ...(mode === "test" ? [] : [cloudflare({ viteEnvironment: { name: "worker" } })]),
  ],
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["worker-configuration.d.ts"],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
}));
