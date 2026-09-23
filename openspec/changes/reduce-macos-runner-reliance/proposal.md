## Why

A pull request currently requests eight macOS jobs even though common GitHub plans allow only five concurrent macOS jobs, so queueing is guaranteed before other repositories or pull requests add load. Seven jobs still use the retiring `macos-14` image even though the existing macOS 15 compatibility workflow now proves native packaging, backend checks, and packaged smoke on `macos-15`.

## What Changes

- Move every ARM macOS workflow from `macos-14` to the supported `macos-15` image, including pull-request, packaged-runtime, release, and private mobile-release workflows.
- Add fail-closed change-impact classification so native packaged-session, iOS build, and macOS Ghostty checks run only when their declared inputs can affect the result. Manual runs and scheduled full coverage remain available.
- Split matrix jobs where needed so an unaffected macOS entry does not allocate a runner merely to skip its steps. Preserve the existing check names or explicitly migrate required checks before rollout.
- Move terminal and Markdown browser visual conformance to a pinned ARM64 Linux environment with reviewed Linux baselines that Apple Silicon developers can update and verify locally. Keep its native PTY assertion covered by the macOS Rust suite instead of running the same Rust test again inside the visual job.
- Retain broad ARM packaged-app smoke and live Electron terminal invariants on macOS for every pull request.
- Record before-and-after queue time, workflow wall time, macOS job count, and macOS runner time without presenting skipped jobs as executed coverage.

## Capabilities

### New Capabilities

- `ci-runner-allocation`: Supported runner selection, bounded routine macOS demand, fail-closed affected-area selection, periodic native coverage, and cross-platform terminal visual execution.

### Modified Capabilities

None. Existing desktop invariant requirements remain unchanged because live terminal invariants continue to run on every pull request.

## Impact

The change affects GitHub Actions workflows for general CI, packaged session runtime, releases, and mobile releases; workflow contract tests; change-impact classification; terminal and Markdown visual commands and baselines; and CI operator documentation. It does not change product behavior, release architectures, test assertions, visual tolerances, branch-protection policy without owner approval, or the requirement to run live Electron terminal invariants on pull requests.
