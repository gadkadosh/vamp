# Vamp

The foundation for an anonymous, shared musical experiment. This scaffold contains only a React placeholder, a Worker health endpoint, and an empty SQLite-backed Durable Object. No game logic, application data model, or audio is implemented.

## Local development

Use Node.js 22.18+, 24.11+, or 26+ and pnpm 12.16.1. No Cloudflare account, payment method, or global Vite+ installation is needed locally.

```sh
pnpm install
pnpm types
pnpm dev
```

Open the URL printed by Vite. The placeholder should report **API connected**.

## Commands

```sh
pnpm check    # Generate Worker types, then check formatting, lint, and types
pnpm test     # Health-endpoint smoke test in a local Workers runtime
pnpm build    # Build the frontend and Worker
pnpm preview  # Preview the build locally (run build first)
```

Vite+ is project-local; its CLI is also available through `pnpm exec vp`. Worker types are generated into the ignored `worker-configuration.d.ts`; regenerate them with `pnpm types` after changing `wrangler.jsonc`.

The smoke test uses Wrangler's test harness, independently of Cloudflare's Vitest pool adapter, which does not yet support Vite+'s bundled Vitest version.

## Structure

- `src/client/`: React placeholder and plain CSS.
- `src/server/`: Worker entry point, `/api/health`, and the empty `Room` class.
- `test/`: Worker smoke test.
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
