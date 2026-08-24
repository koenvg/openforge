import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_DEV_HTTP_BRIDGE_PORT,
  DEFAULT_HTTP_BRIDGE_PORT,
  DEFAULT_HTTP_BRIDGE_PORT_STRING,
} from './openforge-http-bridge-ports.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

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

function renderCliTransportSource(current, filePath) {
  return replaceRequired(
    current,
    /const DEFAULT_OPENFORGE_HTTP_PORT = '[0-9]+';?/,
    `const DEFAULT_OPENFORGE_HTTP_PORT = '${DEFAULT_HTTP_BRIDGE_PORT_STRING}';`,
    filePath,
  )
}

function renderCliHelpSource(current, filePath) {
  return replaceRequired(
    current,
    /OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port \(default: [0-9]+\)/,
    `OPENFORGE_HTTP_PORT  OpenForge HTTP bridge port (default: ${DEFAULT_HTTP_BRIDGE_PORT_STRING})`,
    filePath,
  )
}

function renderSkillDoc(current, filePath) {
  return replaceRequired(
    current,
    /The default is `[0-9]+`\./,
    `The default is \`${DEFAULT_HTTP_BRIDGE_PORT_STRING}\`.`,
    filePath,
  )
}

function renderPiExtension(current, filePath) {
  return replaceRequired(
    current,
    /const DEFAULT_OPENFORGE_HTTP_PORT = "[0-9]+";?/,
    `const DEFAULT_OPENFORGE_HTTP_PORT = "${DEFAULT_HTTP_BRIDGE_PORT_STRING}";`,
    filePath,
  )
}

export function httpBridgePortContractTargets(rustSidecarLayout = resolveRustSidecarLayout()) {
  const backendSourcePath = (...parts) => join(rustSidecarLayout.backendCrateRootPath, 'src', ...parts)
  return [
    [join(rustSidecarLayout.repoRoot, 'src', 'electron', 'httpBridgePortContract.ts'), renderElectronContract],
    [backendSourcePath('http_bridge_port_contract.rs'), renderRustContract],
    [backendSourcePath('openforge-cli', 'http-transport.js'), (current, filePath) => renderCliTransportSource(current, filePath)],
    [backendSourcePath('openforge-cli', 'help.js'), (current, filePath) => renderCliHelpSource(current, filePath)],
    [backendSourcePath('openforge-cli', 'openforge-skill.md'), (current, filePath) => renderSkillDoc(current, filePath)],
    [backendSourcePath('pi-extension', 'openforge.ts'), (current, filePath) => renderPiExtension(current, filePath)],
  ]
}

export function syncHttpBridgePortContract({ check = false, rustSidecarLayout = resolveRustSidecarLayout() } = {}) {
  const mismatches = []

  for (const [filePath, render] of httpBridgePortContractTargets(rustSidecarLayout)) {
    const current = readFileSync(filePath, 'utf8')
    const expected = render(current, filePath)
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
