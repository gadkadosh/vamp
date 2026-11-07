# Vamp

A musical sketchbook for composing loops with light.

![Vamp playing a custom sketch, with colored notes glowing across the canvas](docs/screenshot.png)

[Play Vamp](https://vamp.gadkadosh.workers.dev/)

Built with React, TypeScript, Canvas 2D, and native Web Audio synthesis.

Sketches aren’t saved; reloading starts fresh.

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
