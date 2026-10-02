import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('.', import.meta.url))
const pins = JSON.parse(await readFile(`${root}pins.json`, 'utf8'))
const cache = `${root}.cache/`
await mkdir(cache, { recursive: true })
const archive = `${cache}xterm.tar.gz`
let bytes
try { bytes = await readFile(archive) } catch {
  const response = await fetch(`https://codeload.github.com/xtermjs/xterm.js/tar.gz/${pins.xtermCommit}`)
  if (!response.ok) throw new Error(`xterm download failed: ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(archive, bytes)
}
if (createHash('sha256').update(bytes).digest('hex') !== pins.archiveSha256) throw new Error('xterm archive hash mismatch')
const source = `${cache}xterm.js-${pins.xtermCommit}`
await rm(source, { recursive: true, force: true })
execFileSync('tar', ['-xzf', archive, '-C', cache])
const tsconfigRaw = { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false, baseUrl: `${source}/src`, paths: { '@xterm/xterm': [`${source}/typings/xterm.d.ts`] } } }
await mkdir(`${root}dist`, { recursive: true })
const bundle = async name => build({ entryPoints: [`${source}/src/browser/public/Terminal.ts`], bundle: true, format: 'esm', platform: 'browser', sourcemap: true, outfile: `${root}dist/${name}.js`, tsconfigRaw })
await bundle('baseline')
if (!process.argv.includes('--unpatched')) execFileSync('patch', ['-p1', '-F', '0', '--batch', '-i', `${root}xterm.patch`], { cwd: source })
await bundle('candidate')
await cp(`${source}/css/xterm.css`, `${root}dist/xterm.css`)
await cp(`${source}/LICENSE`, `${root}dist/XTERM-LICENSE`)
await cp(`${root}VSCODE-LICENSE`, `${root}dist/VSCODE-LICENSE`)
await cp(`${source}/typings/xterm.d.ts`, `${root}dist/xterm.d.ts`)
for (const name of ['baseline', 'candidate']) await writeFile(`${root}dist/${name}.d.ts`, "export { Terminal } from '@xterm/xterm'\n")
if (process.argv.includes('--vendor-only')) process.exit(0)
const fixture = JSON.parse(await readFile(`${root}fixture.json`, 'utf8'))
const snapshot = await readFile(`${root}fixture.snapshot`)
if (createHash('sha256').update(snapshot).digest('hex') !== fixture.snapshotId || fixture.authority.ghosttyCommit !== pins.ghosttyCommit || fixture.authority.bindingsCommit !== pins.bindingsCommit) throw new Error('Frozen fixture identity or authority pin mismatch')
await build({ entryPoints: [`${root}page.ts`], bundle: true, format: 'esm', platform: 'browser', outfile: `${root}dist/page.js` })
await cp(`${root}index.html`, `${root}dist/index.html`)
await cp(`${root}fixture.json`, `${root}dist/fixture.json`)
console.log('Built isolated official baseline and candidate. No shared dependencies changed.')
