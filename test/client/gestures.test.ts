// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import { locate } from "../../src/client/space";
import { setupAppTests, tones } from "./app-harness";

const app = setupAppTests();
const {
  size,
  element,
  surface,
  button,
  sketchOption,
  seedSelector,
  notes,
  click,
  blur,
  key,
  pointer,
  add,
  paint,
  drag,
  expectFinished,
} = app;

test("Undo cancels scattering without undoing the preceding edit or letting release recommit it", () => {
  const seed = notes();
  add(2, tones.malletA3);
  const before = notes();
  expect(before).toHaveLength(seed.length + 1);
  paint();
  expect(notes()).toHaveLength(before.length + 2);
  key("z", { ctrlKey: true });
  expect(notes()).toEqual(before);
  expectFinished();
  pointer("pointermove", 12, tones.malletA3);
  pointer("pointerup", 12, tones.malletA3);
  pointer("lostpointercapture", 12, tones.malletA3);
  expect(notes()).toEqual(before);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
  click(button("Redo"));
  expect(notes()).toEqual(before);
});

test("selecting and deselecting a light never enables Undo, even while pressed", () => {
  const before = notes();
  const light = element(seedSelector("mallet", "C4", 0));
  for (const selected of [true, false]) {
    pointer("pointerdown", 0, tones.malletC4, light);
    expect(button("Undo").disabled).toBe(true);
    pointer("pointerup", 0, tones.malletC4);
    expect(light.getAttribute("aria-pressed")).toBe(String(selected));
    expect(button("Undo").disabled).toBe(true);
    expect(button("Redo").disabled).toBe(true);
    expect(notes()).toEqual(before);
  }
});

test("selection preserves the existing undo and redo history", () => {
  const seed = notes();
  add(2, tones.malletA3);
  const edited = notes();
  add(0, tones.malletC4);
  expect(button("Undo").disabled).toBe(false);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
  pointer("pointerdown", 0, tones.malletC4);
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(false);
  pointer("pointerup", 0, tones.malletC4);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(edited);
});

test("Undo becomes available only when a selection press turns into a drag", () => {
  const before = notes();
  pointer("pointerdown", 0, tones.malletC4);
  expect(button("Undo").disabled).toBe(true);
  const position = locate({ id: "1", step: 0, tone: tones.malletC4 }, size);
  pointer("pointermove", 0, tones.malletC4, surface(), { clientX: position.x + 2 });
  expect(button("Undo").disabled).toBe(true);
  pointer("pointermove", 2, tones.malletC4);
  expect(button("Undo").disabled).toBe(false);
  click(button("Undo"));
  expectFinished();
  expect(button("Undo").disabled).toBe(true);
  pointer("pointerup", 2, tones.malletC4);
  expect(notes()).toEqual(before);
  expect(button("Redo").disabled).toBe(true);
});

test("Undo can cancel the first gesture even when no completed history exists", () => {
  const seed = notes();
  expect(button("Undo").disabled).toBe(true);
  paint();
  expect(button("Undo").disabled).toBe(false);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(true);
  pointer("pointerup", 8, tones.malletC4);
  expect(notes()).toEqual(seed);
});

test.each(["Escape", "pointercancel", "lostpointercapture", "blur"])(
  "%s cancels the entire scattered trail and preserves the previous redo branch",
  (interruption) => {
    add(2, tones.malletA3);
    const completed = notes();
    click(button("Undo"));
    const before = notes();
    paint();
    expect(notes()).toHaveLength(before.length + 2);
    if (interruption === "Escape") key("Escape");
    else if (interruption === "blur") blur();
    else pointer(interruption, 8, tones.malletC4);
    expect(notes()).toEqual(before);
    expectFinished();
    pointer("pointerup", 8, tones.malletC4);
    expect(notes()).toEqual(before);
    expect(button("Redo").disabled).toBe(false);
    click(button("Redo"));
    expect(notes()).toEqual(completed);
  },
);

test("scattering commits exactly one undo entry and clears redo only on commit", () => {
  add(2, tones.malletA3);
  click(button("Undo"));
  const before = notes();
  paint();
  const painted = notes();
  expect(painted).toHaveLength(before.length + 2);
  expect(button("Redo").disabled).toBe(false);
  pointer("pointerup", 8, tones.malletC4);
  expectFinished();
  expect(button("Redo").disabled).toBe(true);
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(painted);
});

test("a rejected scatter creates no history entry and does not discard redo", () => {
  add(2, tones.malletA3);
  const completed = notes();
  click(button("Undo"));
  const before = notes();
  // Empty space beyond the seed's hit target, but at the same occupied bass timing step.
  pointer("pointerdown", 0, tones.bassE2, surface(), { shiftKey: true });
  pointer("pointerup", 0, tones.bassE2);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(completed);
});

test("Redo cancels a live gesture before replaying the next completed edit", () => {
  add(2, tones.malletA3);
  const completed = notes();
  click(button("Undo"));
  paint();
  key("z", { metaKey: true, shiftKey: true });
  expect(notes()).toEqual(completed);
  expectFinished();
  pointer("pointerup", 8, tones.malletC4);
  expect(notes()).toEqual(completed);
});

test("deleting during a drag removes the original note and release cannot recreate it", () => {
  const before = notes();
  drag();
  key("Delete");
  expect(document.querySelector(seedSelector("mallet", "C4", 0))).toBeNull();
  expect(notes()).toHaveLength(before.length - 1);
  expectFinished();
  pointer("pointerup", 2, tones.malletC4);
  pointer("lostpointercapture", 2, tones.malletC4);
  expect(document.querySelector(seedSelector("mallet", "C4", 0))).toBeNull();
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("a keyboard nudge cancels the draft and edits the original position exactly once", () => {
  const before = notes();
  drag();
  key("ArrowRight");
  const nudged = notes();
  expect(nudged[0]).toContain("beat position 2 of 32");
  expectFinished();
  pointer("pointerup", 2, tones.malletC4);
  expect(notes()).toEqual(nudged);
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("Undo cancels an ordinary drag without consuming the preceding completed edit", () => {
  const seed = notes();
  add(2, tones.malletA3);
  const before = notes();
  drag();
  key("z", { metaKey: true });
  expect(notes()).toEqual(before);
  expectFinished();
  pointer("pointerup", 2, tones.malletC4);
  expect(notes()).toEqual(before);
  click(button("Undo"));
  expect(notes()).toEqual(seed);
});

test("Enter interrupts scattering and adds only the requested keyboard note", () => {
  const before = notes();
  paint();
  key("Enter");
  expect(notes()).toHaveLength(before.length + 1);
  expect(notes().at(-1)).toContain("Muted piano, D4, beat position 17 of 32");
  const added = notes();
  expectFinished();
  pointer("pointerup", 8, tones.malletC4);
  expect(notes()).toEqual(added);
  click(button("Undo"));
  expect(notes()).toEqual(before);
});

test.each(["pointercancel", "lostpointercapture", "blur"])(
  "%s cancels an ordinary drag without changing music or history",
  (interruption) => {
    const before = notes();
    drag();
    if (interruption === "blur") blur();
    else pointer(interruption, 2, tones.malletC4);
    expect(notes()).toEqual(before);
    expectFinished();
    pointer("pointerup", 2, tones.malletC4);
    expect(notes()).toEqual(before);
    expect(button("Undo").disabled).toBe(true);
  },
);

test("clear interrupts scattering and undo restores the phrase before the gesture", () => {
  const before = notes();
  paint();
  click(button("Sketch options"));
  click(sketchOption("Start with an empty space"));
  expect(notes()).toEqual([]);
  expectFinished();
  pointer("pointerup", 8, tones.malletC4);
  expect(notes()).toEqual([]);
  click(button("Undo"));
  expect(notes()).toEqual(before);
});

test("a completed drag is still undoable as one edit", () => {
  const before = notes();
  drag();
  pointer("pointerup", 2, tones.malletC4);
  const moved = notes();
  expect(moved[0]).toContain("beat position 3 of 32");
  expectFinished();
  click(button("Undo"));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  click(button("Redo"));
  expect(notes()).toEqual(moved);
});

test("events from another pointer cannot finish or cancel the current gesture", () => {
  const before = notes();
  paint();
  const painted = notes();
  pointer("pointercancel", 8, tones.malletC4, surface(), { pointerId: 2 });
  pointer("pointerup", 8, tones.malletC4, surface(), { pointerId: 2 });
  expect(surface().classList.contains("is-dragging")).toBe(true);
  expect(notes()).toEqual(painted);
  pointer("pointerup", 8, tones.malletC4);
  click(button("Undo"));
  expect(notes()).toEqual(before);
});
