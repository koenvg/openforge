// Prepare a separate window fork; leave production and the headless fork alone.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { here, root, source, baseline, patch, manifest, git, checkEnvironment, matchesSources, verifySource } from './common.mjs'

checkEnvironment()
const existing = existsSync(join(source, '.git'))
if (!existing && existsSync(source) && readdirSync(source).length) throw new Error('Refusing to initialize a nonempty source directory')
if (existing && git('rev-parse', 'HEAD') !== manifest.revision) throw new Error('Unexpected upstream revision')
const baseHashes = JSON.parse(readFileSync(join(here, '../native-ghostty-fork/evidence/report.json'), 'utf8')).sourceHashes
if (existing && git('status', '--porcelain') && !matchesSources(baseHashes) && !matchesSources(manifest.sourceHashes)) {
  throw new Error('Unexpected local edits in the isolated checkout; preserve them before preparing')
}
execFileSync(process.execPath, [join(here, '../native-ghostty-fork/prepare.mjs'), root], { stdio: 'inherit' })
if (!existing) git('branch', '-m', 'experiment/openforge-native-window')
if (!matchesSources(manifest.sourceHashes)) {
  if (!matchesSources(baseHashes)) { git('apply', '--check', baseline); git('apply', baseline) }
  git('apply', '--check', patch)
  git('apply', patch)
}
verifySource()
console.log(`Prepared native window experiment: ${root}`)
