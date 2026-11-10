// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { SharedSession } from "../../src/client/editing";
import { useSharedSession } from "../../src/client/useSharedSession";
import { COMPOSITION_ID } from "../../src/shared/composition";
import type { Composition } from "../../src/shared/composition";

type Request = {
  url: unknown;
  options: RequestInit;
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
};
let root: Root;
let session: SharedSession;
let requests: Request[];
const existing = { id: "existing", step: 0, tone: 9 };
const added = { id: "added", step: 2, tone: 10 };
const initial: Composition = { id: COMPOSITION_ID, revision: 0, pattern: { notes: [existing] } };

function Shared({ active = true }: { active?: boolean }) {
  session = useSharedSession(active);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  requests = [];
  vi.stubGlobal(
    "fetch",
    (url: unknown, options: RequestInit = {}) =>
      new Promise<Response>((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
        options.signal?.addEventListener("abort", () => reject(new Error("Request aborted")), {
          once: true,
        });
      }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Shared))));
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function latest() {
  return requests.at(-1)!;
}

async function respond(body: unknown, status = 200) {
  await act(async () => latest().resolve(Response.json(body, { status })));
}

function sentEdit() {
  expect(latest().url).toBe("/api/composition");
  expect(latest().options.method).toBe("POST");
  const body = latest().options.body;
  if (typeof body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(body) as unknown;
}

test("loading starts empty, cannot edit, and ignores the aborted Strict Mode request", async () => {
  expect(session.status).toBe("loading");
  expect(session.pattern.notes).toEqual([]);
  const count = requests.length;
  act(() => session.edit({ type: "place", notes: [added] }));
  expect(requests).toHaveLength(count);
  expect(requests[0].options.signal?.aborted).toBe(true);
  await respond(initial);
  expect(session.status).toBe("ready");
  expect(session.pattern).toEqual(initial.pattern);
  await act(async () => requests[0].resolve(Response.json({ ...initial, pattern: { notes: [] } })));
  expect(session.pattern).toEqual(initial.pattern);
});

test("keeps an optimistic edit visible while saving, blocks further writes, then accepts the full snapshot", async () => {
  await respond(initial);
  act(() => session.edit({ type: "place", notes: [added] }));
  expect(session.status).toBe("saving");
  expect(session.pattern.notes).toEqual([existing, added]);
  expect(sentEdit()).toEqual({
    compositionId: initial.id,
    changes: [{ type: "add", note: added }],
  });
  const count = requests.length;
  act(() => {
    session.edit({ type: "remove", id: existing.id });
    session.reload();
  });
  expect(requests).toHaveLength(count);
  const other = { id: "another-browser", step: 3, tone: 9 };
  const saved = { ...initial, revision: 2, pattern: { notes: [existing, other, added] } };
  await respond({ composition: saved });
  expect(session.status).toBe("ready");
  expect(session.pattern).toEqual(saved.pattern);
  expect(session.error).toBe("");
});

test("a scattered trail is submitted in one request", async () => {
  await respond(initial);
  const last = { id: "last", step: 6, tone: 10 };
  act(() => session.edit({ type: "place", notes: [added, last] }));
  expect(sentEdit()).toEqual({
    compositionId: initial.id,
    changes: [
      { type: "add", note: added },
      { type: "add", note: last },
    ],
  });
  expect(session.pattern.notes).toEqual([existing, added, last]);
});

test("moves and removals are distinct from additions and are visible while pending", async () => {
  await respond(initial);
  const moved = { ...existing, step: 1 };
  act(() => session.edit({ type: "place", notes: [moved] }));
  expect(sentEdit()).toEqual({
    compositionId: initial.id,
    changes: [{ type: "move", note: moved }],
  });
  expect(session.pattern.notes).toEqual([moved]);
  await respond({ composition: { ...initial, revision: 1, pattern: { notes: [moved] } } });
  act(() => session.edit({ type: "remove", id: existing.id }));
  expect(sentEdit()).toEqual({
    compositionId: initial.id,
    changes: [{ type: "remove", id: existing.id }],
  });
  expect(session.pattern.notes).toEqual([]);
});

test("a server rejection replaces the optimistic pattern and explains the conflict", async () => {
  await respond(initial);
  act(() => session.edit({ type: "place", notes: [added] }));
  const occupied = { ...added, id: "occupied" };
  const authoritative = { ...initial, revision: 1, pattern: { notes: [existing, occupied] } };
  await respond({ composition: authoritative, error: "That sound is already here." }, 409);
  expect(session.status).toBe("ready");
  expect(session.pattern).toEqual(authoritative.pattern);
  expect(session.error).toContain("already here");
  expect(session.error).toContain("refreshed");
});

test("a lost save response requires a fresh read and never retries the write", async () => {
  await respond(initial);
  act(() => session.edit({ type: "place", notes: [added] }));
  await act(async () => latest().reject(new Error("Connection lost")));
  expect(session.status).toBe("unavailable");
  expect(session.pattern).toEqual(initial.pattern);
  expect(session.error).toContain("may be saved");
  const count = requests.length;
  act(() => session.edit({ type: "place", notes: [added] }));
  expect(requests).toHaveLength(count);
  act(() => session.reload());
  expect(latest().options.method).toBeUndefined();
  await respond({ ...initial, revision: 1, pattern: { notes: [existing, added] } });
  expect(session.status).toBe("ready");
  expect(session.pattern.notes).toEqual([existing, added]);
  expect(requests.filter(({ options }) => options.method === "POST")).toHaveLength(1);
});

test("a hung save times out rather than locking editing and mode switching forever", async () => {
  await respond(initial);
  vi.useFakeTimers();
  act(() => session.edit({ type: "place", notes: [added] }));
  expect(session.status).toBe("saving");
  await act(async () => vi.advanceTimersByTime(15_000));
  expect(session.status).toBe("unavailable");
  expect(session.error).toContain("reload before editing");
  expect(session.pattern).toEqual(initial.pattern);
  expect(vi.getTimerCount()).toBe(0);
});

test("a failed load offers recovery without inventing or saving a starting pattern", async () => {
  await respond({ error: "Unavailable" }, 503);
  expect(session.status).toBe("unavailable");
  expect(session.pattern.notes).toEqual([]);
  expect(session.error).toContain("Couldn’t load");
  act(() => session.reload());
  await respond(initial);
  expect(session.status).toBe("ready");
  expect(session.pattern).toEqual(initial.pattern);
  expect(requests.every(({ options }) => options.method !== "POST")).toBe(true);
});

test("switching away cancels loading; returning refreshes and ignores the old response", async () => {
  const old = latest();
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(Shared, { active: false }))),
  );
  expect(old.options.signal?.aborted).toBe(true);
  await act(async () => root.render(createElement(StrictMode, null, createElement(Shared))));
  await respond(initial);
  await act(async () => old.resolve(Response.json({ ...initial, pattern: { notes: [] } })));
  expect(session.pattern).toEqual(initial.pattern);
});

test("unchanged, locally conflicting, and missing-note edits do not send writes", async () => {
  await respond(initial);
  const count = requests.length;
  act(() => {
    session.edit({ type: "place", notes: [existing] });
    session.edit({ type: "place", notes: [{ ...existing, id: "duplicate" }] });
    session.edit({ type: "remove", id: "missing" });
  });
  expect(requests).toHaveLength(count);
  expect(session.pattern).toEqual(initial.pattern);
});

test("invalid snapshots fail closed instead of enabling edits with malformed state", async () => {
  await respond({ ok: true });
  expect(session.status).toBe("unavailable");
  expect(session.pattern.notes).toEqual([]);
  act(() => session.reload());
  await respond(initial);
  act(() => session.edit({ type: "place", notes: [added] }));
  await respond({ composition: { ...initial, pattern: { notes: [{ ...added, step: -1 }] } } });
  expect(session.status).toBe("unavailable");
  expect(session.pattern).toEqual(initial.pattern);
});

test("draft IDs are unique UUIDs rather than browser-local counters", () => {
  const ids = Array.from({ length: 100 }, () => session.nextId());
  expect(new Set(ids).size).toBe(100);
  expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
});
