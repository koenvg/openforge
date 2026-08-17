# ADR 0003: Create a monorepo marketing site for OpenForge, not a hosted web companion

Status: Proposed
Date: 2026-05-30
Task: KVG-1346

## Context

OpenForge is a local-first desktop command center for coordinating task work and AI coding agents while keeping the user focused on one active thing at a time. A public website is useful for explaining the product, showing screenshots, and guiding developers to install it, but a hosted web product would conflict with the current product boundary and could imply cloud coordination, hosted tasks, or browser-based agent sessions.

## Decision

Create a **Marketing Site** for OpenForge as an Astro monorepo workspace app at `apps/website`, not as a separate repository and not as a hosted web companion. The first milestone is a small static one-page site focused on the promise “Run AI coding agents without losing control of the work,” ordered as hero with install/GitHub CTAs and a concrete task → agent → changes → review workflow visual, top-three reasons to use OpenForge, product screenshot proof, a small concrete plugin customization section, final install/GitHub CTA, and footer links.

The top-three homepage reasons are:

1. Stay in control of agent work.
2. Let agents manage OpenForge tasks through the CLI.
3. Customize OpenForge to your workflow with Trusted Plugins.

Plugin customization should be positioned as a first-class reason to use OpenForge: OpenForge provides the stable task-based operator console, access/management boundaries, terminal pools, and coordination primitives; Trusted Plugins let users shape the rest of the workspace around their own workflow. On the first milestone page, this should appear as both a top-reason card and a compact concrete section, not a marketplace-style surface.

## Considered Options

### Astro Marketing Site in the monorepo

Chosen because it stays aligned with product language, screenshots, package metadata, and install instructions while keeping website implementation separate from the desktop renderer. Astro fits the static marketing milestone while leaving room for content pages and Svelte islands later if needed.

### Separate website repository

Rejected for now because it would make product-language drift and screenshot/install drift more likely before the website has enough independent lifecycle to justify a separate repo.

### Hosted web companion

Rejected because it would imply a web product surface for Tasks, Implementation Runs, or Agent Sessions, which conflicts with the current local-first desktop product boundary.

### Static docs-folder site

Rejected because the site is a product marketing surface rather than project documentation, and it should be able to grow as an app workspace without mixing into `docs/`.

## Consequences

- Website implementation should live outside `src/` so it does not become part of the desktop renderer.
- The first website stack should be Astro rather than SvelteKit because the first milestone is static marketing content, not an app-like interactive surface.
- Initial scope should avoid standalone workflow education, standalone local-first trust messaging, blog, hosted docs system, plugin marketplace, analytics, mailing list, interactive demo, and multi-page content architecture.
- The final call-to-action should repeat both Install OpenForge and GitHub, with Install OpenForge as the primary action and GitHub as secondary credibility/due diligence.
- Copy should avoid claims about autonomous engineering teams, replacing review, one-click shipping, hosted control planes, universal provider support, or enterprise collaboration suites.
- Visual direction should be a developer-tool aesthetic with a concrete workflow hero visual and product screenshots, not generic AI SaaS imagery. The hero may use a vibrant block/bento workflow treatment when it still explains the task → agent → changes → review path clearly.
