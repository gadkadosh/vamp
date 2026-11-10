import { afterAll, beforeAll, beforeEach, expect, test } from "vite-plus/test";
import { createTestHarness } from "wrangler";
import { COMPOSITION_ID } from "../src/shared/composition";
import type { Composition, EditResponse, NoteChange } from "../src/shared/composition";

const server = createTestHarness({
  workers: [{ configPath: "./wrangler.jsonc" }],
});

beforeAll(() => server.listen(), 30_000);
afterAll(() => server.close());

beforeEach(async () => {
  const worker = server.getWorker();
  const storage = await worker.getDurableObjectStorage("ROOM", { name: COMPOSITION_ID });
  await storage.exec("DELETE FROM compositions");
  await worker.evictDurableObject("ROOM", { name: COMPOSITION_ID });
});

async function composition() {
  const response = await server.fetch("/api/composition");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return (await response.json()) as Composition;
}

function edit(changes: NoteChange[]) {
  return server.fetch("/api/composition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compositionId: COMPOSITION_ID, changes }),
  });
}

const first = { id: "added-first", step: 2, tone: 9 };
const second = { id: "added-second", step: 6, tone: 10 };

test("GET /api/health responds from the Workers runtime", async () => {
  const response = await server.fetch("/api/health");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ ok: true });
}, 30_000);

test("initializes once, and preserves an intentionally empty pattern after eviction", async () => {
  const initial = await composition();
  expect(initial.id).toBe(COMPOSITION_ID);
  expect(initial.revision).toBe(0);
  expect(initial.pattern.notes).toHaveLength(20);
  expect(initial.pattern.notes.every(({ id }) => typeof id === "string")).toBe(true);
  const response = await edit(
    initial.pattern.notes.map(({ id }) => ({ type: "remove", id: String(id) })),
  );
  expect(response.status).toBe(200);
  await server.getWorker().evictDurableObject("ROOM", { name: COMPOSITION_ID });
  const restored = await composition();
  expect(restored.pattern.notes).toEqual([]);
  expect(restored.revision).toBe(1);
});

test("adds, moves, and removes notes durably without replacing the pattern", async () => {
  const initial = await composition();
  expect((await edit([{ type: "add", note: first }])).status).toBe(200);
  await server.getWorker().evictDurableObject("ROOM", { name: COMPOSITION_ID });
  expect((await composition()).pattern.notes).toEqual([...initial.pattern.notes, first]);
  const moved = { ...first, step: 3, tone: 10 };
  expect((await edit([{ type: "move", note: moved }])).status).toBe(200);
  expect((await composition()).pattern.notes).toEqual([...initial.pattern.notes, moved]);
  expect((await edit([{ type: "remove", id: first.id }])).status).toBe(200);
  await server.getWorker().evictDurableObject("ROOM", { name: COMPOSITION_ID });
  const restored = await composition();
  expect(restored.pattern).toEqual(initial.pattern);
  expect(restored.revision).toBe(3);
});

test("independent concurrent additions both survive", async () => {
  const initial = await composition();
  const responses = await Promise.all([
    edit([{ type: "add", note: first }]),
    edit([{ type: "add", note: second }]),
  ]);
  expect(responses.map(({ status }) => status)).toEqual([200, 200]);
  const saved = await composition();
  expect(saved.pattern.notes).toHaveLength(initial.pattern.notes.length + 2);
  expect(saved.pattern.notes).toEqual(
    expect.arrayContaining([...initial.pattern.notes, first, second]),
  );
  expect(saved.revision).toBe(2);
});

test("concurrent collisions accept one addition and return the current snapshot to the other", async () => {
  const initial = await composition();
  const responses = await Promise.all([
    edit([{ type: "add", note: first }]),
    edit([{ type: "add", note: { ...first, id: "other-first" } }]),
  ]);
  expect(responses.map(({ status }) => status).sort((a, b) => a - b)).toEqual([200, 409]);
  const rejected = (await responses.find(({ status }) => status === 409)!.json()) as EditResponse;
  expect(rejected.error).toContain("already here");
  expect(rejected.composition).toEqual(await composition());
  expect(rejected.composition.pattern.notes).toHaveLength(initial.pattern.notes.length + 1);
});

test("rejects an entire gesture if any placement conflicts", async () => {
  const initial = await composition();
  const occupied = initial.pattern.notes[0];
  const response = await edit([
    { type: "add", note: first },
    { type: "add", note: { ...occupied, id: "collision" } },
  ]);
  expect(response.status).toBe(409);
  expect(await composition()).toEqual(initial);
});

test("repeated additions and deletions are harmless, and stale moves cannot resurrect deleted notes", async () => {
  const initial = await composition();
  for (let index = 0; index < 2; index++) {
    expect((await edit([{ type: "add", note: first }])).status).toBe(200);
  }
  expect((await composition()).revision).toBe(1);
  expect((await edit([{ type: "add", note: { ...first, step: 3 } }])).status).toBe(409);
  for (let index = 0; index < 2; index++) {
    expect((await edit([{ type: "remove", id: first.id }])).status).toBe(200);
  }
  expect((await edit([{ type: "move", note: { ...first, step: 3 } }])).status).toBe(409);
  const saved = await composition();
  expect(saved.pattern).toEqual(initial.pattern);
  expect(saved.revision).toBe(2);
});

test.each([
  { pattern: { notes: [] } },
  { changes: [] },
  { changes: [{ type: "clear" }] },
  { changes: [{ type: "add", note: { ...first, id: 21 } }] },
  { changes: [{ type: "add", note: { ...first, step: 32 } }] },
  { changes: [{ type: "add", note: { ...first, step: 1.5 } }] },
  { changes: [{ type: "add", note: { ...first, tone: -1 } }] },
  { changes: [{ type: "add", note: { ...first, tone: 25 } }] },
  { changes: [{ type: "add", note: { ...first, step: null } }] },
  { changes: [{ type: "remove", id: "" }] },
])("rejects malformed edits without changing storage: %j", async (body) => {
  const initial = await composition();
  const response = await server.fetch("/api/composition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compositionId: COMPOSITION_ID, ...body }),
  });
  expect(response.status).toBe(400);
  expect(await composition()).toEqual(initial);
});

test("rejects cross-origin, wrong-composition, non-JSON, and oversized writes", async () => {
  const initial = await composition();
  const body = JSON.stringify({
    compositionId: COMPOSITION_ID,
    changes: [{ type: "add", note: first }],
  });
  const crossOrigin = await server.fetch("/api/composition", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://elsewhere.example" },
    body,
  });
  expect(crossOrigin.status).toBe(403);
  const wrongComposition = await server.fetch("/api/composition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ compositionId: "yesterday", changes: [{ type: "add", note: first }] }),
  });
  expect(wrongComposition.status).toBe(409);
  expect((await server.fetch("/api/composition", { method: "POST", body })).status).toBe(415);
  expect(
    (
      await server.fetch("/api/composition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: " ".repeat(65 * 1024),
      })
    ).status,
  ).toBe(400);
  expect((await server.fetch("/api/composition", { method: "PUT" })).status).toBe(405);
  expect(await composition()).toEqual(initial);
});
