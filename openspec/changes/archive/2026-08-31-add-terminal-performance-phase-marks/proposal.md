## Why

The full-app terminal benchmark currently compresses shell readiness into one roughly 2.7 second number, which does not show whether time is spent in desktop navigation, terminal attachment, PTY startup, model delivery, parsing, or presentation. Its steady-state echo metric also repeats a Shell 1 tab click before every sample, adding about 35 ms of driver work that is unrelated to an already-focused terminal.

This instrumentation should land before shell startup optimization so later work can target measured phases and demonstrate where time changed.

## What Changes

- Record passive monotonic marks for lifecycle start, terminal attachment, xterm mount, shell spawn request, PTY creation, input acceptance, first output, model publication, xterm parse, render callback, and presentation proof.
- Preserve the existing shell-readiness end-to-end measurement while adding raw phase marks, adjacent segment durations, explicit missing values, and phase-ordering evidence to the JSON report and console summary.
- Add an already-focused echo mode that focuses once before warm-up and does not click the Shell 1 tab before each measured sample.
- Retain a separate full-driver echo measurement that exercises the normal focus-and-type automation path.
- Keep correctness checks equivalent across focused and full-driver echo modes.
- Keep profiling passive and opt-in, with profiler-off overhead below 2%.
- Do not add performance budgets or claim a product speedup.

## Capabilities

### New Capabilities

- `desktop-test-environment`: Extend the pending desktop test environment contract with explicit terminal phase reporting, an already-focused steady-state echo metric, a separate full-driver measurement, and bounded profiler-off overhead.

### Modified Capabilities

None. The `desktop-test-environment` capability has not yet been synced into the main spec set, so this change adds requirements at the same capability path rather than declaring a modification to a main spec.

## Impact

- Desktop performance scenario, driver, report serialization, console summary, and report schema tests.
- Development-only terminal test probe and its serializable observation contract.
- Terminal lifecycle, attachment, model-output routing, xterm parsing, rendering, and presentation-drain observation points.
- Terminal-runtime unit and integration tests, plus focused full-app benchmark verification.
- No production IPC contract change, database migration, dependency change, or user-facing compatibility break.
