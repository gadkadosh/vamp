import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [{ configPath: "./wrangler.jsonc" }],
});

beforeAll(() => server.listen(), 30_000);
afterAll(() => server.close());

test("GET /api/health responds from the Workers runtime", async () => {
  const response = await server.fetch("/api/health");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ ok: true });
}, 30_000);
