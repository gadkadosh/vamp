import { expect, test, vi } from "vite-plus/test";
import { Room } from "../src/server/index";
import { compose } from "../src/shared/pattern";
import { TONE_LAYOUT_VERSION } from "../src/shared/room";
import { INSTRUMENTS } from "../src/shared/score";

// Replace only the Workers base class; initialization and migration are the production code.
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

test("room initialization migrates saved pitches once and preserves the saved revision", async () => {
  const legacy = {
    revision: 42,
    pattern: {
      notes: [
        { id: "piano", step: 3, tone: 13 },
        { id: "glass", step: 7, tone: 21 },
      ],
    },
  };
  const saved = new Map<string, unknown>([["state", legacy]]);
  const put = vi.fn(async (entries: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(entries)) saved.set(key, value);
  });
  let ready = Promise.resolve();
  const context = {
    storage: { get: async (key: string) => saved.get(key), put },
    blockConcurrencyWhile: (initialize: () => Promise<void>) => (ready = initialize()),
  } as unknown as DurableObjectState;

  new Room(context, {} as Env);
  await ready;
  const migrated = saved.get("state") as typeof legacy;
  expect(migrated.revision).toBe(42);
  expect(
    compose(migrated.pattern).map((note) => [
      note.noteId,
      note.step,
      note.instrument,
      INSTRUMENTS[note.instrument].notes[note.row].name,
    ]),
  ).toEqual([
    ["piano", 3, "keys", "F4"],
    ["glass", 7, "glass", "A5"],
  ]);
  expect(saved.get("toneLayout")).toBe(TONE_LAYOUT_VERSION);
  expect(put).toHaveBeenCalledTimes(1);

  new Room(context, {} as Env);
  await ready;
  expect(saved.get("state")).toEqual(migrated);
  expect(put).toHaveBeenCalledTimes(1);
  expect(legacy.pattern.notes.map((note) => note.tone)).toEqual([13, 21]);
});
