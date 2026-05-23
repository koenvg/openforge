import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_DEV_HTTP_BRIDGE_PORT,
  DEFAULT_HTTP_BRIDGE_PORT,
  DEFAULT_HTTP_BRIDGE_PORT_STRING,
} from './openforge-http-bridge-ports.mjs'

const GENERATED_HEADER = 'Generated from config/openforge-http-bridge-ports.json by scripts/sync-http-bridge-port-contract.mjs. Do not edit directly.'

function renderElectronContract() {
  return `/**\n * ${GENERATED_HEADER}\n */\n\nexport const DEFAULT_HTTP_BRIDGE_PORT = ${DEFAULT_HTTP_BRIDGE_PORT}\nexport const DEFAULT_HTTP_BRIDGE_PORT_STRING = '${DEFAULT_HTTP_BRIDGE_PORT_STRING}'\nexport const DEFAULT_DEV_HTTP_BRIDGE_PORT = ${DEFAULT_DEV_HTTP_BRIDGE_PORT}\n`
}

function renderRustContract() {
  return `//! ${GENERATED_HEADER}\n\npub const DEFAULT_HTTP_BRIDGE_PORT: u16 = ${DEFAULT_HTTP_BRIDGE_PORT};\n`
}

function replaceRequired(contents, pattern, replacement, filePath) {
  if (!pattern.test(contents)) {
    throw new Error(`Could not find expected HTTP bridge port contract marker in ${filePath}`)
  }
  return contents.replace(pattern, replacement)
}

function renderCliSource(current) {
  let next = replaceRequired(
    current,
    /const DEFAULT_OPENFORGE_HTTP_PORT = '[0-9]+';?/,
    `const DEFAULT_OPENFORGE_HTTP_PORT = '${DEFAULT_HTTP_BRIDGE_PORT_STRING}';`,
    'src-tauri/src/openforge-cli/cli.js',
  )
  next = replaceRequired(
    next,
    /OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port \(default: [0-9]+\)/,
    `OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port (default: ${DEFAULT_HTTP_BRIDGE_PORT_STRING})`,
    'src-tauri/src/openforge-cli/cli.js',
  )
  return next
}

function renderSkillDoc(current) {
  return replaceRequired(
    current,
    /The default is `[0-9]+`\./,
    `The default is \`${DEFAULT_HTTP_BRIDGE_PORT_STRING}\`.`,
    'src-tauri/src/openforge-cli/openforge-skill.md',
  )
}

function renderPiExtension(current) {
  return replaceRequired(
    current,
    /const DEFAULT_OPENFORGE_HTTP_PORT = "[0-9]+";?/,
    `const DEFAULT_OPENFORGE_HTTP_PORT = "${DEFAULT_HTTP_BRIDGE_PORT_STRING}";`,
    'src-tauri/src/pi-extension/openforge.ts',
  )
}

const generatedTargets = [
  ['src/electron/httpBridgePortContract.ts', renderElectronContract],
  ['src-tauri/src/http_bridge_port_contract.rs', renderRustContract],
  ['src-tauri/src/openforge-cli/cli.js', (current) => renderCliSource(current)],
  ['src-tauri/src/openforge-cli/openforge-skill.md', (current) => renderSkillDoc(current)],
  ['src-tauri/src/pi-extension/openforge.ts', (current) => renderPiExtension(current)],
]

export function syncHttpBridgePortContract({ check = false } = {}) {
  const mismatches = []

  for (const [filePath, render] of generatedTargets) {
    const current = readFileSync(filePath, 'utf8')
    const expected = render(current)
    if (current === expected) continue

    if (check) {
      mismatches.push(filePath)
    } else {
      writeFileSync(filePath, expected)
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`HTTP bridge port contract generated files are out of sync: ${mismatches.join(', ')}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  syncHttpBridgePortContract({ check: process.argv.includes('--check') })
}
