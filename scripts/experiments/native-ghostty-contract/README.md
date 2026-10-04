# Full-native Ghostty contract gate

Isolated KVG-5198 experiment for replacing xterm. It tests declared C interfaces and inventories current native exports. It does not render, link Ghostty, create a shell or change OpenForge's dependencies.

See [findings and the blocked runtime matrix](../../../docs/experiments/native-ghostty-screen-first-contract.md).

## Run

Requires Node 24+, Clang with C11 support, and HTTPS access to GitHub. Metal preflight uses `xcrun` on macOS; its absence is recorded, not treated as a successful build. No package installation is needed beyond the repository's existing setup.

From the repository root:

```sh
node --check scripts/experiments/native-ghostty-contract/run.mjs
node scripts/experiments/native-ghostty-contract/run.mjs
# Optional output directory:
node scripts/experiments/native-ghostty-contract/run.mjs /tmp/native-ghostty-contract
```

The runner always fetches full revision `4ae9f1a2de5484de3d6a13fe03676b8853b9c41c`. It follows pinned Ghostty header includes, records SHA-256 hashes, and downloads implementation files for semantic review. It never uses moving main-branch contents or loads an upstream executable.

Default generated output is ignored under `artifacts/terminal-presentation/native-ghostty-contract/`. Downloaded source, compiler logs and `report.json` stay there. The checked-in [report](evidence/report.json) preserves this run's hashes, declarations, diagnostics and source excerpts.

## Controls

- `native-probe.c` must compile against `ghostty.h` alone.
- `snapshot-probe.c` must compile against the VT snapshot header alone.
- `probe.c` reproduces the audited mixed-header namespace collision. It must fail and name all three colliding constants. A different failure is an experiment failure.
- Clang parses the native header and emits all native `ghostty_*` function declarations. The report is an inventory, not an automatic capability verdict. Read the implementation and findings before concluding that an interface is usable.

Exit zero means these observations were reproduced, **not** that the renderer is approved. Both positive controls are compile-only. The mixed-header issue can be avoided with separate translation units and is not the main blocker; the missing host-output/checkpoint connection is.

No GUI tests or performance benchmark can run through the required native interface at this revision. The prior native-hosting demo is not substituted for an existing-session restoration test. The scope stops at the first failed contract gate, as required by ADR 0005.
