#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const layout = resolveRustSidecarLayout()
const artifactOptions = {
  cargoTargetDir: process.env.CARGO_TARGET_DIR || undefined,
  cargoBuildTarget: process.env.CARGO_BUILD_TARGET || '',
}
function selectArtifact(envName, binaryName) {
  const path = resolve(layout.repoRoot, process.env[envName] ?? layout.sessionCrates.daemon.binaryPath({ ...artifactOptions, binaryName }))
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Requested daemon artifact is missing: ${path} (${envName}); build it before running contracts`)
  }
  process.env[envName] = path
}
function cargo(args) {
  const result = spawnSync('cargo', args, { cwd: layout.repoRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
for (const kind of ['host', 'protocol', 'client', 'daemon']) {
  cargo(['test', '--manifest-path', layout.sessionCrates[kind].manifestPath])
}
if (process.platform === 'darwin' && process.arch === 'arm64') {
  cargo(['build', '--manifest-path', layout.sessionCrates.daemon.manifestPath, '--features', 'replacement-fixtures', '--bin', 'openforge-session-daemon-fixture-startup'])
}
cargo(['build', '--manifest-path', layout.sessionCrates.daemon.manifestPath])
selectArtifact('OPENFORGE_TEST_DAEMON', 'openforge-session-daemon')
if (process.platform === 'darwin' && process.arch === 'arm64') {
  selectArtifact('OPENFORGE_TEST_STARTUP_DAEMON', 'openforge-session-daemon-fixture-startup')
}
cargo(['test', '--manifest-path', layout.manifestPath, 'pty_manager::host::'])
cargo(['test', '--manifest-path', layout.manifestPath, 'pty_manager::daemon_shells::completion_tests', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, 'app_invoke::tests::daemon_', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, 'app_invoke::tests::lifecycle::daemon_pi', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, 'pty_manager::daemon_transport::tests::', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, 'plugin_host::tests::shell_callbacks::', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, 'companion_gateway::terminal_tests::daemon::', '--', '--ignored'])
cargo(['test', '--manifest-path', layout.manifestPath, '--test', 'session_daemon_sidecar', '--', '--ignored', '--nocapture'])
