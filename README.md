# Vamp

A musical sketchbook for composing loops with light.

![Vamp playing a custom sketch, with colored notes glowing across the canvas](docs/screenshot.png)

[Play Vamp](https://vamp.gadkadosh.workers.dev/)

Built with React, TypeScript, Canvas 2D, and native Web Audio synthesis.

Shared mode opens a global pattern saved in a SQLite-backed Cloudflare Durable Object. Anyone can add, move, or remove notes for now. Updates aren’t streamed yet: use **Reload shared pattern** in sketch options to get other people’s changes. Each accepted edit also returns the latest pattern.

Choose **Play solo** for a private sketch with undo, redo, and reset. Switching modes keeps your solo sketch and history; reloading the page clears them. Solo edits are never published.

## Development

Use Node.js 24 LTS and pnpm.

```sh
pnpm install
pnpm types
pnpm dev
```

```sh
pnpm check      # Formatting, lint, and types
pnpm test --run
pnpm build
```

## Persistence

`GET /api/composition` loads the shared composition. `POST /api/composition` applies a batch of explicit additions, moves, or removals; see `src/shared/composition.ts` for the protocol. New shared notes use UUIDs, and the server validates timing, pitch, and musical collisions. A conflicting batch is rejected in full with HTTP 409 and the current snapshot.

The starting phrase is initialized only when the composition doesn’t exist. Empty compositions stay empty, including after the Durable Object restarts. Local development data is separate from production.

If a save response is lost, the client blocks further edits until you reload the shared pattern. It does not replay the write, because it may already have been saved.
