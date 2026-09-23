# Implementation validation

## Pre-change status inventory

Captured on 2026-09-22 before optional native impact gating.

The active repository ruleset is `Protection main` ([ruleset 13464156](https://github.com/koenvg/openforge/rules/13464156)). It requires pull requests, one approval, linear history, and signed commits. It has no required-status-check rule. The legacy branch-protection endpoint is not configured. No required context needs an owner-approved migration for this implementation.

The affected workflow and job names map as follows:

| Before | After | Status identity |
| --- | --- | --- |
| `CI` / `Mobile Companion iOS Build` | `Native Compatibility` / `Mobile Companion iOS Build` | Job display name preserved; workflow name changes |
| `CI` / `Ghostty Compatibility (macOS)` | `Native Compatibility` / `Ghostty Compatibility (macOS)` | Job display name preserved; workflow name changes |
| `Packaged Session Runtime` / `Packaged Session Runtime (arm64)` | Same | Preserved |
| `Packaged Session Runtime` / `Packaged Session Runtime (x64)` | Same | Preserved |
| `Whisper macOS compatibility` / `native-arm64` | Same | Preserved |

An ordinary pull request requested these eight macOS jobs before impact gating:

1. `CI` / `Terminal Presentation Conformance`
2. `CI` / `Rust Tests`
3. `CI` / `Packaged Electron Smoke`
4. `CI` / `Live Electron Terminal Invariants`
5. `CI` / `Mobile Companion iOS Build`
6. `CI` / `Ghostty Compatibility (macOS)`
7. `Packaged Session Runtime` / `Packaged Session Runtime (arm64)`
8. `Packaged Session Runtime` / `Packaged Session Runtime (x64)`

The first four remain unconditional pull-request jobs. This ticket gates the last four by their owned path families. Whisper is already path-scoped and is converted to an explicit classify-then-gate result.

## Pre-change timing baseline

Times come from the GitHub Actions run and jobs APIs. Queue delay is job `created_at` to `started_at`. Runtime is `started_at` to `completed_at`. Cumulative macOS runtime sums the eight macOS job runtimes. Revision wall time spans the earliest workflow creation through the latest workflow completion, including CI, Packaged Session Runtime, and Storybook visual smoke for the revision.

| Revision | Revision wall time | macOS jobs | Cumulative macOS runtime |
| --- | ---: | ---: | ---: |
| [`551fd0c0`](https://github.com/koenvg/openforge/commit/551fd0c0ca3cf4f1a32cd6ac5594545d2362ec9d) | 40m 43s | 8 | 68m 59s |
| [`0a4d7d64`](https://github.com/koenvg/openforge/commit/0a4d7d64f9ad66fd89394bdf4fe33cdca846f2a3) | 29m 43s | 8 | 65m 58s |
| [`683f8900`](https://github.com/koenvg/openforge/commit/683f8900c0ddd360b2394db41475b2686f4f3001) | 69m 25s | 8 | 61m 07s |

### Revision `551fd0c0`

Workflow wall times: [CI](https://github.com/koenvg/openforge/actions/runs/35727065964) 40m 24s; [Packaged Session Runtime](https://github.com/koenvg/openforge/actions/runs/35727065949) 40m 43s; [Storybook visual smoke](https://github.com/koenvg/openforge/actions/runs/35727065969) 12m 23s.

| Job | Created | Started | Completed | Runner label | Queue | Runtime |
| --- | --- | --- | --- | --- | ---: | ---: |
| Live Electron Terminal Invariants | 12:25:17Z | 12:52:53Z | 13:02:54Z | `macos-15` | 27m 36s | 10m 01s |
| Terminal Presentation Conformance | 12:25:17Z | 12:48:41Z | 12:57:08Z | `macos-15` | 23m 24s | 8m 27s |
| Rust Tests | 12:25:17Z | 12:50:07Z | 12:56:58Z | `macos-15` | 24m 50s | 6m 51s |
| Ghostty Compatibility (macOS) | 12:25:17Z | 12:37:25Z | 12:40:31Z | `macos-15` | 12m 08s | 3m 06s |
| Packaged Electron Smoke | 12:25:17Z | 12:54:08Z | 13:00:48Z | `macos-15` | 28m 51s | 6m 40s |
| Mobile Companion iOS Build | 12:27:11Z | 13:00:55Z | 13:05:38Z | `macos-15` | 33m 44s | 4m 43s |
| Packaged Session Runtime (x64) | 12:25:20Z | 12:29:41Z | 12:50:01Z | `macos-15-intel` | 4m 21s | 20m 20s |
| Packaged Session Runtime (arm64) | 12:25:20Z | 12:57:05Z | 13:05:56Z | `macos-15` | 31m 45s | 8m 51s |

### Revision `0a4d7d64`

Workflow wall times: [CI](https://github.com/koenvg/openforge/actions/runs/35720319048) 29m 43s; [Packaged Session Runtime](https://github.com/koenvg/openforge/actions/runs/35720319071) 24m 27s; [Storybook visual smoke](https://github.com/koenvg/openforge/actions/runs/35720319028) 12m 47s.

| Job | Created | Started | Completed | Runner label | Queue | Runtime |
| --- | --- | --- | --- | --- | ---: | ---: |
| Terminal Presentation Conformance | 11:14:16Z | 11:30:11Z | 11:37:36Z | `macos-15` | 15m 55s | 7m 25s |
| Packaged Electron Smoke | 11:14:16Z | 11:28:53Z | 11:38:51Z | `macos-15` | 14m 37s | 9m 58s |
| Ghostty Compatibility (macOS) | 11:14:16Z | 11:18:54Z | 11:21:42Z | `macos-15` | 4m 38s | 2m 48s |
| Live Electron Terminal Invariants | 11:14:16Z | 11:27:26Z | 11:34:08Z | `macos-15` | 13m 10s | 6m 42s |
| Rust Tests | 11:14:16Z | 11:34:23Z | 11:43:56Z | `macos-15` | 20m 07s | 9m 33s |
| Mobile Companion iOS Build | 11:19:38Z | 11:35:08Z | 11:40:03Z | `macos-15` | 15m 30s | 4m 55s |
| Packaged Session Runtime (x64) | 11:14:15Z | 11:21:45Z | 11:38:41Z | `macos-15-intel` | 7m 30s | 16m 56s |
| Packaged Session Runtime (arm64) | 11:14:15Z | 11:19:38Z | 11:27:19Z | `macos-15` | 5m 23s | 7m 41s |

### Revision `683f8900`

Workflow wall times: [CI](https://github.com/koenvg/openforge/actions/runs/35710469522) 69m 25s; [Packaged Session Runtime](https://github.com/koenvg/openforge/actions/runs/35710469415) 24m 11s; [Storybook visual smoke](https://github.com/koenvg/openforge/actions/runs/35710469557) 7m 39s.

| Job | Created | Started | Completed | Runner label | Queue | Runtime |
| --- | --- | --- | --- | --- | ---: | ---: |
| Packaged Electron Smoke | 09:27:21Z | 10:22:34Z | 10:29:08Z | `macos-14` | 55m 13s | 6m 34s |
| Live Electron Terminal Invariants | 09:27:21Z | 10:29:18Z | 10:36:40Z | `macos-14` | 61m 57s | 7m 22s |
| Rust Tests | 09:27:21Z | 10:30:23Z | 10:36:13Z | `macos-14` | 63m 02s | 5m 50s |
| Ghostty Compatibility (macOS) | 09:27:21Z | 10:26:33Z | 10:29:24Z | `macos-14` | 59m 12s | 2m 51s |
| Terminal Presentation Conformance | 09:27:21Z | 10:22:41Z | 10:31:03Z | `macos-14` | 55m 20s | 8m 22s |
| Mobile Companion iOS Build | 09:28:43Z | 10:31:05Z | 10:35:25Z | `macos-14` | 62m 22s | 4m 20s |
| Packaged Session Runtime (x64) | 09:27:19Z | 09:34:13Z | 09:50:55Z | `macos-15-intel` | 6m 54s | 16m 42s |
| Packaged Session Runtime (arm64) | 09:27:19Z | 09:42:19Z | 09:51:25Z | `macos-14` | 15m 00s | 9m 06s |

The third revision predates the prerequisite macOS 15 migration. Its runner labels are retained as historical evidence; current workflow contracts reject `macos-14`.

## Implementation verification

The assigned classifier and allocation work is complete. Ordinary unrelated pull requests retain the four unconditional macOS jobs and skip the four optional allocations. Affected changes, scheduled runs, manual runs, and classifier failures select the relevant native work. Job gates also reject cancelled runs so superseded workflows cannot allocate new macOS capacity after cancellation.

Checks run on 2026-09-22:

- Full root suite: 887 files, 7,525 passing tests, 3 expected failures, and 43 skips.
- All 15 affected CI contract files: 99 passing tests.
- Root TypeScript, plugin-host TypeScript, lint, Mobile Companion contract, classifier syntax, YAML parsing, and strict OpenSpec validation: passed.
- Independent classifier, workflow, OpenSpec, maintainability, and test-quality review: completed. Its packaging dependency, failure-evidence, and cancellation findings were accepted and verified after fixes.

Native Rust, iOS, Ghostty, packaged-session, Whisper, and live GitHub Actions jobs were not run locally because no native product code changed and this ticket is specifically changing when those checks run. `actionlint` was not available. Post-change CI trials and rollout measurements remain assigned to KVG-2319.

## Linux terminal and Markdown baseline review

Reviewed on 2026-09-23 in the immutable ARM64 Playwright Ubuntu Noble image used by both Apple Silicon development hosts and `ubuntu-24.04-arm` CI.

- `pnpm terminal:visual:update` completed with 34 terminal semantic checks, 13 terminal visual comparisons, and 11 Markdown visual tests.
- All 12 new `linux-arm64` terminal PNGs and all 10 regenerated Markdown PNGs were inspected at original resolution. Terminal text, ANSI colours, cursor variants, links, Unicode, powerline glyphs, light and dark surfaces, Markdown spacing, tables, Mermaid diagrams, controls, and fallback content were present and legible.
- Pixel thresholds, readiness waits, semantic assertions, diagnostic capture, and blank-output checks were unchanged.
- Two consecutive `pnpm terminal:visual:check` runs passed after generated outputs were cleared.
- The public `pnpm markdown:visual` command was run separately and passed by delegating to the same ARM64 container; its update counterpart delegates to the canonical container update command.
- A controlled 3.77% terminal baseline mismatch failed against the existing 1% limit and retained both current and difference PNG evidence. The approved baseline was restored and hash-verified before the passing runs.
- Independent review found unsafe direct-host Markdown commands, a disconnected browser-phase test plan, and manifest-only Playwright version checking. All three findings were accepted and fixed; terminal-runtime, PR-review, Storybook visual, visual-infrastructure, TypeScript, lint, workflow-contract, and strict OpenSpec checks were rerun afterward.
