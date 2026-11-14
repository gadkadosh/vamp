# App tests

These are integration tests in **happy-dom**, not a real browser. `setupAppTests()` mounts the
real `App` under React StrictMode and simulates browser APIs and transport. Application modules
are not mocked.

- `gestures.test.ts`: pointer gestures, cancellation, Solo undo/redo.
- `keyboard.test.ts`: navigation, focus, shortcuts, selected-note controls.
- `rendering.test.ts`: canvas scheduling, hit targets, animation, resizing.
- `playback.test.ts`: playback controls, pending audio operations, mode changes.
- `modes.test.ts`: Solo/shared switching, private history, sketch actions.
- `collaboration.test.ts`: shared edits, remote updates, acknowledgement, reconnects.

Run one suite with `pnpm test --run test/client/keyboard.test.ts`.

## Harness

Call `setupAppTests()` once per file; it registers per-test setup and cleanup. Keep tests sequential
within a file because they share the DOM and stubbed globals. Teardown checks for leaked timers
and animation frames, and restores mocks even if those checks fail.

Use `tones.malletC4` instead of numeric tone indexes, and `seedId("mallet", "C4", 0)` or
`seedSelector("mallet", "C4", 0)` instead of seed-array indexes. Seed locators retain the original
UUID after moving a note. Sketch options are located by their text, not menu position.

Interaction helpers can be destructured from the fixture. Access resettable observations through
`app.frames`, `app.draws`, etc. inside tests, rather than destructuring them during collection.
`frame(ms)` advances wall-clock timers and one animation frame; audio time remains separately
controlled through `TestAudioContext.currentTime`.
