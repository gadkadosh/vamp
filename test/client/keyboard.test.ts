// @vitest-environment happy-dom
import { act } from "react";
import { expect, test } from "vite-plus/test";
import { TONES } from "../../src/shared/pattern";
import { INSTRUMENTS } from "../../src/shared/score";
import { setupAppTests, tones } from "./app-harness";

const app = setupAppTests();
const {
  element,
  surface,
  button,
  sketchOption,
  lightIds,
  seedId,
  seedSelector,
  notes,
  click,
  key,
  pointer,
  add,
  paint,
  expectFinished,
  enterSurface,
  expectSelected,
} = app;

test("Page Down reaches every note in time and pitch order without editing the music", () => {
  const before = notes();
  enterSurface();
  const order = [
    seedId("bass", "C2", 0),
    seedId("mallet", "C4", 0),
    seedId("keys", "E5", 2),
    seedId("mallet", "E4", 4),
    seedId("keys", "D5", 6),
    seedId("mallet", "G4", 8),
    seedId("keys", "C5", 10),
    seedId("glass", "E5", 10),
    seedId("mallet", "E4", 12),
    seedId("keys", "B4", 14),
    seedId("bass", "G2", 16),
    seedId("mallet", "D4", 16),
    seedId("keys", "C5", 18),
    seedId("mallet", "A4", 20),
    seedId("keys", "G4", 22),
    seedId("mallet", "G4", 24),
    seedId("keys", "A4", 26),
    seedId("glass", "C6", 26),
    seedId("mallet", "E4", 28),
    seedId("keys", "E5", 30),
  ];
  for (const id of order) {
    expect(key("PageDown").defaultPrevented).toBe(true);
    expectSelected(id);
  }
  key("PageDown");
  expectSelected(order[0]);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("Page Up starts at the last note and cycles backwards across the loop boundary", () => {
  enterSurface();
  expect(key("PageUp").defaultPrevented).toBe(true);
  expectSelected(seedId("keys", "E5", 30));
  key("PageUp");
  expectSelected(seedId("mallet", "E4", 28));
  key("PageDown");
  expectSelected(seedId("keys", "E5", 30));
  key("PageDown");
  expectSelected(seedId("bass", "C2", 0));
  key("PageUp");
  expectSelected(seedId("keys", "E5", 30));
});

test("a non-first note can be selected, moved, and deleted entirely from the keyboard", () => {
  const before = notes();
  enterSurface();
  key("PageUp");
  expectSelected(seedId("keys", "E5", 30));
  key("ArrowLeft");
  expectSelected(seedId("keys", "E5", 30));
  const moved = notes();
  expect(moved[15]).toContain("E5, beat position 30 of 32");
  expect(moved.filter((_, index) => index !== 15)).toEqual(
    before.filter((_, index) => index !== 15),
  );
  key("Delete");
  expect(document.querySelector(seedSelector("keys", "E5", 30))).toBeNull();
  expect(notes()).toEqual(moved.filter((_, index) => index !== 15));
  expect(document.activeElement).toBe(surface());
  key("z", { ctrlKey: true });
  expect(notes()).toEqual(moved);
  key("z", { ctrlKey: true });
  expect(notes()).toEqual(before);
});

test("arrows still select a light first and then move it, with focus on that light", () => {
  const before = notes();
  enterSurface();
  key("ArrowRight");
  expectSelected(seedId("mallet", "C4", 0));
  expect(notes()).toEqual(before);
  key("ArrowRight");
  expectSelected(seedId("mallet", "C4", 0));
  expect(notes()[0]).toContain("beat position 2 of 32");
});

test("Enter focuses the new light; undo and redo keep focus inside the surface", () => {
  const before = notes();
  enterSurface();
  key("Enter");
  const id = lightIds().at(-1)!;
  expectSelected(id);
  expect(notes()).toHaveLength(before.length + 1);
  key("z", { metaKey: true });
  expect(notes()).toEqual(before);
  expect(document.activeElement).toBe(surface());
  key("z", { metaKey: true, shiftKey: true });
  expectSelected(id);
});

test("the surface has a single note tab stop and Escape restores the empty selection entry point", () => {
  enterSurface();
  key("PageDown");
  expectSelected(seedId("bass", "C2", 0));
  expect(surface().tabIndex).toBe(-1);
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("[data-light]")].filter(
      (light) => light.tabIndex === 0,
    ),
  ).toEqual([document.activeElement]);
  expect([
    ...document.querySelectorAll('[role="group"][aria-label="Selected note"] button'),
  ]).toEqual([button("Remove selected note")]);
  expect(button("Remove selected note").tabIndex).toBe(0);
  key("Escape");
  expect(document.activeElement).toBe(surface());
  expect(surface().tabIndex).toBe(0);
  expect(
    [...document.querySelectorAll("[data-light]")].every(
      (light) => light.getAttribute("aria-pressed") === "false",
    ),
  ).toBe(true);
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("[data-light]")].every(
      (light) => light.tabIndex === -1,
    ),
  ).toBe(true);
});

test.each(["body", '[aria-label="Mute audio"]', '[aria-label="Play loop"]'])(
  "Escape deselects globally without moving focus from %s or editing the music",
  (selector) => {
    const before = notes();
    act(() => element(seedSelector("mallet", "C4", 0)).focus());
    const target = element(selector);
    if (target === document.body) target.tabIndex = -1;
    act(() => target.focus());
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("false");
    expect(document.querySelector(".note-tools")).toBeNull();
    expect(surface().tabIndex).toBe(0);
    expect(notes()).toEqual(before);
    expect(button("Undo").disabled).toBe(true);
    expect(key("Escape").defaultPrevented).toBe(false);
  },
);

test("Escape from the selected note's remove control returns focus to the surface", () => {
  act(() => element(seedSelector("mallet", "C4", 0)).focus());
  act(() => button("Remove selected note").focus());
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(document.querySelector(".note-tools")).toBeNull();
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(surface());
});

test.each(["surface", "outside"])(
  "Escape cancels a gesture before deselecting, with focus %s the canvas",
  (focus) => {
    const before = notes();
    act(() => element(seedSelector("mallet", "C4", 0)).focus());
    paint();
    if (focus === "outside") act(() => button("Mute audio").focus());
    const target = document.activeElement;
    expect(notes()).toHaveLength(before.length + 2);
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(notes()).toEqual(before);
    expectFinished();
    expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("true");
    expect(button("Undo").disabled).toBe(true);
    if (focus === "outside") expect(document.activeElement).toBe(target);
    pointer("pointerup", 8, tones.malletC4);
    expect(notes()).toEqual(before);
    key("Escape", { repeat: true });
    expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("true");
    key("Escape");
    expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("false");
  },
);

test("Escape closes sketch options before deselecting and ignores held repeats", () => {
  act(() => element(seedSelector("mallet", "C4", 0)).focus());
  click(button("Sketch options"));
  act(() => element(".sketch-menu button").focus());
  expect(key("Escape").defaultPrevented).toBe(true);
  expect(document.querySelector(".sketch-menu")).toBeNull();
  expect(document.activeElement).toBe(button("Sketch options"));
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("true");
  key("Escape", { repeat: true });
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("true");
  key("Escape");
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(button("Sketch options"));
});

test("Escape leaves the help dialog's native dismissal alone without deselecting", () => {
  act(() => element(seedSelector("mallet", "C4", 0)).focus());
  click(element(".help-button"));
  act(() => button("Close guide").focus());
  expect(element<HTMLDialogElement>("dialog").open).toBe(true);
  expect(key("Escape").defaultPrevented).toBe(false);
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("true");
  // happy-dom does not synthesize native dialog dismissal from keyboard events.
  click(button("Close guide"));
  expect(element<HTMLDialogElement>("dialog").open).toBe(false);
  act(() => button("Mute audio").focus());
  key("Escape");
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("false");
});

test("native help dismissal restores shortcuts and allows reopening", async () => {
  act(() => element(seedSelector("mallet", "C4", 0)).focus());
  click(element(".help-button"));
  const dialog = element<HTMLDialogElement>("dialog");
  expect(dialog.open).toBe(true);

  await act(async () => dialog.close());
  expect(dialog.open).toBe(false);
  act(() => button("Mute audio").focus());
  key("Escape");
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("false");

  click(element(".help-button"));
  expect(dialog.open).toBe(true);
  click(element(".guide-done"));
  expect(dialog.open).toBe(false);
});

test.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])(
  "Escape leaves modified or composing key events alone: %j",
  (modifiers) => {
    act(() => element(seedSelector("mallet", "C4", 0)).focus());
    expect(key("Escape", modifiers).defaultPrevented).toBe(false);
    expectSelected(seedId("mallet", "C4", 0));
  },
);

test("Escape respects events already handled by another control", () => {
  act(() => element(seedSelector("mallet", "C4", 0)).focus());
  const target = button("Mute audio");
  act(() => target.focus());
  target.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
  key("Escape");
  expect(element(seedSelector("mallet", "C4", 0)).getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(target);
});

test.each(["button", "Delete", "Backspace", "right-click"])(
  "%s removes the selected note, clears its details, and creates one Solo undo entry",
  (control) => {
    const before = notes();
    enterSurface();
    key("PageUp");
    expectSelected(seedId("keys", "E5", 30));
    expect(element(".selected-pitch").textContent).toBe("E5");
    expect(element(".selected-pitch").style.color).toBe("#e99db3");
    expect(element(".selected-material").textContent).toBe("Muted piano");
    if (control === "button") click(button("Remove selected note"));
    else if (control === "right-click")
      pointer("pointerdown", 30, tones.keysE5, surface(), { button: 2 });
    else key(control);
    expect(document.querySelector(seedSelector("keys", "E5", 30))).toBeNull();
    expect(notes()).toEqual(before.filter((_, index) => index !== 15));
    expect(document.activeElement).toBe(surface());
    expect(document.querySelector('[role="group"][aria-label="Selected note"]')).toBeNull();
    if (control === "button") expect(element(".gesture-hint").textContent).toBe("Note removed.");
    click(button("Undo"));
    expect(notes()).toEqual(before);
    expect(button("Undo").disabled).toBe(true);
  },
);

test("selected note details follow pitch and instrument changes", () => {
  enterSurface();
  key("PageUp");
  key("ArrowUp");
  key("ArrowUp");
  expect(element(".selected-pitch").textContent).toBe("C5");
  expect(element(".selected-pitch").style.color).toBe("#a5b4f6");
  expect(element(".selected-material").textContent).toBe("Glass chimes");
  click(button("Undo"));
  expect(element(".selected-pitch").textContent).toBe("G5");
  expect(element(".selected-pitch").style.color).toBe("#e99db3");
  expect(element(".selected-material").textContent).toBe("Muted piano");
});

test("the keyboard can reach every allowed pitch, including overlapping instrument ranges", () => {
  click(button("Sketch options"));
  click(sketchOption("Start with an empty space"));
  enterSurface();
  key("Enter");
  const light = element("[data-light]");
  expect(TONES).toHaveLength(34);
  for (let index = 0; index < TONES.length; index++) key("ArrowDown");
  for (const [index, tone] of TONES.entries()) {
    expect(light.getAttribute("aria-label")).toBe(
      `${INSTRUMENTS[tone.instrument].name}, ${tone.note.name}, beat position 17 of 32`,
    );
    expect(element(".selected-pitch").textContent).toBe(tone.note.name);
    expect(element(".selected-material").textContent).toBe(INSTRUMENTS[tone.instrument].name);
    if (index < TONES.length - 1) key("ArrowUp");
  }
  expect(notes()).toHaveLength(1);
});

test("note navigation preserves the existing redo branch", () => {
  add(2, tones.malletA3);
  const completed = notes();
  click(button("Undo"));
  const before = notes();
  enterSurface();
  key("PageDown");
  key("PageDown");
  expectSelected(seedId("mallet", "C4", 0));
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
  expect(button("Redo").disabled).toBe(false);
  click(button("Redo"));
  expect(notes()).toEqual(completed);
});

test.each(["PageUp", "PageDown"])("%s safely leaves an empty surface focused", (navigation) => {
  click(button("Sketch options"));
  click(sketchOption("Start with an empty space"));
  enterSurface();
  const event = key(navigation);
  expect(event.defaultPrevented).toBe(true);
  expect(notes()).toEqual([]);
  expect(document.activeElement).toBe(surface());
  expect(surface().tabIndex).toBe(0);
});

test("note navigation cancels an unfinished trail without committing it on release", () => {
  const before = notes();
  paint();
  key("PageDown");
  expect(notes()).toEqual(before);
  expectSelected(seedId("bass", "C2", 0));
  expectFinished();
  pointer("pointerup", 8, tones.malletC4);
  expect(notes()).toEqual(before);
  expect(button("Undo").disabled).toBe(true);
});

test("switching to pointer selection does not retain the keyboard focus treatment", () => {
  enterSurface();
  key("PageUp");
  expectSelected(seedId("keys", "E5", 30));
  const light = element(seedSelector("mallet", "C4", 0));
  pointer("pointerdown", 0, tones.malletC4, light);
  pointer("pointerup", 0, tones.malletC4);
  expect(document.activeElement).toBe(light);
  expect(light.getAttribute("aria-pressed")).toBe("true");
  expect(surface().classList.contains("is-keyboard")).toBe(false);
  pointer("pointerdown", 0, tones.malletC4, light);
  pointer("pointerup", 0, tones.malletC4);
  expect(document.activeElement).toBe(surface());
  expect(light.getAttribute("aria-pressed")).toBe("false");
});
test("keyboard input outside the surface never steals focus or changes the selected note", () => {
  const light = element(seedSelector("mallet", "C4", 0));
  pointer("pointerdown", 0, tones.malletC4, light);
  pointer("pointerup", 0, tones.malletC4);
  const mute = button("Mute audio");
  act(() => mute.focus());
  expect(key("PageDown").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(mute);
  expect(light.getAttribute("aria-pressed")).toBe("true");
});
