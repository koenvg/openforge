import ts from 'typescript'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const pins = JSON.parse(await readFile(`${root}pins.json`, 'utf8'))
const source = `${root}.cache/xterm.js-${pins.xtermCommit}/`
// Check the complete browser source dependency graph, not tests or unrelated addons.
const program = ts.createProgram([`${source}src/browser/public/Terminal.ts`, `${source}src/vs/typings/vscode-globals-nls.d.ts`], {
  noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10,
  experimentalDecorators: true, useDefineForClassFields: false, useUnknownInCatchVariables: false,
  baseUrl: `${source}src`, paths: { '@xterm/xterm': [`${source}typings/xterm.d.ts`], 'vs/nls': [`${source}src/vs/patches/nls`] },
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [],
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => '\n' }))
  process.exitCode = 1
} else console.log('Pinned patched xterm browser source typecheck passed.')
