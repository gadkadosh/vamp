import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vite-plus/test";
import { createTestHarness, unstable_readConfig } from "wrangler";
import { MAX_MESSAGE_LENGTH, TONE_LAYOUT_VERSION } from "../src/shared/room";
import type { Change, StateMessage } from "../src/shared/room";

// The Vite plugin supplies the assets directory during builds. These tests run the worker alone.
const config = unstable_readConfig({ config: "./wrangler.jsonc" });
const server = createTestHarness({
  workers: [
    {
      config: {
        name: config.name,
        main: config.main,
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags,
        durable_objects: config.durable_objects,
        exports: config.exports,
        migrations: config.migrations,
      },
    },
  ],
});
let url: URL;
const sockets = new Set<WebSocket>();

beforeAll(async () => {
  ({ url } = await server.listen());
}, 30_000);
beforeEach(async () => {
  await server.reset();
  ({ url } = await server.listen());
}, 30_000);
afterEach(() => {
  for (const socket of sockets) socket.close();
  sockets.clear();
});
afterAll(() => server.close());

function next(socket: WebSocket, count = 1): Promise<StateMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("No room state received"));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      socket.removeEventListener("message", message);
      socket.removeEventListener("error", error);
    }
    function message(event: MessageEvent) {
      if (--count > 0) return;
      cleanup();
      resolve(JSON.parse(String(event.data)) as StateMessage);
    }
    function error() {
      cleanup();
      reject(new Error("WebSocket failed"));
    }
    socket.addEventListener("message", message);
    socket.addEventListener("error", error);
  });
}

async function connect() {
  const address = new URL("/api/room", url);
  address.protocol = "ws:";
  const socket = new WebSocket(address);
  sockets.add(socket);
  return { socket, initial: await next(socket) };
}

function edit(socket: WebSocket, changes: Change[]) {
  const result = next(socket);
  const requestId = crypto.randomUUID();
  socket.send(
    JSON.stringify({ type: "edit", toneLayout: TONE_LAYOUT_VERSION, requestId, changes }),
  );
  return result;
}

const light = (step: number, tone = 7) => ({ id: crypto.randomUUID(), step, tone });

test("GET /api/health responds from the Workers runtime", async () => {
  const response = await server.fetch("/api/health");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ ok: true });
});

test("connections share one seeded composition; accepted edits are broadcast and survive eviction", async () => {
  const a = await connect();
  const b = await connect();
  expect(a.initial.state.pattern.notes).toHaveLength(20);
  expect(b.initial).toEqual(a.initial);
  const note = light(3);
  const broadcast = next(b.socket);
  const accepted = await edit(a.socket, [{ type: "add", note }]);
  expect(accepted.error).toBeUndefined();
  expect(accepted.state.revision).toBe(a.initial.state.revision + 1);
  expect(accepted.state.pattern.notes).toContainEqual(note);
  expect(await broadcast).toEqual(accepted);

  await server.getWorker().evictDurableObject("Room", { name: "global", webSockets: "close" });
  const restarted = await connect();
  expect(restarted.initial.state).toEqual(accepted.state);
});

test("a hibernated connection resumes against persisted state", async () => {
  const { socket, initial } = await connect();
  await server.getWorker().evictDurableObject("Room", { name: "global", webSockets: "hibernate" });
  const note = light(3);
  const accepted = await edit(socket, [{ type: "add", note }]);
  expect(accepted.error).toBeUndefined();
  expect(accepted.state.revision).toBe(initial.state.revision + 1);
  expect(accepted.state.pattern.notes).toContainEqual(note);
});

test("concurrent edits to different notes both succeed without a base revision", async () => {
  const a = await connect();
  const b = await connect();
  const [first, second] = a.initial.state.pattern.notes;
  // Different pitches avoid a collision at the new beat.
  const movedA = { ...first, step: 3 };
  const movedB = { ...second, step: 5 };
  const aUpdates = next(a.socket, 2);
  const bUpdates = next(b.socket, 2);
  a.socket.send(
    JSON.stringify({
      type: "edit",
      requestId: crypto.randomUUID(),
      toneLayout: TONE_LAYOUT_VERSION,
      changes: [{ type: "move", note: movedA }],
    }),
  );
  b.socket.send(
    JSON.stringify({
      type: "edit",
      requestId: crypto.randomUUID(),
      toneLayout: TONE_LAYOUT_VERSION,
      changes: [{ type: "move", note: movedB }],
    }),
  );
  await Promise.all([aUpdates, bUpdates]);
  const c = await connect();
  // A fresh connection is also ordered after both edits by the room's input gate.
  expect(c.initial.state.revision).toBe(2);
  expect(c.initial.state.pattern.notes).toEqual(expect.arrayContaining([movedA, movedB]));
});

test("the last valid move wins; moving a deleted note cannot resurrect it", async () => {
  const a = await connect();
  const note = a.initial.state.pattern.notes[0];
  const first = await edit(a.socket, [{ type: "move", note: { ...note, step: 3 } }]);
  expect(first.error).toBeUndefined();
  const second = await edit(a.socket, [{ type: "move", note: { ...note, step: 5 } }]);
  expect(second.state.pattern.notes.find(({ id }) => id === note.id)?.step).toBe(5);
  const removed = await edit(a.socket, [{ type: "remove", id: note.id }]);
  const rejected = await edit(a.socket, [{ type: "move", note: { ...note, step: 7 } }]);
  expect(rejected.error).toContain("removed");
  expect(rejected.state).toEqual(removed.state);
  expect(rejected.state.pattern.notes.some(({ id }) => id === note.id)).toBe(false);
});

test("collision rejection is atomic and does not change the saved revision", async () => {
  const { socket, initial } = await connect();
  const occupied = initial.state.pattern.notes[0];
  const rejected = await edit(socket, [
    { type: "add", note: light(3) },
    { type: "add", note: { ...occupied, id: crypto.randomUUID() } },
  ]);
  expect(rejected.error).toContain("already here");
  expect(rejected.state).toEqual(initial.state);
  const reconnect = await connect();
  expect(reconnect.initial.state).toEqual(initial.state);
});

test("malformed, out-of-range and duplicate-ID edits leave state unchanged", async () => {
  const { socket, initial } = await connect();
  for (const payload of [
    "not json",
    JSON.stringify({
      type: "edit",
      requestId: crypto.randomUUID(),
      toneLayout: TONE_LAYOUT_VERSION,
      changes: [{ type: "add", note: light(-1) }],
    }),
    JSON.stringify({
      type: "edit",
      requestId: crypto.randomUUID(),
      toneLayout: TONE_LAYOUT_VERSION,
      changes: [{ type: "add", note: light(3, 999) }],
    }),
    JSON.stringify({
      type: "edit",
      requestId: crypto.randomUUID(),
      toneLayout: TONE_LAYOUT_VERSION,
      changes: [{ type: "add", note: { ...light(3), step: 3.5 } }],
    }),
  ]) {
    const response = next(socket);
    socket.send(payload);
    const rejected = await response;
    expect(rejected.error).toBeTruthy();
    expect(rejected.state).toEqual(initial.state);
  }
  const duplicate = await edit(socket, [{ type: "add", note: initial.state.pattern.notes[0] }]);
  expect(duplicate.error).toContain("already exists");
  expect(duplicate.state).toEqual(initial.state);
});

test("edits from outdated pitch layouts cannot change the shared composition", async () => {
  const { socket, initial } = await connect();
  for (const toneLayout of [undefined, 0, TONE_LAYOUT_VERSION + 1]) {
    const response = next(socket);
    socket.send(
      JSON.stringify({
        type: "edit",
        toneLayout,
        requestId: crypto.randomUUID(),
        changes: [{ type: "add", note: light(3) }],
      }),
    );
    const rejected = await response;
    expect(rejected.error).toContain("Reload");
    expect(rejected.state).toEqual(initial.state);
  }
  expect((await connect()).initial.state).toEqual(initial.state);
});

test("a batch can swap occupied positions when its final pattern is valid", async () => {
  const { socket, initial } = await connect();
  const tone = initial.state.pattern.notes[1].tone;
  const [a, b] = initial.state.pattern.notes.filter((note) => note.tone === tone);
  const moved = [
    { ...a, step: b.step },
    { ...b, step: a.step },
  ];
  const accepted = await edit(
    socket,
    moved.map((note) => ({ type: "move", note })),
  );
  expect(accepted.error).toBeUndefined();
  expect(accepted.state.revision).toBe(1);
  expect(accepted.state.pattern.notes).toEqual(expect.arrayContaining(moved));
});

test("oversized messages close the connection without changing saved state", async () => {
  const { socket, initial } = await connect();
  const closed = new Promise<CloseEvent>((resolve) =>
    socket.addEventListener("close", resolve, { once: true }),
  );
  socket.send(" ".repeat(MAX_MESSAGE_LENGTH + 1));
  expect((await closed).code).toBe(1009);
  expect((await connect()).initial.state).toEqual(initial.state);
});

test("the room endpoint requires a WebSocket and rejects cross-origin browser connections", async () => {
  expect((await server.fetch("/api/room")).status).toBe(426);
  const response = await server.fetch("/api/room", {
    headers: { Upgrade: "websocket", Origin: "https://elsewhere.example" },
  });
  expect(response.status).toBe(403);
});
