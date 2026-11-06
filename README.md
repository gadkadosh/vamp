# Vamp

A local musical sketchbook: tap to leave a note, drag to change the phrase. Each note plays once per loop. Built with React, TypeScript, Canvas 2D, and native Web Audio. No external samples, audio libraries, or AI services are used. The Worker scaffold is unchanged and is not used by the instrument.

## Local development

Use Node.js 22.18+, 24.11+, or 26+ and pnpm 12.16.1. No Cloudflare account, payment method, or global Vite+ installation is needed locally.

```sh
pnpm install
pnpm types
pnpm dev
```

Open the URL printed by Vite, then press the central **Play** button to enable audio.

## Musical pattern

The Living light design gives the instrument a full-screen, deep-blue field with circular, material-colored lights. Left to right is time in a two-measure loop; bottom to top is low to high pitch. There are no cameras, depth controls, input modes, or permanent pitch grids. Open **How to play** for the guide; **Sketch options** (the three dots) contains the note count, clear, and reset actions.

Press **Play** to hear the starting phrase. Tap empty space to add a light; drag a light to change timing and pitch. A snapped landing ring and temporary alignment guides appear only while pressing to place or dragging a light, for both mouse and touch. There is no hover preview or temporary note-name label. The preview does not add or sound a note and disappears on release or cancellation. Selection strengthens the light's color and glow, without a surrounding ring. Select a light to reveal a remove button beside it; undo restores the previous gesture.

### Magnetic timing and pitch

Notes follow the pointer freely while being dragged. A faint landing point previews the nearest rhythmic step **and** pitch; release to settle gently onto both. Horizontal and vertical positions both snap. Dragging preserves the grab point. Moving past the right edge stays on the last timing step instead of wrapping unexpectedly to the beginning.

Dragging is a local preview: the original music continues until a valid release, so passing through an occupied place does not change the composition. Escape, pointer cancellation, loss of pointer capture, or the browser window losing focus returns the light home. These interruptions also discard an unfinished scattered trail. Settling and bounce animations keep canvas lights and their hit targets aligned, and honor reduced-motion preferences. Timing is always quantized; there is no free-rhythm switch.

### Gestures

- **Click empty space:** add a light at its magnetic landing point. **Tap a light:** select it; tap it again to deselect. **Drag a light:** preview a new timing and pitch, then release to commit. Small pointer movements count as taps, not edits.
- **Shift-drag empty space:** scatter a trail of lights as one undoable gesture.
- **Right-click a light**, or select it and use its nearby bin button, to remove it.
- **Undo / Redo:** buttons or Cmd/Ctrl Z / Cmd/Ctrl Shift Z. Each completed drag or scattered trail is one history entry. Undo during an unfinished gesture cancels only that gesture. Redo or another editing command cancels the gesture before applying the requested action. Canceling preserves the existing undo/redo history, and releasing a canceled gesture does nothing. Clear and reset are also undoable.
- **Speaker icon:** toggle master mute; unmuted volume is 35%.

Keyboard: Tab into the space. **Page Up / Page Down** select the previous/next light in time order, with lower pitches first at the same beat, and wrap around the loop. On Mac laptops, use Fn + ↑ / ↓. Arrows select the first light if none is selected, then move the selection one rhythmic step left/right or one pitch up/down. Enter adds a light. Keyboard focus follows the selected light and uses a small frame; pointer selection does not show it. Delete/Backspace removes; Escape deselects. **Space** plays or pauses from anywhere, including the surface and selected lights, except while typing, using another focused control, or viewing the help dialog. Holding Space does not repeatedly toggle playback. The surface has one Tab stop: the selected light, or the space itself when nothing is selected. Tab then visits the selected note’s remove button and leaves the surface. Navigation does not change the music or undo/redo history. Individual lights expose descriptive accessible names with their material, pitch, and beat position.

The musical rules are deterministic. A single ascending tone axis passes through bass, mallet, felt keys, and glass materials, with color following material. Each voice occupies a distinct pitch range, so moving higher never drops the pitch when crossing a material boundary. The starting pattern adapts the original seed phrases to this axis.

Lights land on 32 timing positions and 25 pitches, without a preallocated number of dots:

| Material     | Playable pitches, low to high  |
| ------------ | ------------------------------ |
| Plucked bass | C2, D2, E2, G2, A2, C3         |
| Mallet       | D3, E3, G3, A3, C4, D4, E4     |
| Felt keys    | F4, G4, A4, B4, C5, D5, E5, G5 |
| Glass chimes | A5, C6, D6, E6                 |

**Felt keys are polyphonic**: different notes at the same beat form a chord, and overlapping notes decay independently. Mallet and glass also permit chords.

**Bass has one note per rhythmic step.** Occupied landing points turn red and highlight the conflicting light. A new conflicting placement is rejected; a conflicting drag returns to its previous location. Identical sounds at the same beat are also rejected rather than creating silent duplicates. These rules apply to placement, dragging, keyboard moves, and scattering. A conflicting operation leaves every existing light unchanged and creates no undo entry. No light is silently ignored, and nothing is automatically shifted to another beat.

Everything—including history—lives in memory in the current tab. Reloading restores the starting pattern. There is no persistence, sharing, identity, daily lifecycle, or archive yet.

## Audio and visualization

Four synthesized acoustic sketches are available: mallet, felt keys, plucked bass, and glass chimes. Felt keys are the single melodic voice; there is no material switch. These are synthesized sketches, not recordings or physically accurate replicas.

All sounds share a two-measure 4/4 loop at 88 BPM in C major, with 32 sixteenth-note timing positions. Each material has its own natural decay, with no editable note lengths or visual tails. Bass damps at the next bass onset; other notes overlap independently. Notes can ring across the loop seam rather than being cut short. Lights bloom in their material color when they sound, with a faint sweep instead of a permanent timing ruler. Reduced motion uses illumination without expanding waves or a moving sweep. Each new loop re-articulates the phrase. Pause freezes the Web Audio clock and holds the lights; mute does not stop it. The visualization reads that same clock rather than running a separate animation timer.

The composition compiles to a list of note events, each with a stable light ID, instrument, pitch row, and timing step. Audio is scheduled slightly ahead for steady timing. Blooms use recorded strike times from that scheduler, and only appear once the audio clock reaches the onset. New, moved, or repitched lights do not inherit a bloom from a sound they have not played. Changes affect the next unscheduled audio window rather than restarting the loop. A sleeping or heavily throttled tab may skip strikes rather than catch up in a burst; skipped strikes do not produce blooms.

An unchanged paused instrument does not run a canvas animation loop. Edits and resizing redraw the scene, settling animates only until the light lands, and collision feedback expires with a single redraw. During playback, static hit targets stay in place and toolbar dimensions are observed on resize rather than measured every frame.

## Commands

```sh
pnpm check    # Generate Worker types; check formatting, lint, and types
pnpm test     # Spatial mapping, musical behavior, scheduler, and Worker tests
pnpm build    # Build the frontend and Worker
pnpm preview  # Preview the build locally (run build first)
```

Vite+ is project-local; its CLI is also available through `pnpm exec vp`. Worker types are generated into the ignored `worker-configuration.d.ts`; regenerate them with `pnpm types` after changing `wrangler.jsonc`.

The smoke test uses Wrangler’s test harness, independently of Cloudflare’s Vitest pool adapter, which does not yet support Vite+’s bundled Vitest version.

## Structure

- `src/client/main.tsx`, `style.css`: Application bootstrap and styling.
- `src/client/App.tsx`: Application shell, playback, transactional gesture history, and discovery guide.
- `src/client/PointSpace.tsx`: Direct manipulation, grouped gestures, keyboard interaction, accessible hit targets, and canvas lifecycle.
- `src/client/drawSpace.ts`: Audio-clock-driven lights, active-placement guides, landing previews, and playheads.
- `src/client/space.ts`: 2D mapping, inverse picking, and shared light/hit-target settling animation.
- `src/client/pattern.ts`: Pattern and note models, instrument layout, magnetic placement transactions, collision validation, and event compilation. `INSTRUMENT_LAYOUT` defines the instruments’ order, exposed pitches, and colors on the surface; pitch-name mappings are validated when constructing tones and the starting pattern.
- `src/client/score.ts`: Keyed instrument registry with names, voices, pitch ranges, polyphony, and seed onsets; shared pitch lookup and note-event/playback types.
- `src/client/sequencer.ts`, `voices.ts`: Audio-clock scheduler, serialized Play/Pause transitions, and synthesized voices.
- `test/`: React gesture/history and render-lifecycle tests in Happy DOM, canvas renderer tests, spatial round-trip and musical behavior tests, scheduler tests with a controlled clock, and the Worker smoke test. Evaluate actual sound in a Web Audio-capable browser.
- `src/server/`: Worker entry point, `/api/health`, and the empty `Room` class.
- `vite.config.ts`, `wrangler.jsonc`: Local development and Worker configuration.

The class registration prepares a Durable Object namespace; no room instance is created until application code accesses one. Local state belongs in `.wrangler/`, which is ignored by Git.

## Deployment (when ready)

Deployment requires a Cloudflare account. This scaffold is configured for the Workers Free plan and a `workers.dev` address; no domain purchase is necessary.

```sh
pnpm exec wrangler login
pnpm deploy
```

`pnpm deploy` builds and then deploys the Worker with its frontend assets. Nothing deploys during installation, checks, tests, or builds.
