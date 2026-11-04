# Vamp

A local musical sketchbook: tap to leave a note, drag to change the phrase. Each note plays once per loop. Built with React, TypeScript, Canvas 2D, and native Web Audio. No external samples, audio libraries, or AI services are used. The Worker scaffold is unchanged and is not used by the instrument.

## Local development

Use Node.js 22.18+, 24.11+, or 26+ and pnpm 12.16.1. No Cloudflare account, payment method, or global Vite+ installation is needed locally.

```sh
pnpm install
pnpm types
pnpm dev
```

Open the URL printed by Vite, then press **Play & discover** to enable audio.

## Constellation

Notes appear as colored lights on a dark field. Left to right is time in a two-measure loop; bottom to top is low to high pitch. There are no cameras, depth controls, input modes, or permanent pitch grids. Open **?** to discover the rules.

Press **Play & discover** to hear the starting phrase. Tap empty space to add a light; drag a light to change timing and pitch. A snapped landing ring and temporary alignment guides appear only while pressing to place or dragging a light, for both mouse and touch. There is no hover preview or temporary note-name label. The preview does not add or sound a note and disappears on release or cancellation. Select a light to duplicate or remove it; undo restores the previous gesture.

### Magnetic timing and pitch

Notes follow the pointer freely while being dragged. A faint landing point previews the nearest rhythmic step **and** pitch; release to settle gently onto both. Horizontal and vertical positions both snap. Dragging preserves the grab point. Moving past the right edge stays on the last timing step instead of wrapping unexpectedly to the beginning.

Dragging is a local preview: the original music continues until a valid release, so passing through an occupied place does not change the composition. Pointer cancellation returns the light home. Settling and bounce animations keep canvas lights and their hit targets aligned, and honor reduced-motion preferences. Timing is always quantized; there is no free-rhythm switch.

### Ringing length

Each light has a horizontal, fading tail: the maximum time its sound may ring. Select a light and drag the small diamond below its endpoint to resize it, without moving its onset or pitch. Length follows the pointer freely and settles to whole sixteenth-note steps on release, from 1 to 32 steps. The tail continues at the left edge if it crosses the loop seam.

Shortening damps **every material**, including mallet and glass. Extending allows the natural decay to continue; it does not hold the volume constant or stretch the sound. Bass tails end at the next bass note, and resizing cannot extend past that onset. Overlapping polyphonic notes keep independent gates.

Unedited lights inherit their material's default: bass 4 steps, felt/nylon 2, mallet 6, glass 17. The struck defaults are rounded up to let the original natural decays finish, preserving the starting sound. Explicitly resized lengths stay with lights when moved, duplicated, or switched between felt and nylon. Resize gestures are previews until release, cancel safely, and are undoable like position edits. Audio changes apply to the next unscheduled strike, not a note already ringing.

### Gestures

- **Click empty space:** add a light at its magnetic landing point. **Drag a light:** preview a new timing and pitch, then release to commit.
- **Drag the selected endpoint:** change ringing length. The light itself still moves timing and pitch.
- **Shift-drag empty space:** scatter a trail of lights as one undoable gesture.
- **Right-click a light**, or select it and use the lower bin button, to remove it. The duplicate button adds a copy four steps later.
- **Undo / Redo:** buttons or Cmd/Ctrl Z / Cmd/Ctrl Shift Z. Each drag or scattered trail is one history entry. Clear and reset are also undoable.
- **Wave icon:** switch the melody’s material between felt and nylon while preserving the same lights. The speaker toggles master mute; unmuted volume is 35%.

Keyboard: Tab into the space. Enter adds a light; arrows select the first light if none is selected, then move the selection one rhythmic step left/right or one pitch up/down. **[ / ]** shorten/lengthen the selection by one step. Tab can focus the selected endpoint, where left/right resize instead of moving the light. Enter on the endpoint returns focus to the surface. Delete/Backspace removes; Escape deselects; Space plays or pauses. Tab leaves the surface and its selected controls. Individual lights expose descriptive accessible names including their maximum ringing length.

The musical rules are deterministic. A single ascending tone axis passes through bass, mallet, melody, and glass materials, with color following material. It uses a subset of each voice’s original range so moving higher never drops the pitch when crossing a material boundary. The starting constellation adapts the original seed phrases to this axis.

Lights land on 32 timing positions and 19 pitches, without a preallocated number of dots. **Felt keys and nylon are polyphonic**: different notes at the same beat form a chord, and overlapping notes keep independent gates. Mallet and glass also permit chords.

**Bass has one note per rhythmic step.** Occupied landing points turn red and highlight the conflicting light. A new conflicting placement is rejected; a conflicting drag returns to its previous location. Identical sounds at the same beat are also rejected rather than creating silent duplicates. These rules apply to placement, dragging, duplication, keyboard moves, and scattering. A conflicting operation leaves every existing light unchanged and creates no undo entry. No light is silently ignored, and nothing is automatically shifted to another beat.

Everything—including history—lives in memory in the current tab. Reloading restores the starting constellation. There is no persistence, sharing, identity, daily lifecycle, or archive yet.

## Audio and visualization

Five synthesized acoustic sketches are available: mallet, felt keys, nylon pluck, plucked bass, and glass chimes. Felt and nylon are alternatives for the same melodic lights, never doubled together. These are synthesized sketches, not recordings or physically accurate replicas.

All sounds share a two-measure 4/4 loop at 88 BPM in C major, with 32 sixteenth-note timing positions. All materials damp at their own gate ends; polyphonic notes overlap independently. Bass also damps at the next bass onset. Notes can ring across the loop seam rather than being cut short. Each new loop re-articulates the phrase. Pause freezes the Web Audio clock and holds the visual playhead; mute does not stop it. The visual playhead reads that same clock rather than running a separate animation timer.

Audio is scheduled slightly ahead for steady timing. Changes affect the next unscheduled audio window rather than restarting the loop. A sleeping or heavily throttled tab may skip strikes or delay held-note changes rather than catch up in a burst.

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

- `src/client/main.tsx`, `style.css`: Application shell, playback, history, and discovery guide.
- `src/client/PointSpace.tsx`: Direct manipulation, grouped gestures, keyboard interaction, accessible hit targets, and canvas lifecycle.
- `src/client/drawSpace.ts`: Audio-clock-driven lights, active-placement guides, landing previews, and playheads.
- `src/client/space.ts`: 2D mapping, inverse picking, loop-wrapped tails, and shared head/length-handle settling animation.
- `src/client/playground.ts`: Light model, tone/material registry, magnetic placement transactions, collision validation, and event compilation.
- `src/client/score.ts`: Original voice definitions, ranges, seeds, and low-level cell-editing rules.
- `src/client/sequencer.ts`, `voices.ts`: Audio-clock scheduler and synthesized voices.
- `test/`: Spatial round-trip and musical behavior tests, scheduler tests with a controlled clock, and the Worker smoke test. Evaluate actual sound in a Web Audio-capable browser.
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
