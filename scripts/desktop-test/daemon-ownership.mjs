import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { exchangeDaemon } from './daemon-protocol.mjs'

const execute = promisify(execFile)

async function ownedPath(path, directory, privateMode = false) {
  const metadata = await lstat(path)
  if (metadata.uid !== process.getuid() || (directory ? !metadata.isDirectory() : !metadata.isFile())
    || (metadata.mode & (privateMode ? 0o077 : 0o022)) !== 0 || (!directory && metadata.nlink !== 1)) {
    throw new Error(`Unsafe owned daemon resource: ${path}`)
  }
}

async function waitForDaemonExit(runtime) {
  // Inspect this installation's ownership descriptor, never process-name matches.
  const deadline = Date.now() + 5000
  while (true) {
    let holders
    try {
      holders = (await execute('lsof', ['-t', '--', join(runtime, 'daemon.lock')], { timeout: 2000, maxBuffer: 64 * 1024 })).stdout.trim()
    } catch (error) {
      if (error.code === 1 && !error.stdout?.trim()) return
      throw new Error('Cannot prove owned daemon exit; retaining fixture resources')
    }
    if (!holders) return
    if (Date.now() >= deadline) throw new Error('Owned daemon did not exit; retaining fixture resources')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
  }
}

export async function createDaemonOwnershipRegistry({ mode, runRoot } = {}) {
  if (mode === 'reuse') return { cleanup: async () => ({ owned: false, resources: [] }) }
  if (mode !== 'isolated' || !runRoot) throw new Error('Explicit isolated daemon ownership is required')
  const root = resolve(runRoot)
  await ownedPath(root, true, true)
  const marker = join(root, 'daemon-fixture-owner.json')
  const identity = JSON.stringify({ version: 1, runId: randomUUID(), root })
  await writeFile(marker, identity, { flag: 'wx', mode: 0o600 })
  const runtime = join(root, 'app-data', 'session-daemon', 'session-v1')
  const resources = ['daemon.lock', 'daemon.log', 'control.sock', 'credentials.json', 'releases', 'images']
    .map(name => join(runtime, name))
  return {
    async cleanup({ exchange = exchangeDaemon, waitForExit = waitForDaemonExit } = {}) {
      await ownedPath(root, true, true)
      await ownedPath(marker, false, true)
      if (await readFile(marker, 'utf8') !== identity) throw new Error('Fixture ownership changed; refusing daemon cleanup')
      for (const path of [join(root, 'app-data'), join(root, 'app-data', 'session-daemon'), runtime]) {
        try { await ownedPath(path, true) } catch (error) {
          if (error.code === 'ENOENT') return { owned: true, resources }
          throw error
        }
      }
      const ownedResources = [...new Set([...resources, ...(await readdir(runtime)).map(name => join(runtime, name))])]
      const credentialsPath = join(runtime, 'credentials.json')
      await ownedPath(credentialsPath, false, true)
      const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'))
      if (typeof credentials.installation !== 'string' || !/^[a-f0-9]{64}$/i.test(credentials.token)) {
        throw new Error('Invalid daemon fixture credentials')
      }
      let response
      try {
        response = await exchange(runtime, credentials, { kind: 'connect', installation: credentials.installation })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        await waitForExit(runtime)
        return { owned: true, resources: ownedResources }
      }
      const inventory = response.kind === 'inventory' ? response.value : null
      if (inventory?.controller?.installation !== credentials.installation || !Array.isArray(inventory.sessions)) {
        throw new Error('Foreign daemon inventory; refusing fixture cleanup')
      }
      for (const session of inventory.sessions) {
        const result = await exchange(runtime, credentials, {
          kind: 'terminate', controller: inventory.controller, operation: randomUUID(), pty: session.pty,
        })
        if (result.kind !== 'done') throw new Error('Owned descendant cleanup failed; retaining resources')
      }
      // Termination acknowledges process exit before the bounded PTY output drain
      // completes. Only an explicit nonempty refusal is safe to retry; never replay
      // termination or retry an unknown shutdown outcome.
      const deadline = Date.now() + 5000
      while (true) {
        let result
        try {
          result = await exchange(runtime, credentials, { kind: 'shutdownEmpty', controller: inventory.controller })
        } catch (error) {
          if (error.daemonCode !== 'invalidRequest' || Date.now() >= deadline) throw error
          await new Promise(resolvePromise => setTimeout(resolvePromise, 50))
          continue
        }
        if (result.kind !== 'done') throw new Error('Owned daemon shutdown failed; retaining resources')
        break
      }
      await waitForExit(runtime)
      return { owned: true, resources: ownedResources, sessions: inventory.sessions.map(({ pid, pty }) => ({ pid, pty })) }
    },
  }
}
