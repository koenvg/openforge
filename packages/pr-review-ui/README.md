# @openforge-app/pr-review-ui

Reusable Svelte UI and diff helpers for PR/self-review surfaces in OpenForge.

This package is a shared implementation detail used by the GitHub Sync plugin and core self-review UI. It is not a host-shared platform runtime like `@openforge-app/terminal-runtime`, and it does not define or own GitHub/PR review domain operations. GitHub Sync-owned workflow code should live in `plugins/github-sync`; reusable visual components and pure diff helpers can live here.
