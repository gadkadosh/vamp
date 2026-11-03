# Vamp

A small local musical prototype for an eventual shared experiment. The instrument uses React, TypeScript, and native Web Audio, with no audio libraries or external samples. The Worker scaffold is unchanged and is not used by the instrument.

## Local development

Use Node.js 22.18+, 24.11+, or 26+ and pnpm 12.16.1. No Cloudflare account, payment method, or global Vite+ installation is needed locally.

```sh
pnpm install
pnpm types
pnpm dev
```

Open the URL printed by Vite, then press **Play** to enable audio.

## The instrument

Four roles share 32 sixteenth-note steps over two 4/4 measures at a fixed 88 BPM. Five voices are available, with two alternatives for the melody. Play begins with the original four-part ensemble; nylon starts muted:

- **Mallet — harmony, C4–A4:** the unchanged original sine voice and seed. Its five pentatonic pitches can form chords or repeating figures.
- **Felt keys — melody, C4–E5:** ten C-major pitches, including F and B. Only one note sounds at a time; selecting a pitch replaces the other pitch in that column, and a new note damps the previous note's tail.
- **Nylon pluck — alternative melody, C4–E5:** a generated plucked string with a rounded body and a brighter initial pluck. It has the same ten pitches and starting phrase as felt keys, but an independently editable, monophonic grid. Use **Listen alone** to compare them, or mute felt keys and enable nylon to try it with the ensemble.
- **Plucked bass — foundation, C2–C3:** six low pentatonic pitches, also one note at a time. A locally generated, Karplus–Strong-style string loses energy and brightness as it rings.
- **Glass chimes — sparkle, C5–C6:** six high pentatonic pitches with slowly decaying, inharmonic overtones. Chords are allowed; the seed uses just two accents.

These are synthesized acoustic sketches, not recordings or physically accurate replicas. The common key keeps the registers related, but the melodic F and B introduce more tension and movement than pentatonic-only notes.

- **Listen alone** mutes the other voices and starts or resumes playback. **Ensemble** restores mallet, felt keys, bass, and glass, leaving the alternative nylon voice muted. Neither resets the position or erases edits; use **Sound on / Muted** to choose any combination, including both melody voices.
- Keys, nylon, and bass join adjacent cells of the same pitch into one note. It rings and naturally fades rather than holding a static tone; empty cells damp it. There is no arbitrary note-length cap. Each new two-measure loop re-articulates the phrase, so even a fully filled row plays again.
- Mallet and glass strike again on each enabled cell, and can play simultaneous pitches. Click cells to edit any instrument independently, including while playing; any or all cells can be cleared.
- Arrow keys move between cells within each grid; Space or Enter toggles the focused cell. On small screens, scroll each grid horizontally.
- **Pause** freezes all voices and held notes; **Play** resumes from the same position. Master volume starts at 35%; setting it to 0 mutes all instruments without stopping the loop.

Audio is scheduled slightly ahead on the Web Audio clock for steady timing, so edits take effect on the next unscheduled step. A sleeping or heavily throttled tab may skip strikes or delay held-note changes rather than catch up in a burst.

Everything lives in memory in the current tab. Reloading restores the seed. There is no persistence, sharing, identity, contribution limit, daily lifecycle, or archive yet.

## Commands

```sh
pnpm check    # Generate Worker types, then check formatting, lint, and types
pnpm test     # Audio scheduler tests and Worker health-endpoint smoke test
pnpm build    # Build the frontend and Worker
pnpm preview  # Preview the build locally (run build first)
```

Vite+ is project-local; its CLI is also available through `pnpm exec vp`. Worker types are generated into the ignored `worker-configuration.d.ts`; regenerate them with `pnpm types` after changing `wrangler.jsonc`.

The smoke test uses Wrangler's test harness, independently of Cloudflare's Vitest pool adapter, which does not yet support Vite+'s bundled Vitest version.

## Structure

- `src/client/main.tsx`, `PatternGrid.tsx`, `style.css`: React instrument controls, reusable note grids, and plain CSS.
- `src/client/score.ts`: Instrument roles, pitch ranges, seeds, and musical editing rules.
- `src/client/sequencer.ts`: Shared audio-clock scheduler and single-voice articulation.
- `src/client/voices.ts`: Mallet, felt keys, generated nylon and bass strings, and glass chimes.
- `src/server/`: Worker entry point, `/api/health`, and the empty `Room` class.
- `test/`: Scheduler behavior tests with a controlled audio clock, plus the Worker smoke test. To evaluate the actual sound, use the instrument in a Web Audio-capable browser.
- `vite.config.ts`: Vite+, React, and Cloudflare local-development integration.
- `wrangler.jsonc`: Worker configuration, Durable Object binding, and SQLite class registration.

The class registration prepares a Durable Object namespace; no room instance is created until application code accesses one. Local state belongs in `.wrangler/`, which is ignored by Git.

## Deployment (when ready)

Deployment requires a Cloudflare account. This scaffold is configured for the Workers Free plan and a `workers.dev` address; no domain purchase is necessary.

```sh
pnpm exec wrangler login
pnpm deploy
```

`pnpm deploy` builds and then deploys the Worker with its frontend assets. Nothing deploys during installation, checks, tests, builds, or local development.
