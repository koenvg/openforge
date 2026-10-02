import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = fileURLToPath(new URL('.', import.meta.url))
const pins = JSON.parse(await readFile(`${root}pins.json`, 'utf8'))
const env = {
  ...process.env,
  GHOSTTY_SOURCE_DIR: process.env.GHOSTTY_SOURCE_DIR ?? `${homedir()}/.cache/openforge/ghostty/${pins.ghosttyCommit}`,
  GHOSTTY_ZIG_SYSTEM_DIR: process.env.GHOSTTY_ZIG_SYSTEM_DIR ?? `${homedir()}/.cache/openforge/ghostty/zig-system-${pins.ghosttyCommit}`,
}
if (execFileSync('git', ['-C', env.GHOSTTY_SOURCE_DIR, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== pins.ghosttyCommit) throw new Error('no-go: authority source is not the pinned Ghostty commit')
execFileSync('git', ['-C', env.GHOSTTY_SOURCE_DIR, 'diff', '--quiet', 'HEAD'])
if (execFileSync('zig', ['version'], { encoding: 'utf8' }).trim() !== '0.16.0') throw new Error('Zig 0.16.0 is required')
const json = execFileSync('cargo', ['run', '--release', '--locked', '--manifest-path', `${root}native/Cargo.toml`], { cwd: `${root}native`, env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
const fixture = JSON.parse(json)
const snapshot = Buffer.from(fixture.snapshotBase64, 'base64')
fixture.snapshotId = createHash('sha256').update(snapshot).digest('hex')
delete fixture.snapshotBase64
fixture.authority = { ghosttyCommit: pins.ghosttyCommit, bindingsCommit: pins.bindingsCommit }
for (const page of fixture.pages) Object.assign(page, { snapshotId: fixture.snapshotId, watermark: fixture.watermark })
if (process.argv.includes('--check')) {
  const frozen = JSON.parse(await readFile(`${root}fixture.json`, 'utf8'))
  delete frozen.costsMs
  delete fixture.costsMs
  if (JSON.stringify(frozen) !== JSON.stringify(fixture)) throw new Error('Frozen fixture differs from pinned authority export')
  console.log('Frozen screen, parsed rows, live continuations and snapshot identity reproduce exactly.')
  process.exit(0)
}
await writeFile(`${root}fixture.snapshot`, snapshot)
await writeFile(`${root}fixture.json`, JSON.stringify(fixture, null, 2) + '\n')
console.log(`Exported ${fixture.historyRows} older rows in ${fixture.pages.length} parsed frontend pages. Snapshot ${fixture.snapshotId}`)
