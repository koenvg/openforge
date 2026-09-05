# Review screenshot changes

The smoke manifest selects the populated Focus Board page and the Plugin SDK primary Button. It does not enforce coverage of the remaining Storybook catalog.

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

`test` first checks the committed baselines, then proves repeated capture of both cases is unchanged. It changes a button's color in disposable container build output, requires the real check command to fail, and saves its before/current/difference report at `artifacts/storybook-visual/self-test/intentional-change/index.html`. It also probes update evidence, missing readiness, unexpected console errors with preserved screenshots, exact declared failures, and restoration. `unit` tests manifest validation, missing stories, duplicate identities, missing/obsolete/unexpected baselines, pixel comparison, and report escaping without Docker.

For native interactive development use `pnpm storybook:pages` or `pnpm storybook:components`. Native screenshots are not canonical baselines.

## Approving a change

1. Run `check` and open `artifacts/storybook-visual/index.html` in a browser.
2. Inspect the baseline, current, and difference images at full size. Resolve unexpected errors or missing readiness before approving pixels.
3. For an intentional change, run `update`, inspect the Git image diff, then run `check` again.
4. Commit the selected PNGs together with the story or UI change. Generated comparison artifacts stay out of Git.

CI runs the same Linux command on affected UI pull requests and main-branch pushes. Download `storybook-visual-review` from the workflow run, extract it, and open `index.html`. The artifact includes the deliberate regression probe report even on success and is retained for 14 days.

## Manifest contract

Each entry declares `catalog`, stable Storybook `story` ID, `theme`, integer `viewport.width` and `viewport.height`, a visible Playwright `ready` selector, and `expectedErrors`. Only `pages` and `components`, and `openforge-light` and `openforge-dark`, are allowed. Unknown fields fail rather than being ignored.

Images are named `<catalog>/<story>--<theme>--<width>x<height>.png`. Renaming an identity makes the old PNG obsolete; removing a story from the built index fails with that story's identity. Missing images never become approvals during `check`. Unexpected files in the baseline directories fail both modes.

Readiness must identify the intended final state, not just a generic root element or spinner. The selected smoke stories have no asynchronous play interactions. New interactive cases must choose a selector that proves their interaction has finished. Deliberately failed cases must list complete console/page-error messages in `expectedErrors`, including multiplicity. Missing expected messages fail too. No substring allowlist is used.

Comparison is exact by default. The Focus Board alone declares a measured rasterization allowance: at most 20 changed pixels, with no channel differing by more than one level. Repeated Linux Chromium captures varied 19 antialiased border pixels, even with GPU disabled. The manifest requires a reason and rejects broader allowances. Reports retain raw pixel counts and difference images, including accepted noise. The component has no allowance.

## Canonical environment

`scripts/storybook-visual/container.mjs` pins the Playwright 1.62.1 Ubuntu Noble image by its Linux arm64 digest. Local Docker and CI's `ubuntu-24.04-arm` runner use that same architecture. Apple Silicon runs it natively; Intel developers need Docker ARM emulation or an ARM Docker host. We do not maintain separate architecture baselines. The frozen workspace lockfile selects Playwright and bundled production fonts. Both catalog builds and browser captures happen inside that container; host `node_modules` is excluded.

Capture fixes Chromium, device scale 1, en-US locale, UTC timezone, application time at `2026-01-02T09:30:00.000Z`, theme/color scheme, reduced motion, disabled CSS animations/transitions, hidden caret, and loaded fonts. External browser requests are blocked. Each case gets a fresh browser context. Comparison includes antialiasing pixels with zero threshold.

When upgrading Playwright, update the lockfile and image digest together, regenerate both baselines in the container, and review them. `environment.json` in each report records the image and actual Chromium version. The first run downloads the container and installs dependencies, so it needs network access and may take several minutes.
