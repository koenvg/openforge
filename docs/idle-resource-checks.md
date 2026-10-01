# Idle resource checks

Use the idle check after launching a fresh development or packaged build. Wait for active Agent Sessions to become quiet. Leave the app focused and do not type, switch views, resize the window, or start work during the sample. A fresh launch matters because `vmmap` reports the lifetime peak.

```bash
pnpm performance:idle
```

The default 30-second check fails when any of these limits are exceeded:

- OpenForge core processes average more than 0.35 CPU cores in total.
- The Rust Sidecar event stream exceeds 20 envelopes per second.
- The Rust Sidecar lifetime peak physical footprint exceeds 1,024 MiB.

Pass a specific Sidecar PID when more than one build is running:

```bash
pnpm performance:idle -- --sidecar-pid 12345
```

Use a longer sample or override limits when characterizing a change:

```bash
pnpm performance:idle -- \
  --duration 120 \
  --max-average-cores 0.25 \
  --max-event-rate 10 \
  --max-sidecar-peak-mib 768
```

`--no-thresholds` records a baseline without failing. The JSON report includes cumulative CPU-time deltas, average cores, RSS, current and peak `vmmap` footprints, event payload bytes, and the busiest event names. The script reads the local Sidecar token from its process environment but never prints it.

## Wakeups and the Session Daemon

The report also records wakeup evidence. The sampler reads `top` counters before and after the window. Each process has `wakeups` with context switch and idle wakeup deltas and per-second rates. The top-level `wakeups` field has the totals. Wakeups have no threshold.

The Session Daemon is not a child of Electron. The sampler reports it only when you name its root directory, and only when exactly one daemon command references that root. Other daemons, such as the installed app daemon, are never selected. The `sessionDaemon` field has its CPU, RSS, wakeups, and `childCount` (its direct child shells). Daemon CPU is not part of the core `averageCores` total.

```bash
pnpm performance:idle -- --session-daemon-scope "<app-data>/session-daemon"
```

## Idle shells in the invariant harness

`--idle-shells <n>` starts an isolated Session Daemon in the run root. The scenario then spawns `n` extra shells for the seeded task, waits until their CPU counters stop moving, and samples. Other scenarios in the same run also use that daemon. Reuse mode rejects the option. Cleanup stops the owned daemon before the run root is removed.

```bash
pnpm e2e:invariants -- --scenario idle-resources --idle-shells 5 --idle-duration 30
```

The run writes the evidence to `idle.json` in the artifact directory. `idleShells` lists the spawned shell instance IDs.

## KVG-4355 characterization

The original installed build reached a 4.2 GiB Rust Sidecar peak footprint. A 30-second sample captured 9,231 event envelopes, including 5,670 `pty-model-output` and 3,561 `pty-output` envelopes carrying 1.79 MiB in total.

After the KVG-4355 changes, a fresh unseeded development launch passed the default check over 30 seconds:

- 0.200 average CPU cores across Electron main, renderer, GPU, utilities, and the Rust Sidecar
- 1 event envelope, `startup-resume-complete`, or 0.033 events per second
- 13.6 MiB current and 13.7 MiB peak Rust Sidecar physical footprint

The unseeded run isolates idle framework work. Repeat the check with representative local data before release, after active Agent Sessions become quiet.
