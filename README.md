# Vamp

A musical sketchbook for composing loops with light.

![Vamp playing a custom sketch, with colored notes glowing across the canvas](docs/screenshot.png)

[Play Vamp](https://vamp.gadkadosh.workers.dev/)

Built with React, TypeScript, Canvas 2D, and native Web Audio synthesis.

The main page is one public composition: everyone can edit it, and changes are saved and shared live.
Playback and sound controls are personal, not synchronized.

Turn on **Solo mode** (or open `/solo`) to sketch privately in this tab. Solo sketches are kept
while switching modes, but reloading starts fresh. Undo and redo are available only in Solo mode.

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

## Persistence and live editing

`ROOM` addresses a single SQLite-backed Durable Object named `global`. It stores the latest
`{ revision, pattern }` under the `state` key. `/api/room` opens a hibernation-compatible WebSocket:
clients receive a snapshot on connection, submit committed add/move/remove batches, and receive the
saved snapshot after accepted edits. Draft gestures are never sent. Each batch is validated atomically
against the current pattern; unrelated edits do not require matching revisions.

The last valid move processed wins when two people move the same note. Moves of deleted notes and
musical collisions are rejected. Clear and restore affect everyone and cannot be undone. There are
no accounts, ownership, or offline edit queues; disconnected clients pause editing and reconnect to
load the saved state. Solo mode never connects to the room.

The pattern model and musical rules live in `src/shared`; synthesis stays in `src/client`.
Worker tests use Wrangler’s runtime and verify broadcasts, concurrent edits, hibernation, and
persistence across Durable Object eviction.
