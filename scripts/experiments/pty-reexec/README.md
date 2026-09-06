# macOS live PTY host replacement experiment

KVG-4714, a bounded part of KVG-4532 and the [preserve-sessions-across-updates feasibility gate](../../../openspec/changes/preserve-sessions-across-updates/design.md). This is not a Session Daemon or production PTY extraction.

## Run

Requires macOS, Xcode Command Line Tools and Python 3.9 or newer. No Python packages are needed. From the repository root:

```sh
# Expected exit 1: the compiled negative-control host deliberately stays on v1.
python3 scripts/experiments/pty-reexec/run.py --negative-control --report /tmp/pty-reexec-red.json

# Expected exit 0: all experiment tests, including compilation with warnings as errors.
python3 scripts/experiments/pty-reexec/run.py --report /tmp/pty-reexec-green.json

# Teardown regressions with process/control fault injection and no real signals.
python3 -m unittest discover -s scripts/experiments/pty-reexec -p 'test_*.py' -v

# Repeat the whole affected subsystem, not the desktop app.
for run in 1 2 3; do
  python3 scripts/experiments/pty-reexec/run.py || break
done

# Static checks. Keep generated analyzer output outside the repository.
python3 -m py_compile scripts/experiments/pty-reexec/*.py
for source in host fixture; do
  clang --analyze -std=c11 -Wall -Wextra -Werror \
    scripts/experiments/pty-reexec/$source.c -o /tmp/pty-reexec-$source.plist
done
```

Individual tests can be selected, for example `run.py Continuity.test_exit_status_before_during_after_and_group_termination`. Do not use Python's `-O` option, which disables fixture assertions.

The JSON report records source hashes, compiler and platform, initial and replaced executable paths, kernel process identities, descriptor audits, retained exit statuses and cleanup results. A red report's `passed: false` is intentional. An unexpected error or a teardown failure is not an acceptable negative control.

## Recorded platform evidence

The checked-in [green report](evidence/macos-arm64-green.json) records seven passing live tests on macOS 26.6.2, build 25G83, native arm64, Python 3.9.6 and Apple Clang 21.0.0. All seven cleanup audits found zero survivors. Six used graceful cleanup; the deliberately stopped-host test required emergency cleanup and preserved the expected ABORT timeout. The [negative control](evidence/macos-arm64-red.json) fails only the expected v2 assertion and also leaves zero survivors.

The observed request-to-ready times for the ordinary replacements in that green run were 224 to 657 ms. They include the driver's process observations and are not pure exec latency. The deterministic exit-race barrier is intentionally held longer and excluded from that range.

C compilation with `-std=c11 -Wall -Wextra -Werror -O2`, Clang static analysis of both C files and Python bytecode compilation passed. macOS x64 has not been tested.

The single fresh-context review requested changes to teardown because protocol errors could skip cleanup. That finding is resolved with unconditional ownership-checked cleanup and survivor auditing, preservation of the original error, and retryable failed audits. Seven focused regressions cover ABORT timeout, broken pipes, an exited host with registered survivors, disappearance during signaling, PID reuse and audit retries. All pass. A live SIGSTOP-at-checkpoint test also verifies cleanup when the host cannot answer. The updated live suite passed three consecutive full runs. No second review pass was run.

## What the fixture proves

The confirmed test boundaries are a private host control protocol, real PTY I/O and independent macOS process/descriptor observations.

| Requirement | Observation |
| --- | --- |
| New executable, same sessions | Separately compiled v1 and v2 images. `proc_pidpath` observes v2 at the original host PID. `proc_pidinfo` compares PID, UID, microsecond start identity, parent, group and controlling device for host, shell, agent and tool. Master descriptors, slave paths and master device identity stay unchanged. |
| Interactive state | A clean interactive Bash changes cwd and exports a variable before reexec. A newly launched shell reads both afterward. Kernel input echo and the agent's response are checked separately. Geometry survives and a later resize is observed through `stty size`. |
| Running tool and output | The agent forks and execs a tool which continuously emits numbered lines while the agent accepts input. The complete observed sequence and per-PTY byte cursor have no gaps or duplicates through replacement. This is a bounded, low-rate test, not a saturation benchmark. |
| Descriptor audit | An intentionally inheritable unrelated file must disappear in v2. Independent `PROC_PIDLISTFDS` observations match the exact host allowlist. Agent, tool and a post-reexec child have only 0/1/2. Bash additionally owns descriptor 255; a command launched by Bash has only 0/1/2. |
| Exit before replacement | Exit 21 is collected by v1; the raw wait status survives checkpoint and is still reported by v2. |
| Exit during replacement | After checkpoint, v1 stops at an explicit barrier. The driver releases a known child, and `ps` observes it as a zombie before allowing exec. v2 collects exit 22. This tests the quiesced transition window, not a claim to time an exit inside the atomic exec syscall. |
| Exit afterward | v2 collects exit 23. Tests check both `waitpid` results and eventual absence from `ps`, since macOS `proc_pidinfo` can return no information for a zombie. |
| Explicit termination | The host verifies an unreaped direct child's start identity and process group before signaling that group. The agent reaps its terminated tool, then exits 143. A killed shell reports signal 9. |
| Repeated updates and failed exec | v1 → v2 → v1 → v2 keeps agent input usable. A nonexistent target returns an exec error and leaves v2 serving the same session. Checkpoint cancellation tears down without activating v2. |
| Isolation and teardown | Each test creates a mode-0700 temporary root with its own binaries, HOME, TMPDIR and app-data path. The driver records descendants and start identities. Cleanup verifies that none remain, including zombies. No app binary, database, listener or installation is opened. |

## Retained state and descriptors

The host is single-threaded. Each accepted write finishes before the next command. Reads return bytes immediately with a cursor; there is no userspace terminal parser or queued PTY I/O to serialize. Stdio buffering is disabled. At the barrier, new PTY reads and writes stop, but children can continue writing into kernel buffers.

An unlinked mode-0600 regular file contains a fixed-size native checkpoint. It records the format marker, host PID, retained descriptor numbers, five bounded child slots, child start identities, PTY names, output cursors and already-reaped wait statuses. Both images are compiled together with the same ABI. This format is **not** a cross-architecture or production-compatible state protocol.

Before exec, the host marks every descriptor above 2 close-on-exec unless it is the checkpoint or a PTY master. It uses versioned executable paths and `execl` in the existing process. It does not overwrite an on-disk running binary, create a replacement owner, transfer descriptors or wait for sessions to end.

The descriptor audit's two-session case observed:

| Descriptor | v1 | v2 | Children |
| --- | --- | --- | --- |
| 0/1/2 | Controller pipes and diagnostic log | Retained | Rebound to the child's PTY slave |
| 3 | Unlinked checkpoint | Retained | Closed |
| 4 | Unrelated sentinel file | Closed by exec | Closed |
| 5/6 | Shell and agent PTY masters | Retained | Closed |
| Other masters | Only when exit fixtures are created | Retained if present | Closed |

The numbers are observations, not protocol constants. All child launches close every descriptor above 2 before exec. Bash creates its own descriptor 255 after launch.

## PTY reconstruction approach for slice 2

This proof uses macOS `openpty`, `read`, `write` and `TIOCGWINSZ`/`TIOCSWINSZ` directly in a small C executable. v2 reads the checkpoint and resumes these operations on the inherited masters. It does not call `openpty`, reopen a slave, or recreate a child on the resume path. Parent-child relationships and waitable exits belong to the kernel, not the old executable's heap.

The backend currently declares `portable-pty = "0.9"`. Its public [MasterPty API](https://docs.rs/portable-pty/0.9.0/portable_pty/trait.MasterPty.html) exposes `as_raw_fd`, but does not supply the reverse constructor. The Unix implementation's master type is private. Keeping a raw number does not reconstruct its reader, writer or child objects.

Slice 2 therefore needs an explicit low-level macOS adapter with one owner per inherited descriptor and fresh `waitpid` supervision, or an upstream/library change exposing supported reconstruction. This experiment establishes the underlying OS mechanism, **not** reconstruction of current Rust trait objects or their drop behavior. It does not authorize production extraction without that adapter and its tests.

## Limits and remaining gates

- Evidence is macOS arm64 only. macOS x64 and Rosetta are untested. No result here completes the parent change's both-architectures feasibility gate.
- There is no terminal authority checkpoint, partial escape parser, alternate-screen model, image resource recovery, protocol reply ledger, listener, lock, hook ingress or attachment replay. Those parent scenarios remain untested. A byte cursor is not a terminal checkpoint.
- The driver measures request-to-ready time, including barrier/control-protocol overhead and independent process scans. It does not measure zero service interruption, high-output backpressure, or a production latency budget.
- Missing-target exec failure is covered. Incompatible checkpoints, invalid Mach-O images, controlled post-exec fallback, code signing, hardened runtime and packaged updater transitions are not covered.
- Fatal host loss destroys its masters. Arbitrary post-exec crashes cannot be recovered from the checkpoint file. No per-session workers or descriptor transfer have been substituted.
- The agent and tool are fixtures, not provider integrations. Process-group cleanup covers their known topology and a clean Bash, not hostile descendants that detach into new sessions. Signals never use a process-name match or a PID file.
- During initial development, macOS shell teardown stalled while the host waited with a master still open. The fixture was cleaned using verified ownership. Normal teardown now closes masters before its final blocking wait. The driver has a start-identity-checked emergency cleanup path and reports forced cleanup as a test failure.

Only this new experiment subsystem is affected. Desktop, Rust backend, plugin and terminal-runtime suites are intentionally not run: none of their executable code or contracts changed. `pnpm i` completed before implementation without tracked changes. The active OpenForge app was not restarted, stopped or installed over.
