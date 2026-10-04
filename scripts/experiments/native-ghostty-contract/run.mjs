// Reproducible source/compile audit, not a renderer or performance benchmark.
// Requires Node 24+, clang, and network access. Never launches a PTY or GUI.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const revision = '4ae9f1a2de5484de3d6a13fe03676b8853b9c41c'
const upstream = `https://raw.githubusercontent.com/ghostty-org/ghostty/${revision}/`
const directory = dirname(fileURLToPath(import.meta.url))
const output = resolve(process.argv[2] ?? 'artifacts/terminal-presentation/native-ghostty-contract')
const sourceRoot = resolve(output, 'source')
const sources = new Map()

async function download(path) {
  if (sources.has(path)) return
  const response = await fetch(upstream + path, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const destination = resolve(sourceRoot, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
  sources.set(path, {
    url: upstream + path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  // Follow only pinned Ghostty includes. System headers come from the C compiler.
  for (const match of bytes.toString('utf8').matchAll(/^#include <(ghostty\/[\w/.-]+)>/gm)) {
    await download(`include/${match[1]}`)
  }
}

for (const path of [
  'include/ghostty.h',
  'include/ghostty/vt/snapshot.h',
  'src/apprt/embedded.zig',
  'src/apprt/action.zig',
  'src/Surface.zig',
  'src/termio/backend.zig',
  'src/termio/Exec.zig',
  'src/renderer/metal/Target.zig',
  'build.zig.zon',
]) await download(path)

const compileArgs = ['-std=c11', '-Wall', '-Wextra', '-Werror', '-fsyntax-only', '-I', resolve(sourceRoot, 'include')]
const compileControls = []
for (const [file, expectedSuccess] of [['native-probe.c', true], ['snapshot-probe.c', true], ['probe.c', false]]) {
  const compile = spawnSync('clang', [...compileArgs, resolve(directory, file)], { encoding: 'utf8' })
  const diagnostics = (compile.stdout ?? '') + (compile.stderr ?? '')
  await writeFile(resolve(output, `${file}.txt`), diagnostics)
  if (compile.error || (compile.status === 0) !== expectedSuccess) {
    throw new Error(`${file}: unexpected compile result: ${compile.error?.message ?? diagnostics}`)
  }
  if (!expectedSuccess && !['GHOSTTY_SUCCESS', 'GHOSTTY_COLOR_SCHEME_LIGHT', 'GHOSTTY_COLOR_SCHEME_DARK'].every(name => diagnostics.includes(name))) {
    throw new Error('mixed-header diagnostic failed for an unexpected reason')
  }
  compileControls.push({
    file, exit: compile.status, expectedSuccess, linked: false, executed: false,
    sha256: createHash('sha256').update(await readFile(resolve(directory, file))).digest('hex'),
    diagnostics: diagnostics.replaceAll(sourceRoot, '<source>').replaceAll(directory, '<probe>'),
  })
}

// Ask the C compiler for declarations. A function-name search alone cannot
// establish whether a native surface accepts restored state or external I/O.
const ast = JSON.parse(execFileSync('clang', [
  ...compileArgs, '-x', 'c', '-Xclang', '-ast-dump=json', resolve(sourceRoot, 'include/ghostty.h'),
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
const declarations = new Map()
function visit(node) {
  if (node.kind === 'FunctionDecl' && node.name?.startsWith('ghostty_')) {
    declarations.set(node.name, { name: node.name, type: node.type.qualType })
  }
  for (const child of node.inner ?? []) visit(child)
}
visit(ast)
if (!declarations.has('ghostty_surface_new')) throw new Error('native declaration inventory is incomplete')

const excerpts = []
for (const [path, first, last] of [
  ['include/ghostty.h', 1, 12],
  ['include/ghostty.h', 489, 521],
  ['include/ghostty.h', 1075, 1094],
  ['src/apprt/embedded.zig', 2070, 2076],
  ['src/Surface.zig', 3328, 3334],
  ['src/Surface.zig', 6146, 6223],
  ['src/termio/backend.zig', 13, 26],
  ['src/Surface.zig', 668, 684],
]) {
  const lines = (await readFile(resolve(sourceRoot, path), 'utf8')).split('\n')
  excerpts.push({ path, first, last, text: lines.slice(first - 1, last).join('\n') })
}
const metal = spawnSync('xcrun', ['--find', 'metal'], { encoding: 'utf8' })
const report = {
  revision,
  recordedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  compiler: execFileSync('clang', ['--version'], { encoding: 'utf8' }).split('\n')[0],
  compileFlags: compileArgs.slice(0, 5),
  compileControls,
  metalCompiler: { exit: metal.status, output: (metal.stdout ?? '') + (metal.stderr ?? ''), error: metal.error?.message ?? null },
  sources: Object.fromEntries(sources),
  nativeDeclarations: [...declarations.values()].sort((a, b) => a.name.localeCompare(b.name)),
  excerpts,
  limitations: [
    'Compile-only declaration control; no native library linked or renderer executed.',
    'This inventory requires semantic source review. It does not automatically prove a missing capability.',
    'No READY-to-pixel, history-load, resize, image, lifecycle or performance measurement was made.',
  ],
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ output, revision, compileControls: compileControls.map(({ file, exit }) => ({ file, exit })), declarations: declarations.size, metalExit: metal.status }))
