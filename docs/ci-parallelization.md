# CI parallelization evidence

## Compatibility map

The workflow and aggregate jobs preserve the status and artifact interfaces consumed outside the workflow.

| Existing interface | Parallel implementation | Compatibility rule |
| --- | --- | --- |
| CI job `frontend` / display name `Frontend Tests` | Static checks plus three Vitest shards feed the same `frontend` aggregate | The aggregate fails unless every job and result file succeeds. |
| `frontend-results` | Produced by the `frontend` aggregate | Existing result filenames remain unchanged. |
| `frontend-logs` | Produced by the `frontend` aggregate | Shard logs are merged with explicit shard headings. |
| Storybook workflow job `smoke` | Four case shards and one probe job feed the same `smoke` gate | The job id remains `smoke`; missing, cancelled, failed, duplicate, or incompatible evidence fails it. |
| `storybook-visual-review` | Produced by the `smoke` aggregate | It contains every isolated report and the aggregate summary. |

The GitHub branch-protection API returned `404 Branch not protected` for `main` when inspected before rollout, so there is no configured required-check list to migrate. The workflow and gate ids are nevertheless retained. Any future branch-protection change requires owner approval; this work does not modify repository policy.

## Serial visual baseline

These successful serial runs used the `ubuntu-24.04-arm` runner and the old single `smoke` job. Each selected all 455 identities present at its revision for baseline and repeatability capture, then ran all five regression phases. Runner minutes are the smoke job duration, not the workflow wall time.

| Run | Revision | Queue | Setup before canonical command | Canonical command | Workflow wall time | Runner minutes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| [35579121441](https://github.com/koenvg/openforge/actions/runs/35579121441) | `d4a34580cdff451e8e8188597cabd3bf5d101f97` | 38 s | 77 s | 1,543 s | 1,665 s | 27.1 |
| [35578659103](https://github.com/koenvg/openforge/actions/runs/35578659103) | `ec534f4b202107971864b0353884a436c0dfe51d` | 5 s | 70 s | 1,555 s | 1,637 s | 27.2 |
| [35574904838](https://github.com/koenvg/openforge/actions/runs/35574904838) | `4a4f12372d52a9c137febae68df752a69bb7a258` | 4 s | 76 s | 1,584 s | 1,671 s | 27.8 |

Queue is workflow creation to job start. Setup is job start to the canonical visual-command step. Workflow wall time is workflow creation to completion. The GitHub job timestamps are second-resolution, so totals can differ by a second from the displayed UI duration.

## Parallel reports and reproduction

CI starts four ARM Linux case shards and one ARM Linux regression-probe job. Every case shard builds both catalogs, validates the global manifest/catalog/baseline inventory, and captures both samples for its assigned identities. The probe job runs the visual unit suite and the five regression phases once.

Download these artifacts for a failing run:

- `storybook-visual-shard-N`: `index.html`, `results.json`, `timings.json`, `environment.json`, `evidence.json`, and case images for shard `N`.
- `storybook-visual-probes`: the same top-level report files plus targeted probe reports under `self-test/`.
- `storybook-visual-review`: all downloaded shard/probe reports under `storybook-visual-input/` and the gate diagnostics under `storybook-visual-aggregate/summary.md` and `summary.json`.

Reproduce shard 2 of the four-shard matrix locally with:

```sh
pnpm storybook:visual:shard --shard-index 2 --shard-count 4
```

The command prints its unique report directory under `artifacts/storybook-visual-runs/`. Use the revision, manifest digest, image, browser, index, and count in `evidence.json` when comparing with CI. Run all probes with `pnpm storybook:visual:probes`. The unchanged complete local gate remains `pnpm storybook:visual:test`.

## Parallel timing protocol

Use at least three successful runs on equivalent revisions and runner classes. Record workflow queue time, setup time in each shard, each shard's canonical-command duration, probe duration, aggregate duration, workflow wall time, and summed job minutes. Compare coverage by manifest identity and completed baseline/repeatability pairs, not by a hard-coded case count. Keep four shards only while repeated wall-time savings exceed added queue/setup overhead; runner minutes are reported as a tradeoff rather than presented as savings.
