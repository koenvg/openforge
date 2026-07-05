# GitHub Sync PR review ownership

The built-in GitHub Sync plugin owns the runtime PR review container and GitHub/PR review workflow contracts in this directory. It is registered from `plugins/github-sync/src/index.ts` as `plugin:com.openforge.github-sync:pr_review`.

GitHub/PR review is a plugin-owned domain, not an OpenForge core SDK namespace. Do not add `api.githubReview`, `openforge.github`, `openforge.prReview`, or other GitHub-specific SDK capabilities for this plugin. Frontend code should use the plugin-owned typed client in `githubSyncClient.ts` plus generic SDK primitives such as view registration, local commands, navigation, events, project config, and `system.openUrl`.

`@openforge-app/pr-review-ui` is shared reusable UI used by this plugin and core self-review surfaces. It is a normal shared implementation package, not a host-shared platform runtime like `@openforge-app/terminal-runtime`, and it must not become the owner of GitHub Sync domain behavior. Do not add a parallel host-app PR review copy under `src/components/review/pr`; changes to GitHub Sync PR review behavior should be made in this plugin container, while reusable leaf UI belongs in `packages/pr-review-ui/src`.

Current transition note: `githubSyncClient.ts` is the only plugin-side typed client for GitHub Sync PR review flows. It talks to GitHub Sync-owned backend methods for PR operations and to host events for generic app update notifications. View components must not call `openforge.*` host command or event strings directly.
