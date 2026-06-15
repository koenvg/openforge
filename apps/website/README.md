# OpenForge Marketing Site

Static Astro site for the public OpenForge marketing page.

## Railway deployment

This repository includes Railway config-as-code for a GitHub-connected static deployment:

- Railway service root: repository root
- Builder: Railpack
- Build command: `pnpm website:deploy`
- Static file root: `apps/website/dist` via the root `Staticfile`
- Redeploy triggers: website files plus root package/workspace lockfiles from `railway.json`

No Node start command is configured; Railway serves the built static files.
