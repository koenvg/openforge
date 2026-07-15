# Injectable Picker — Skill Visibility & Accessibility

**Date:** 2026-06-29
**Status:** Design — approved, pending spec review
**POC scope:** Claude ecosystem only

## Problem

Skills in Open Forge are hard to see, understand, and reach for at the moment
they matter. Two disconnected surfaces serve overlapping needs and share no
mental model:

- **Skills tab** (rail nav, ⌘L) — a global, filesystem-driven view that lists
  and edits skills grouped by a single fixed hierarchy (level → source dir). It
  can list and edit, but cannot create, delete, rename, or move skills.
- **"/" autocomplete** in the task prompt — a thin completer populated from the
  *active provider's* command list. It is optimized for users who already know
  a skill's name. There is no way to browse, assess, compare, or understand a
  catalog of (say) 30 skills, and it presents everything as one flat list.

Three deeper gaps sit underneath these surfaces:

1. **Discovery happens at the wrong altitude.** The need to find and inject a
   skill is not limited to the first prompt in the Create Task dialog — a user
   can invoke a skill at *any* turn of a live session. Both surfaces need the
   same browsing/assessment capability.
2. **"Skill" is too narrow a unit.** Users also want to reach for legacy
   commands and for their own reusable text snippets ("any injectable text I can
   send to the agent").
3. **The only organizing axis is origin.** Source dir (repo vs personal) is one
   way to categorize, but users also think in terms of *trigger mode*
   (auto-loadable vs manual) and *topic/category* (e.g. "helpers that improve
   code in area X", "guides that walk me through Y"). None of that structure
   exists today.

## Goals

- A single, **summonable** component for browsing, assessing, and selecting
  injectables — reused in **both** the Create Task dialog and the live task
  view.
- **Faceted browse**: search + switchable grouping + filtering, replacing the
  flat "/" list with logical structure.
- Treat the unit as an **Injectable**: skills, legacy commands, and Open
  Forge–owned snippets.
- **Provider-scoped** to the active task's ecosystem, rendered with that
  ecosystem's semantics, behind an adapter seam that makes adding ecosystems
  additive.
- **Origin clarity**: every item clearly shows where it came from
  (repo / personal / plugin).

## Non-goals (POC)

- Provider adapters other than Claude (Pi / Codex / OpenCode / agents) — the
  architecture must allow them, but the POC ships only Claude.
- AI-assisted categorization — fast-follow within the POC, after manual
  categorization and the overlay store exist.
- Delete / create / rename in the management (Skills) tab — tracked separately;
  the tab remains the natural future home for these.
- Surfacing `user-invocable: false` background skills. The picker shows only
  what the user can invoke.
- Pinning a snippet to a specific provider — snippets are universal in the POC.

## Background: how Claude classifies injectables

From current Claude Code docs, the modern model has merged custom commands into
skills. What an item *is* no longer depends on which folder holds it; behavior
is governed by frontmatter:

- A skill's `description` (+ optional `when_to_use`) is loaded into context so
  the agent knows the skill exists; the full body loads only on invocation
  (progressive disclosure).
- `disable-model-invocation: true` → the agent cannot auto-invoke; only the user
  can (`/name`). This is the "manual-only / command-like" case.
- `user-invocable: false` → hidden from the `/` menu; the agent pulls it in
  silently. **Out of scope** for this picker.

This is why the picker's **trigger-mode** axis is derived from flags, not from a
folder, and why it must be normalized per provider — other ecosystems will not
share Claude's exact flag vocabulary.

## The core model: Injectable

One unit underlies everything: an **Injectable** is something the user can send
into an agent conversation.

| Kind        | Origin                                                   | Scope               | Trigger                                                        |
| ----------- | -------------------------------------------------------- | ------------------- | -------------------------------------------------------------- |
| **Skill**   | `.claude/skills`, `~/.claude/skills`, Claude plugins     | provider-scoped     | auto + manual (default), *or* manual-only (`disable-model-invocation`) |
| **Command** | `.claude/commands` (legacy)                              | provider-scoped     | manual-only                                                    |
| **Snippet** | Open Forge–owned                                         | **provider-agnostic** | manual-only                                                  |

Skills and commands are **discovered** (read-only origin; edited in place via
the existing flow). Snippets are **authored and owned** by Open Forge.

Each injectable exposes a normalized shape for the UI:

```
Injectable {
  id            // stable identity (see Persistence)
  kind          // 'skill' | 'command' | 'snippet'
  name          // display + invocation token
  description   // for assessment in the picker
  origin        // 'repo' | 'personal' | 'plugin' | 'openforge'
  triggerMode   // 'auto+manual' | 'manual-only'
  provider      // 'claude' (POC); null for provider-agnostic snippets
  invocation    // how to insert it: '/name', '/plugin:skill', or raw text
  categories    // string[] from the Open Forge overlay
}
```

## Component: the Injectable Picker

A single summonable component reused across surfaces. Three entry points, one
experience:

- A visible **button/affordance** near the prompt input.
- A **keyboard shortcut** (proposed ⌘K; must not collide with the existing
  ⌘H / ⌘G / ⌘L / ⌘, navigation set).
- **"/"** as the power-user fast path — typing "/" opens the same picker
  pre-filtered to the typed query, preserving today's muscle memory.

Behavior:

- It is **modal and dismissible** — summoned on demand, never an ambient panel —
  to respect Open Forge's focus/low-distraction product value.
- Selecting an item inserts its `invocation` into the prompt (`/name`,
  `/plugin:skill`, or the snippet's text), then closes.
- It works identically in the Create Task dialog and the live task view. In the
  dialog it can only populate once an agent/ecosystem is chosen; before that it
  shows a graceful "pick an agent first" state.

## Provider scoping + adapter seam

The picker is scoped to the **active task's ecosystem** (outer scope). A
`.pi` skill is genuinely not invocable in a Claude session, so it must not
appear there.

A **provider adapter** encapsulates "how this ecosystem works":

- where its skills/commands live and how to discover them,
- how to read its trigger semantics (e.g. Claude's `disable-model-invocation`),
- its invocation syntax and namespacing (e.g. `/plugin:skill`).

The **POC ships only the Claude adapter**, behind a clean interface so adding
Pi / Codex / OpenCode later is additive rather than a rewrite. **Snippets bypass
scoping** — they are provider-agnostic and appear in every ecosystem's picker.

Within the Claude scope, **origin** (repo / personal / plugin) is a facet, not
the top-level grouping.

## Faceted browse

Inside the active provider scope, the picker supports **search + switchable
grouping + filtering** across three axes:

- **Origin** — repo / personal / plugin
- **Trigger mode** — auto+manual vs manual-only
- **Category** — the user's topical buckets (overlay; see below)

Each row shows: name, description, an **origin badge**, and a **trigger-mode
badge**. This is the central upgrade over today's flat list: the same catalog,
now navigable by the axis the user is actually thinking in.

## Categories: an Open Forge overlay

Topical categories do not exist yet and must be stored somewhere. They live in
an **Open Forge–owned store**, keyed to a stable injectable identity — **never
written into the user's skill files**. Rationale: it is the only option that
covers skills + commands + snippets uniformly, works across providers, keeps AI
out of user files, and is reversible.

- **Manual** (POC): assign, rename, and reorder categories; attach an injectable
  to zero or more categories.
- **AI-assisted** (fast-follow): an on-demand "organize these for me" that reads
  descriptions, proposes a category set, and lets the user accept/edit — never
  silently mutating anything.

The **taxonomy is global**; the *items shown* under it are provider-filtered, so
a category can span ecosystems once more adapters land.

## Snippets

A new, small CRUD surface owned by Open Forge:

- create / edit / delete a **named text snippet**,
- categorize it like any other injectable,
- inject it into any ecosystem's prompt.

Snippets are first-class injectables of kind `snippet`, provider-agnostic.

## Persistence & data flow

- **Skills / commands (read):** discovered via the existing skills-viewer
  filesystem scan (`listSkills`), **extended to parse the trigger-mode flags**
  (`disable-model-invocation`) that today's `SkillInfo` does not capture. To
  also cover **installed Claude plugin skills** (which the filesystem scan can
  miss but the provider knows about), the Claude adapter merges the filesystem
  scan with the provider command list — filesystem scan for rich metadata,
  provider list for the canonical invocable set including plugins.
- **Categories overlay + snippets (read/write):** new Open Forge–owned
  persistence via the Rust sidecar (SQLite) with typed IPC wrappers in
  `src/lib/ipc.ts`, per the project's transport rules.
- **Stable identity (`id`):** for skills/commands, derived from
  provider + level + source_dir + source_path (stable across edits). For
  snippets, an Open Forge–generated id. The overlay keys on this id so category
  assignments survive edits; if an underlying file moves such that its identity
  changes, its overlay entry is treated as orphaned rather than silently
  reassigned.

## Relationship to the existing Skills tab

The two surfaces keep distinct jobs over the same catalog data:

- **Skills tab (⌘L)** — the global "manage everything" home across all
  ecosystems, and the natural future home for the delete / create / rename gaps
  identified at the start of this effort.
- **Injectable Picker** — the scoped "use it here" surface, summonable inside
  task composition.

The asymmetry (tab is global; picker is provider-scoped) is deliberate.

## POC boundary

**In:**

- Claude-only provider adapter.
- The shared Injectable Picker in both the Create Task dialog and the task view.
- Summon via button, shortcut, and "/" fast path.
- Faceted browse: origin / trigger-mode / category, with search.
- Open Forge category overlay + manual categorization.
- Snippets CRUD.
- Origin and trigger-mode badges.

**Out (follow-ons):**

- Other provider adapters.
- AI-assisted categorization.
- Delete / create / rename in the Skills tab.
- Pinning snippets to a provider.
- `user-invocable: false` background skills.

## Open questions (to resolve in planning)

- **Product name** for the component ("Injectable Picker" is a working title).
- **Exact shortcut** (proposed ⌘K) — confirm no collision.
- **Component & catalog ownership** — whether the picker is a core component
  calling the skills-viewer plugin's backend, or whether catalog logic moves to
  core. Affects where the adapter and merge logic live.
- **Orphaned overlay entries** — exact UX when a categorized skill disappears or
  changes identity.

## Success criteria

- From either the Create Task dialog or a live task view, a user can summon the
  picker, browse their Claude injectables grouped by origin, trigger mode, or
  category, search them, and insert one into the prompt.
- A user can create a snippet and inject it from any ecosystem's picker.
- A user can manually assign categories to injectables and browse by them,
  without any change being written to skill files on disk.
- Each item clearly communicates its origin (repo / personal / plugin) and
  whether the agent can auto-invoke it or it is manual-only.
