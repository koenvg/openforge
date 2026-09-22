# Review screenshot changes

The manifest includes foundation, task workspace, host chrome, Plugin SDK, terminal, navigation/search, and Task Browser cases. See [task workspaces](storybook-task-workspaces.md), [host chrome and feedback](storybook-host-chrome.md), [SDK composite layouts](storybook-sdk-composites.md), [navigation workflows](storybook-navigation.md), and [Task Browser](storybook-task-browser.md) for their adopted states and interaction checks. It does not enforce coverage of the remaining Storybook catalog.

For Task Creation, prompt editing, Project Setup, and branch-divergence dialogs, see [the creation/setup catalog](storybook-creation-setup.md).

## Icon-button tooltip checks

After `pnpm storybook:build`, run `node scripts/storybook-tooltip-check.mjs`. It starts the built Storybook server and checks default positioning, edge wrapping, unavailable controls, opt-out, dialogs, and menus in all four themes, plus keyboard/click counts, reduced motion, narrow toolbars, and first-touch activation. Screenshots and results go to `artifacts/tooltips/browser`; these are review evidence, not canonical baselines.

The `Components/Plugin SDK/Tooltips` stories exercise both automatic IconButton tooltips and opt-in Button tooltips. The canonical split-button keyboard snapshots include the focused menu-trigger tooltip; standalone tooltip snapshots include the eight-pixel viewport gutter.

## Built-in themes

OpenForge Light and OpenForge Dark use the Studio design: neutral surfaces, rounded controls, and restrained shadows. They retain their names and `openforge-light` / `openforge-dark` identifiers, so saved selections and legacy light/dark preferences receive the redesign without migration. The default and unavailable-theme fallback remain OpenForge Light.

Workshop Light and Workshop Dark are additional choices with warm paper or graphite surfaces, amber actions, and crisp corners. They remain available for interactive Storybook review but are not part of the canonical screenshot matrix. There are no separate Studio choices or accepted `studio-light` / `studio-dark` capture IDs. Theme selection does not override the user's terminal font.

Built-in themes remain opaque. Plugin themes can opt into in-app palette translucency and backdrop blur through the [SDK search palette hooks](sdk-search-palette.md). Native desktop transparency remains out of scope.

## Commands

Run from the repository root with Docker running:

```sh
pnpm i
pnpm storybook:visual:check
pnpm storybook:visual:update
pnpm storybook:visual:test
pnpm storybook:visual:shard --shard-index 2 --shard-count 4
pnpm storybook:visual:probes
pnpm storybook:visual:unit
```

`check` builds both catalogs in a disposable Linux container and compares them with `storybook/baselines`. It mounts the checkout and approved images read-only. Current images, differences, environment details, and `index.html` go to ignored `artifacts/storybook-visual`. The legacy `check`, `update`, and full `test` commands replace that directory. Do not run those three commands concurrently, or update baselines while a check, shard, or probe is running.

`update` uses the same capture path but writes only the images selected by `storybook/visual-manifest.json`. It validates all selected captures before writing any of them. It lists obsolete PNGs without deleting them. Review and remove obsolete images explicitly, then run `check`. Never update screenshots just to silence a failure.

`test` checks every declared baseline, then compares each initial `current.png` with one fresh capture in a new browser context. This is two full-matrix passes, not three. Missing initial artifacts fail rather than triggering replacement captures.

`shard --shard-index 2 --shard-count 4` runs the second of four deterministic partitions. Indices are one-based positive integers, must not exceed the count, and counts cannot exceed the manifest size. Unknown, repeated, missing, or malformed flags fail explicitly. Identities are sorted lexically and assigned round-robin. Every assigned identity receives its baseline comparison and one independent repeatability capture. Shards do not run regression probes. Partition membership can change when the manifest grows; reproduce with the same revision, manifest, index, and count.

`probes` runs terminal readiness, cursor stability, readiness/diagnostic checks, capture stability, and bounded runner fault probes once, without either full-matrix pass. It uses the complete manifest to find the existing protected representatives. Both partial commands validate the entire manifest, built story catalogs, and baseline inventory before selecting anything.

Every shard or standalone probe invocation creates a unique directory under `artifacts/storybook-visual-runs/`, printed at startup. Shard directory names include the index and count. These runs can execute concurrently without overwriting each other or the full command's report. Each still builds both catalogs inside its own pinned container and uses read-only approved baselines. Host `VISUAL_*` selection/path overrides are not a public API; use the flags above.

All modes write `evidence.json` alongside the existing reports. It records the Git revision and dirty-checkout flag, SHA-256 of the exact manifest bytes, complete expected identities, assigned identities and shard index/count, pinned image and actual browser environment, expected phases, and each attempted phase's outcome and successfully completed case identities. Failed validation or setup leaves incomplete fields rather than claiming completion. A partial report is not full validation; run `pnpm storybook:visual:test` for every case and every probe.

Runner regression probes use exactly two identities: `pages/application-shell--expanded--openforge-light--1280x800` and `components/components-button--primary--openforge-light--480x240`. Missing or duplicate representatives fail explicitly. The probes run the real command against a disposable manifest and matching baseline inventory. They test button-color failure, update evidence, unexpected diagnostics, missing/obsolete/unexpected baselines, duplicate identities, and restoration. Adding unrelated stories does not grow these probes or narrow the normal full-matrix check.

The deliberate button-color failure saves its before/current/difference report at `artifacts/storybook-visual/self-test/intentional-change/index.html`. Only disposable container build output and probe baselines are changed. Internal probe overrides require the complete restricted input set; they are not a public story filter.

Targeted regressions run separately from the two full-matrix passes. They preserve eight fresh, exact raster samples for each modal, Task Detail Backlog, and Task Detail Narrow case, plus timer freezing, inline and image-mask SVG motion, delayed terminal focus, feedback visibility, terminal readiness, cursor stability, and exact diagnostics. These additional samples appear under the `capture-stability` timing phase.

`unit` tests manifest validation, missing stories, duplicate identities, missing/obsolete/unexpected baselines, pixel comparison, report escaping, SVG-mask freezing, repeatability evidence, probe inputs and restoration, and timing output without Docker.

A failed pixel comparison between repeated captures retains `first.png`, `second.png`, and `difference.png` under `artifacts/storybook-visual/self-test/repeated/<identity>/`. The accompanying `index.html` and `results.json` identify the story, theme, viewport, and changed-pixel count. These are the two repeated samples, not a comparison against the approved baseline.

For native interactive development use `pnpm storybook:pages` or `pnpm storybook:components`. Native screenshots are not canonical baselines.

The visual unit command also exercises native media capture in local Chromium. Install it with `pnpm exec playwright install chromium` after dependency upgrades. These tests compare repeated captures within one environment; they do not approve repository baselines.

## Approving a change

1. Run `check` and open `artifacts/storybook-visual/index.html` in a browser.
2. Inspect the baseline, current, and difference images at full size. Resolve unexpected errors or missing readiness before approving pixels.
3. For an intentional change, run `update`, inspect the Git image diff, then run `check` again.
4. Commit the selected PNGs together with the story or UI change. Generated comparison artifacts stay out of Git.

CI runs four case shards and one regression-probe job in the same pinned ARM Linux environment. The `smoke` aggregate gate accepts only complete, compatible evidence from every job. Download `storybook-visual-review` and open `storybook-visual-aggregate/summary.md` first. Individual reports are under `storybook-visual-input/shard-N/index.html` and `storybook-visual-input/probes/index.html`; the separately uploaded `storybook-visual-shard-N` and `storybook-visual-probes` artifacts retain the same report content when aggregation cannot download another job's artifact. Reports are retained for 14 days. See [CI parallelization evidence](ci-parallelization.md) for the compatibility map, baseline measurements, and timing protocol.
## Timing evidence

Each command writes `timings.json` beside `results.json`. Child probes write their own timing files in `self-test/<probe>/`. Phase-start and phase-completion logs show progress; the final summary lists at most five slowest captures.

The JSON contains `status`, total wall-clock `elapsedMs`, `captures` with attempted/completed/failed counts, and `records`. Each record has `phase`, `status`, and `elapsedMs`; capture records also have `id` and `capture: true`, and child-probe records have the probe `id`. Elapsed time uses a monotonic clock, not the frozen story date.

Parent totals include child invocation time, but parent capture counts exclude child captures. Phase durations include their nested work; do not add them together to calculate total duration. A passed run can contain failed capture records from expected missing-readiness and withheld-paint tests. The enclosing regression phase must pass its rejection assertion.

Handled failures retain timing evidence for work already attempted. Invalid environment/input overrides are rejected before filesystem writes, and hard process termination cannot guarantee a final timing file. Rendering, tolerances, and existing report formats are unchanged.

## Snapshot selection and coverage inventory

`storybook/visual-coverage-inventory.json` records all 502 identities from revision `f4b94552f7f8e51dd2eadc7a439189bc05b2cb06`. Each entry states its visual risk and why it remains, which retained screenshot replaces it, or which upstream change removed it. The inventory test reconciles retained and replacement identities to the current manifest, confirms that replaced isolated stories still exist, and protects runner representatives and documented regressions. The `before` and `after` fields retain KVG-5141/KVG-5142 timing history; `pageSlice` records the later KVG-5143 comparison.

Use these rules when curating later component and page families:

- Keep a separate case for a distinct responsive layout, overflow condition, interaction state, renderer, or documented regression.
- Replace repeated business states only when a readable gallery covers appearance and a rendered test covers label, icon, badge, and action mapping.
- Capture shared galleries in light and dark. Extra state cases may use one theme only when theme rendering is not a distinct risk.
- Keep isolated development stories after moving their canonical screenshot coverage into a gallery.
- Keep runner representatives and named regression cases until a reviewed case or probe provides equivalent protection.
- Review replacement images first, then delete approved obsolete PNGs explicitly. Never regenerate baselines to hide a failure.

### KVG-5141 task-list slice

The task-list family moved from 52 isolated captures to six gallery captures plus six retained interaction and layout captures. The three galleries cover agent workflow, normal pull request progress, and pull request attention states in both themes. Selected, dependency, and long-content cases remain isolated in both themes. The keyboard-selection story and every other original story remain in the development catalog.

All six gallery PNGs were inspected at full size. Their headings, state keys, badges, actions, titles, PR chips, and reason rows are visible without clipping in both themes. The 46 mapped isolated status PNGs were then removed explicitly. The canonical runner reported no missing, obsolete, or unexpected baselines.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Manifest cases | 502 | 462 | -40 (-8.0%) |
| Task-list cases | 52 | 12 | -40 (-76.9%) |
| Canonical capture attempts | 1,074 | 994 | -80 |
| Baseline phase | 712,631 ms | 439,356 ms | -273,275 ms (-38.3%) |
| Repeatability phase | 480,984 ms | 439,848 ms | -41,136 ms (-8.6%) |
| Total canonical run | 1,306,672 ms | 994,574 ms | -312,098 ms (-23.9%) |

Both full runs passed on the same Apple M5 MacBook Air with 10 cores and 32 GiB RAM, Docker arm64, the pinned Playwright 1.62.1 Noble image, and Chromium 151.0.7922.34. The before run used the revision above. The after run used its KVG-5141 working tree. The total reduction is measured, but normal run-to-run variance means it cannot be attributed only to the 40 removed cases.

KVG-5141 intentionally stopped at the task-list family. Its manifest remained above the parent change's 200 to 250 case target because shared-component and page curation belonged to later tickets for tasks 2.3 and 3.1.

### KVG-5143 page slice

This slice removes 24 reviewed page images, with no new gallery or image. The original 502-case inventory still accounts for every identity. `storybook/visual-coverage-inventory.json` maps each page removal to an exact retained appearance, the still-present development story, and a behavioral assertion where state mapping matters. `pageSlice.retainedFamilies` records the current selection decision for every retained page family, superseding the earlier tranche's generic per-entry rationale. `pageSlice.review.obsoleteBaselines` names every approved deletion; no baseline was added or regenerated. The full runner found no missing, obsolete, or unexpected PNGs.

Attention Overview and Focus Board keep both-theme populated pages and a light example of each distinct empty, loading, failure, long, narrow, and interaction layout. Self Review keeps both-theme populated diffs at 1280px, both-theme feedback visibility, the 900px comments layout, light empty/loading/error and long-content pages, and the 1600px wide layout. The removed dark duplicates use those retained pages plus shared component state coverage. Task Creation's blank prompt and defaults-loading button rely on its retained dialog, the prompt and button component images, and the loading story's disabled-action assertion. The 900px Application Shell remains in light; the dark expanded shell preserves dark navigation treatment. All isolated stories remain in the catalog.

Keep page-level state images only when they establish page-specific placement. For example, the Attention dialog owns its error/retry layout, the board failure puts a toast beside an empty inspector, and Self Review positions the failed diff beside its changed-files panel. Settings loading retains its documented rounded-border raster allowances; terminal and media renderers, focused palettes, overlays, page overflow, task-detail readiness probes, and both-theme feedback stability remain selected. Do not replace these with a generic spinner or empty-state component merely to lower the count. For new cases, identify the particular layout/interaction or renderer risk, check existing component and page screenshots first, and document any removed identity with the exact retained screenshot and behavior assertion before deleting its PNG.

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Page cases | 238 | 214 | -24 |
| Total cases | 443 | 419 | -24 |
| Canonical capture attempts | 956 | 908 | -48 |
| Baseline phase | 658,574 ms | 528,685 ms | -129,889 ms |
| Repeatability phase | 689,645 ms | 496,072 ms | -193,573 ms |
| Total canonical run | 1,507,089 ms | 1,146,367 ms | -360,722 ms |

Both complete runs passed on the same Apple M5 MacBook Air (10 cores, 32 GiB), Docker arm64, pinned Playwright 1.62.1 Noble image, and Chromium 151.0.7922.34. The before revision was `855d845547eaeb8e7625599b15d1a308883ba70a`; the after run used this KVG-5143 working tree. The measured total was 23.9% shorter. Capture count fell by exactly two per removed case; the time difference is observed, not a per-case prediction. Phase durations include nested work and should not be summed. Three intentional fault-probe capture failures occurred in each successful run.

The parent goal of roughly 200–250 cases is not reachable in this page-only slice without dropping distinct coverage. The manifest still has 205 component cases, leaving room for only 45 page cases at a 250-case total, across more than 20 page families. The 214 retained page cases include narrow and overflow views, media formats, terminal states, focused dialogs, plugin settings, feedback overlays, and named raster probes. Reaching 250 from here would require removing another 169 cases. None of those removals was approved as redundant by this review.

Validation caveat: the optional `RUN_STORYBOOK_CREATION=1` same-document suite failed twice in the unchanged `components-prompt-input--cancel` story after its page-creation pass. KVG-5222 tracks that independent story interaction. The full canonical visual run, root tests with three workers, and focused page browser checks passed; no capture readiness or tolerance was loosened.

## Manifest contract

Each entry declares `catalog`, stable Storybook `story` ID, `theme`, integer `viewport.width` and `viewport.height`, a visible Playwright `ready` selector, and `expectedErrors`. Catalogs are limited to `pages` and `components`. Accepted theme IDs are `openforge-light` and `openforge-dark`; Workshop themes are intentionally excluded from canonical screenshot testing. Unknown fields and theme IDs fail rather than being ignored.

Images are named `<catalog>/<story>--<theme>--<width>x<height>.png`. Renaming an identity makes the old PNG obsolete; removing a story from the built index fails with that story's identity. Missing images never become approvals during `check`. Unexpected files in the baseline directories fail both modes.

Readiness must identify the intended final state, not just a generic root element or spinner. Interactive cases must choose a selector that proves their interaction has finished, such as the host context menu's visible menu. Deliberately failed cases must list complete console/page-error messages in `expectedErrors`, including multiplicity. Missing expected messages fail too. No substring allowlist is used.

Comparison is exact by default. Per-entry rasterization allowances require measured evidence and a reason, ordinarily capped at 36 changed pixels and two channel levels. Selected board, shell, review, and component cases declare measured antialiasing allowances in the manifest. Reports retain raw counts and difference images, including accepted noise. Loading remains exact: animation is frozen, never masked by a tolerance. Main's separate navigation allowance permits up to three channel levels only when at most two pixels change, for the measured dark File quick-open / Unavailable input-corner noise (KVG-4816). Larger pixel counts cannot use three levels. Navigation palette controls and Project switching / Empty remain exact; SVG motion is frozen rather than tolerated. All cases without an explicit allowance use exact comparison.

See the [KVG-4816 focused-input investigation](storybook-focused-input-investigation.md) for capture experiments, verification results, and the limits of the existing two-pixel allowance.

Captures use a 30-second default operation/navigation deadline. Failure probes can still request shorter deadlines. Each bounded child probe has a two-minute deadline independent of catalog growth.

## Terminal readiness evidence

Terminal stories record a bounded `data-terminal-progress` history on the canvas. It identifies the tab being opened, font wait, replay state, presentation drain, text assertion, scrollbar hover, and paint boundary. Text checks include the drain's parse/render evidence and a short buffer tail. Timestamps use `performance.now()`, not the frozen application date.

Readiness failures append that history, the selected tab, tab count, font status, and document visibility to the error in `results.json`. Evidence collection has its own one-second limit so an unresponsive page cannot prevent context teardown. A missing evidence response is reported explicitly, without replacing the original timeout.

`pnpm storybook:visual:test` also repeats both terminal overflow captures three times at normal and 4× Chromium CPU throttling, compares the approved images without new allowances, and checks that all 12 tabs were opened. A withheld-paint probe must fail at `drain` and close its browser context. Its report is `artifacts/storybook-visual/self-test/terminal-readiness/results.json`. Story switching, cursor/scrollbar stability, and same-document teardown remain covered by `pnpm storybook:terminal:check`.

### KVG-4819 investigation

The historical failure used a 15-second capture deadline. Commit `d1106014` had already raised the default to 30 seconds before this investigation; this change leaves that deadline and the story's 10-second replay wait unchanged.

Using the pinned Linux image and the historical 15-second deadline:

- 48 captures passed with normal, 4×, and 12× Chromium CPU throttling.
- 24 captures passed with the whole container limited to 0.5 CPU.
- At an extreme 0.1 CPU quota, tab-overflow timed out in five of six captures. Available evidence showed the tab interaction still advancing or presentation drain starting near the deadline. One page could not respond within the evidence-collection limit.
- Runtime-overflow passed all six 0.1-CPU captures. No persistent presentation-drain deadlock or runtime-overflow timeout was reproduced.

With the existing 30-second per-operation deadline, all 12 captures passed at the same 0.1-CPU quota. The deadline is not a 30-second limit for the whole capture. The investigation reports are under `artifacts/storybook-visual/self-test/terminal-readiness/investigation/`.

The native Terminal lifecycle check passed all 12 page and 14 component stories twice. The extra Linux run failed at the existing selection/copy assertion with an empty clipboard, after page-story teardown checks passed. Task KVG-4830 covers that platform-specific test gap; the copy assertion was not removed.

These observations establish load sensitivity, not a runtime deadlock. Hidden tabs also remained marked visible by the runtime and incurred extra drain work; follow-up Task KVG-4825 covers that separate visibility/ownership issue. No runtime behavior, screenshot tolerance, or readiness check has been relaxed.

### Modal CI follow-up

After rebasing, visual CI passed all 148 initial comparisons but failed the repeated `sdk-overlays--modal` capture. Local Linux probes reproduced seven Save-button corner pixels changing by one RGB level. Geometry, computed styles, and input focus were identical between the two outcomes. The control failed 28 of 78 adjacent comparisons across 80 captures at normal and 4× CPU throttling. Extra paint frames, warm-up screenshots, forced focus, single-thread rasterization, and disabled Skia runtime optimizations did not remove the variation.

The primary button painted its rounded edge twice: an opaque accent border over the same accent background, at a fractional vertical position. Keeping the existing transparent border geometry and letting the background paint the edge produced 24 identical trial captures. The approved fix retains button dimensions, theme colors, hover/pressed feedback, and keyboard focus treatment. Browser tests also check that forced-colors mode still draws visible button edges.

Affected baselines are regenerated for the intentional change in primary-button edge painting. Both SDK modal cases now use exact comparison instead of their previous raster allowances. The button fix introduces no capture delay, raster flag, or wider tolerance.

### Task Detail cursor and SDK tab follow-up

The next full check exposed two separate failures. Task Detail Active differed by one 8×23 cursor cell in Workshop light and dark. Its desktop replay omitted the steady-cursor ANSI commands already used by local terminal stories. The replay now supplies those commands, without changing production cursor defaults. Parser tests cover seven replay scenarios. A rendered regression failed by 184 pixels before the fix and passed in all four active-story themes afterward. The self-test samples the terminal screen across two 650ms intervals, strictly comparing pixels to expose xterm's 600ms blink cycle; these waits test ongoing stability, not readiness.

The SDK horizontal tab-list failure was eleven one-level pixels on its outer rounded edge, against the existing four-pixel allowance. After rebasing onto main's settled-screenshot and full-raster capture fixes, 48 captures matched the unchanged baseline exactly: 24 each with and without partial raster, split between normal and 4× CPU throttling. No Tabs styling, baseline, or allowance change was needed. KVG-4850 and KVG-4851 were folded into this PR at the owner's request.

## Canonical environment

`scripts/storybook-visual/container.mjs` pins the Playwright 1.62.1 Ubuntu Noble image by its Linux arm64 digest. Local Docker and CI's `ubuntu-24.04-arm` runner use that same architecture. Apple Silicon runs it natively; Intel developers need Docker ARM emulation or an ARM Docker host. We do not maintain separate architecture baselines. The frozen workspace lockfile selects Playwright and bundled production fonts. Both catalog builds and browser captures happen inside that container; host `node_modules` is excluded.

Capture fixes Chromium, device scale 1, en-US locale, UTC timezone, application time at `2026-01-02T09:30:00.000Z`, theme/color scheme, reduced motion, disabled CSS animations/transitions, hidden caret, and loaded fonts. Animation-only `will-change` layer hints are disabled to avoid compositing noise. Inline SVG timelines are paused at one second; SVG image masks are flattened at their production animation's middle keyframe so loaders remain visible. External browser requests are blocked. Each case gets a fresh browser context. Comparison includes antialiasing pixels with zero threshold.

Chromium partial raster is disabled. Reusing partially repainted tiles can produce different rounded-border pixels across otherwise identical contexts, even after each capture has settled. Full raster preserves the UI; resulting raster differences require baseline review, not broader comparison tolerances.

The runner waits for the pinned Storybook preview's interaction phase to finish and the declared readiness selector, then pauses runtime timers before waiting for fonts and paint. Timers remain live during interactions; afterward, controlled 32-millisecond steps let canvas writes settle without letting transient success messages expire during slow captures. Terminal input is blurred, then its deferred repaint is flushed before comparing images. A terminal that regains focus is not accepted; other controls retain focus. Consecutive identical frames are required. Interaction errors and unsettled output fail rather than producing a baseline.

After readiness and motion suppression, capture requires two consecutive screenshots with identical decoded pixels, separated by a browser paint boundary. This avoids transient raster paints and duplicate reads of the same frame even when the DOM is ready. Capture fails if pixels do not settle within the capture timeout. This check does not consult the baseline or apply a tolerance; persistent visual changes still fail baseline comparison.

For native video controls, capture waits for a decoded frame or a real media error and requires the story to leave playback paused. In both cases, the native buffering panel must finish before capture freezes animations in Chromium's nested control shadow roots through CDP. It does not replace players, remove controls, synthesize errors, or broaden pixel tolerances. Those changes live only in the disposable capture context.

When upgrading Playwright, update the lockfile and image digest together, regenerate the selected baselines in the container, and review them. `environment.json` in each report records the image and actual Chromium version. The first run downloads the container and installs dependencies, so it needs network access and may take several minutes.

Chromium runs with `--disable-partial-raster`. In pinned Linux probes, partial rasterization varied 5–17 rounded-corner pixels by up to three channel levels across unchanged Task Detail Backlog/Narrow captures, and seven SDK Modal pixels by one level. Disabling partial rasterization made all eight captures of each case identical; single-raster-thread and compositor-scheduling variants did not remove the drift. The self-test repeats these story families eight times with exact comparison, ignoring their existing allowances. No comparison tolerance was widened.
