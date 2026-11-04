# Vamp

A local musical playground: an abstract space you learn to play by placing and moving lights. Each light plays once per loop. Built with React, TypeScript, Canvas 2D, and native Web Audio. Orbit and Volume use perspective projection and inverse picking, without a 3D library. No external samples, audio libraries, or AI services are used. The Worker scaffold is unchanged and is not used by the instrument.

## Local development

Use Node.js 22.18+, 24.11+, or 26+ and pnpm 12.16.1. No Cloudflare account, payment method, or global Vite+ installation is needed locally.

```sh
pnpm install
pnpm types
pnpm dev
```

Open the URL printed by Vite, then press **Play & discover** to enable audio.

## Three spatial experiments

There are no instrument cards or permanent pitch grids. All three views edit **the same constellation**; switching geometry, flattening, or rotating the camera never changes the music. Open **?** to discover the rules. The app currently opens in the experimental Volume view; Constellation and Orbit remain available for comparison.

- **Constellation:** left-to-right controls a light’s position in a two-measure loop; bottom-to-top moves from low to high pitches. A sweeping playhead and pulses connect each light to the sound it makes.
- **Orbit:** timing wraps around a perspective ring, and pitch increases outward from its center. Drag the compass handle to turn the viewpoint (including on touchscreens); click it to reset. Alt-drag or right-drag empty space also turns the view. Source dragging is picked at its actual height.

- **Volume (lab):** a genuine 3D volume: horizontal position is timing, height is pitch, and depth is per-note loudness. A movable writing membrane makes placement unambiguous rather than asking a 2D pointer to specify three coordinates at once. Threads connect successive notes of each material; their curves are visual, not additional notes.

### Trying Volume

1. Press **Play & discover**, then **Breathe** to spread the starting phrase through depth with an undoable wave of dynamics. Breathe is deterministic; repeating it without edits does nothing.
2. Choose **Whisper**, **Glow**, or **Flare** to move the writing membrane. Click to add a note on that plane. Ordinary dragging edits timing and pitch at the note's own depth, even when it is not on the membrane.
3. Turn on **Pull depth**, then drag a light up to make it louder and bring it forward, or down to soften it. Alt-drag a light does the same without changing mode. Drag empty space in Pull depth mode to move the membrane continuously. Note drags remain previews until release; cancellation leaves the score unchanged.
4. **Flatten** removes perspective while keeping every note's intensity. Use it to recover an unobstructed composing surface, then return to the volume. Drag **⌖** to turn the volume; click to reset the camera. Camera angles are deliberately limited to keep the writing plane pickable.
5. With a light selected, **Shift + arrows** adjust its intensity by 10%. Undo/redo includes depth edits and Breathe. The controls work with touch as well as a mouse.

Unedited notes sit at the middle depth and retain their original loudness. Depth scales the actual synthesized envelope of every material, including felt/nylon alternatives; it does not introduce spatial audio, reverb, or a new timbre. Depth does not permit duplicate sounds or a second bass note on the same beat. New notes use the membrane's intensity; switching views preserves it.

**Experiment hypothesis:** depth may be useful as an expressive dimension, provided the user can compose on a stable plane and flatten the view whenever perspective costs clarity. This is not yet evidence that Volume should replace Constellation. Compare the ease of placing a chord, moving one note, and shaping a phrase—not just the appearance of the space.

### Magnetic timing and pitch

Lights follow the pointer freely while being dragged. A faint landing point previews the nearest rhythmic step **and** pitch; release to settle gently onto both. Constellation snaps horizontal and vertical positions; Orbit snaps angle and radius. No grid needs to be shown. Dragging preserves the grab point.

Dragging is a local preview: the original music continues until a valid release, so passing through an occupied place does not change the composition. Pointer cancellation returns the light home. Settling and bounce animations keep canvas lights and their hit targets aligned, and honor reduced-motion preferences. Timing is always quantized; there is no free-rhythm switch.

### Gestures

- **Click empty space:** add a light at its magnetic landing point. **Drag a light:** preview a new timing and pitch, then release to commit.
- **Shift-drag empty space:** scatter a trail of lights as one undoable gesture.
- **Right-click a light**, or select it and use the lower bin button, to remove it. The duplicate button adds a copy four steps later.
- **Undo / Redo:** buttons or Cmd/Ctrl Z / Cmd/Ctrl Shift Z. Each drag or scattered trail is one history entry. Clear and reset are also undoable.
- **Wave icon:** switch the melody’s material between felt and nylon while preserving the same lights. The speaker toggles master mute; unmuted volume is 35%.

Keyboard: Tab into the space. Enter adds a light; arrows select the first light if none is selected, then move the selection one rhythmic step left/right or one pitch up/down; Delete/Backspace removes; Escape deselects; Space plays or pauses. Tab leaves the surface. Individual lights expose descriptive accessible names, and the selected light is also keyboard-focusable.

The musical rules are deterministic. A single ascending tone axis passes through bass, mallet, melody, and glass materials, with color following material. It uses a subset of each voice’s original range so moving higher never drops the pitch when crossing a material boundary. The starting constellation adapts the original seed phrases to this axis.

Lights land on 32 timing positions and 19 pitches, without a preallocated number of dots. **Felt keys and nylon are polyphonic**: different notes at the same beat form a chord, and overlapping notes keep independent gates. Mallet and glass also permit chords.

**Bass has one note per rhythmic step.** Occupied landing points turn red and highlight the conflicting light. A new conflicting placement is rejected; a conflicting drag returns to its previous location. Identical sounds at the same beat are also rejected rather than creating silent duplicates. These rules apply to placement, dragging, duplication, keyboard moves, and scattering. A conflicting operation leaves every existing light unchanged and creates no undo entry. No light is silently ignored, and nothing is automatically shifted to another beat.

Everything—including history—lives in memory in the current tab. Reloading restores the starting constellation. There is no persistence, sharing, identity, daily lifecycle, or archive yet.

## Audio and visualization

Five synthesized acoustic sketches are available: mallet, felt keys, nylon pluck, plucked bass, and glass chimes. Felt and nylon are alternatives for the same melodic lights, never doubled together. These are synthesized sketches, not recordings or physically accurate replicas.

All sounds share a two-measure 4/4 loop at 88 BPM in C major, with 32 sixteenth-note timing positions. Melody notes overlap independently and damp at their own gate ends. Bass damps at its gate end or the next bass onset. Notes can ring across the loop seam rather than being cut short. Each new loop re-articulates the phrase. Pause freezes the Web Audio clock and holds the visual playhead; mute does not stop it. The visual playhead reads that same clock rather than running a separate animation timer.

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

- `src/client/main.tsx`, `style.css`: Application shell, playback, view switching, history, and discovery guide.
- `src/client/PointSpace.tsx`: Direct manipulation, grouped gestures, keyboard interaction, accessible hit targets, and canvas lifecycle.
- `src/client/drawSpace.ts`: Audio-clock-driven visualization, lights, and playheads.
- `src/client/space.ts`, `volume.ts`: Spatial projection, depth-aware inverse picking, flattening, and shared canvas/hit-target settling animation.
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
