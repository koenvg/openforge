# OpenForge plugin documentation outline

This section will become the developer-facing documentation set for building OpenForge plugins with `@openforge-app/plugin-sdk`. The SDK and host-shared `@openforge-app/terminal-runtime` package are MIT-licensed for personal, internal, open source, and commercial plugin development; the OpenForge app itself and internal workspace packages such as `@openforge-app/plugin-runtime` and `@openforge-app/pr-review-ui` remain separately licensed as source-available/proprietary software with no commercial resale or redistribution permission.

The existing cleaned guide at `docs/plugin-authoring.md` is the current source material. The pages below should split that material into reviewable, developer-consumable docs.

## Proposed pages

1. **Overview / start here** (`docs/plugins/README.md`)
   - What OpenForge plugins are
   - Trusted plugin model
   - Frontend vs backend plugins
   - Where to go next

2. **Create a plugin** (`docs/plugins/create-a-plugin.md`)
   - Minimal package structure
   - `package.json#openforge` metadata
   - Frontend entry point
   - Backend entry point
   - Build output expectations

3. **SDK reference** (`docs/plugins/sdk-reference.md`)
   - Public import surface
   - `defineFrontendPlugin` / `defineBackendPlugin`
   - Core types and contexts
   - Public utility exports
   - Links back to source TypeScript contracts

4. **Capability reference** (`docs/plugins/capabilities.md`)
   - Capability naming and `requires`
   - Shared capabilities
   - Frontend-only capabilities
   - Backend-only capabilities
   - Explicitly unavailable APIs and non-goals

5. **Testing plugins** (`docs/plugins/testing.md`)
   - `@openforge-app/plugin-sdk/testing`
   - Registry fake usage
   - Mock API usage
   - Registration, lifecycle, storage, task API, backend RPC, and background-service test patterns

6. **Publishing and installation** (`docs/plugins/publishing-and-installation.md`)
   - Build and package expectations
   - Versioning and API compatibility
   - Installed package contents
   - Plugin Installation vs Project Plugin Enablement
   - SDK/runtime MIT license metadata, internal app-license boundaries, and npm release expectations

7. **Examples and recipes** (`docs/plugins/examples.md`)
   - Frontend-only view plugin
   - Backend method plus frontend view
   - Command and background service
   - Task Creation and Implementation Run workflow
   - Storage/config examples

## Terminology to preserve

Use the glossary terms from `CONTEXT.md`, especially:

- Trusted Plugin
- Plugin Installation
- Project Plugin Enablement
- Plugin-owned Domain
- Task Creation
- Implementation Run
- Handoff Notes
- host capabilities

## Ticketing plan

Create one dependent OpenForge task per proposed page so each document can be written and reviewed independently.
