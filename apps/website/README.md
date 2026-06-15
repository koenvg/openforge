# OpenForge Marketing Site

Static Astro site for the public OpenForge marketing page.

## Railway deployment

This repository includes Railway config-as-code for a GitHub-connected static deployment:

- Railway service root: repository root
- Builder: Railpack
- Build command: `pnpm website:deploy`
- Deploy output: root `dist/`
- Redeploy triggers: website files plus root package/workspace lockfiles from `railway.json`

The Railway service intentionally runs from the repository root so Railpack can use the monorepo `pnpm-lock.yaml` and workspace configuration. Because Railpack detects the root `package.json` as a Node app, `pnpm website:deploy` builds the Astro site directly into root `dist/`, which is Railpack's default Node static-site output directory. No custom Node start command is configured; Railpack serves the built static files with Caddy.
