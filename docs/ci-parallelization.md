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

## Four-shard trial results

Three `workflow_dispatch` runs used revision `8fb4c31e3a5063b21d8886c3226d83eee9ed797d`, the same 455-identity manifest, and `ubuntu-24.04-arm` for every capture job. All three aggregate gates passed with 455 complete case pairs, all five probes, one manifest digest, and the pinned Linux arm64 environment. Shards 1–3 each covered 114 identities and shard 4 covered 113.

| Run | Capture-job queue | Shard setup range | Shard command durations (1/2/3/4) | Probe job | Aggregate delay / job | Workflow wall | Actual runner minutes | Rounded job minutes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [35591099750](https://github.com/koenvg/openforge/actions/runs/35591099750) | 6 s | 13–21 s | 388 / 397 / 403 / 420 s | 326 s | 16 / 25 s | 489 s | 34.1 | 37 |
| [35592160955](https://github.com/koenvg/openforge/actions/runs/35592160955) | 6–34 s | 16–21 s | 390 / 386 / 427 / 411 s | 338 s | 127 / 23 s | 609 s | 34.4 | 37 |
| [35593122254](https://github.com/koenvg/openforge/actions/runs/35593122254) | 73–311 s | 14–19 s | 383 / 389 / 403 / 400 s | 325 s | 5 / 16 s | 738 s | 33.4 | 37 |

Capture-job queue is workflow creation to each shard/probe start. Shard setup is job start to the canonical shard command. Aggregate delay is the gap from the last prerequisite completion to aggregate job start. Actual runner minutes sum job wall time; rounded job minutes sum each job rounded up to a minute.

The serial baseline took 1,637–1,671 seconds and 27.1–27.8 runner minutes for the equivalent 455-identity selection. Four shards reduced measured wall time by 55–70% even when queue pressure delayed runners, at the cost of 20–27% more actual runner time. The slowest shard command varied by only 20–41 seconds from the fastest in each run, so assignment balance is acceptable. Keep four shards; setup is small relative to capture and contention did not erase the wall-time gain.

For an intentional incomplete-path trial, the successful first run's downloaded inputs were copied without `shard-3` and passed to the real aggregate CLI with successful job metadata. It exited 1, reported `missing shard 3/4 evidence`, retained all five successful probe outcomes, and reported only 341 of 455 complete case pairs. Unit coverage also exercises failed, cancelled, skipped, malformed, duplicate, mixed-revision, mixed-manifest, incompatible-environment, and failed-probe evidence.
