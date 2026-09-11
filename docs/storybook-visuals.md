# Review screenshot changes

The manifest includes foundation, task workspace, host chrome, Plugin SDK, terminal, and navigation/search cases. See [task workspaces](storybook-task-workspaces.md), [host chrome and feedback](storybook-host-chrome.md), [SDK composite layouts](storybook-sdk-composites.md), and [navigation workflows](storybook-navigation.md) for their adopted states and interaction checks. It does not enforce coverage of the remaining Storybook catalog.

For Task Creation, prompt editing, Project Setup, and branch-divergence dialogs, see [the creation/setup catalog](storybook-creation-setup.md).

## Built-in themes

OpenForge Light and OpenForge Dark use the Studio design: neutral surfaces, rounded controls, and restrained shadows. They retain their names and `openforge-light` / `openforge-dark` identifiers, so saved selections and legacy light/dark preferences receive the redesign without migration. The default and unavailable-theme fallback remain OpenForge Light.

Workshop Light and Workshop Dark are additional choices with warm paper or graphite surfaces, amber actions, and crisp corners. They remain available for interactive Storybook review but are not part of the canonical screenshot matrix. There are no separate Studio choices or accepted `studio-light` / `studio-dark` capture IDs. Theme selection does not override the user's terminal font.

Glass and in-app frosted layers remain deferred. No native transparency or backdrop blur is included.

## Commands

Run from the repository root with Docker running:

```sh
pnpm i
pnpm storybook:visual:check
pnpm storybook:visual:update
pnpm storybook:visual:test
pnpm storybook:visual:unit
```

`check` builds both catalogs in a disposable Linux container and compares them with `storybook/baselines`. It mounts the checkout and approved images read-only. Current images, differences, environment details, and `index.html` go to ignored `artifacts/storybook-visual`. Each run replaces the previous artifacts. Do not run these commands concurrently.

`update` uses the same capture path but writes only the images selected by `storybook/visual-manifest.json`. It validates all selected captures before writing any of them. It lists obsolete PNGs without deleting them. Review and remove obsolete images explicitly, then run `check`. Never update screenshots just to silence a failure.

`test` checks every declared baseline, then compares each initial `current.png` with one fresh capture in a new browser context. This is two full-matrix passes, not three. Missing initial artifacts fail rather than triggering replacement captures.

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

CI runs the same Linux command on affected UI pull requests and main-branch pushes. Download `storybook-visual-review` from the workflow run, extract it, and open `index.html`. The artifact includes the deliberate regression probe report even on success and is retained for 14 days.

## Timing evidence

Each command writes `timings.json` beside `results.json`. Child probes write their own timing files in `self-test/<probe>/`. Phase-start and phase-completion logs show progress; the final summary lists at most five slowest captures.

The JSON contains `status`, total wall-clock `elapsedMs`, `captures` with attempted/completed/failed counts, and `records`. Each record has `phase`, `status`, and `elapsedMs`; capture records also have `id` and `capture: true`, and child-probe records have the probe `id`. Elapsed time uses a monotonic clock, not the frozen story date.

Parent totals include child invocation time, but parent capture counts exclude child captures. Phase durations include their nested work; do not add them together to calculate total duration. A passed run can contain failed capture records from expected missing-readiness and withheld-paint tests. The enclosing regression phase must pass its rejection assertion.

Handled failures retain timing evidence for work already attempted. Invalid environment/input overrides are rejected before filesystem writes, and hard process termination cannot guarantee a final timing file. Rendering, tolerances, and existing report formats are unchanged.

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
