#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const layout = resolveRustSidecarLayout()
function cargo(args) {
  const result = spawnSync('cargo', args, { cwd: layout.repoRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
for (const kind of ['host', 'protocol', 'client', 'daemon']) {
  cargo(['test', '--manifest-path', layout.sessionCrates[kind].manifestPath])
}
cargo(['build', '--manifest-path', layout.sessionCrates.daemon.manifestPath])
cargo(['test', '--manifest-path', layout.manifestPath, 'pty_manager::host::'])
cargo(['test', '--manifest-path', layout.manifestPath, 'app_invoke::tests::daemon_', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, 'app_invoke::tests::lifecycle::daemon_pi', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, '--test', 'session_daemon_sidecar', '--', '--ignored', '--nocapture'])
