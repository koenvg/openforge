import { spawnSync } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { waitForOwnedDaemonExit } from './desktop-test/daemon-ownership.mjs'

/** Remove only this run's isolated resources after the fixture's owners stop. */
export async function cleanupRestartFixture({ daemonRoot, runRoot, stopOwnedWriters }) {
  if (!basename(daemonRoot).startsWith('openforge-restart-daemon-')
    || (runRoot && !basename(runRoot).startsWith('openforge-desktop-test-'))) {
    throw new Error('Refusing cleanup of non-fixture runtime roots')
  }
  await stopOwnedWriters()
  const runtime = join(daemonRoot, 'session-v1')
  const empty = (await readdir(daemonRoot)).length === 0
  const daemonStopped = !(await readdir(runtime).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })).includes('control.sock')
  const cleanup = empty || daemonStopped ? { status: 0 } : spawnSync('cargo', ['run', '--quiet', '--manifest-path', 'src-tauri/crates/session-client/Cargo.toml', '--example', 'shutdown-fixture', '--', daemonRoot], { encoding: 'utf8' })
  if (cleanup.status !== 0) throw new Error(`Fixture cleanup failed; retained ${daemonRoot}: ${cleanup.error?.message ?? cleanup.stderr?.slice(-1000)}`)
  // The daemon unlinks control.sock before releasing daemon.lock and finishing its final writes.
  if (!empty) await waitForOwnedDaemonExit(runtime)
  await rm(daemonRoot, { recursive: true, force: true })
  if (runRoot) await rm(runRoot, { recursive: true, force: true })
}
