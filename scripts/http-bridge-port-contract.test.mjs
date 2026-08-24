import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DEV_HTTP_BRIDGE_PORT,
  DEFAULT_HTTP_BRIDGE_PORT,
  DEFAULT_HTTP_BRIDGE_PORT_STRING,
  HTTP_BRIDGE_PORT_CONTRACT,
} from './openforge-http-bridge-ports.mjs'
import { httpBridgePortContractTargets, syncHttpBridgePortContract } from './sync-http-bridge-port-contract.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'
import {
  DEFAULT_DEV_BACKEND_PORT,
  DEFAULT_PRODUCTION_BACKEND_PORT,
} from './cargo-target-env.mjs'
import { DEFAULT_SIDECAR_PORT } from '../src/electron/sidecar.ts'

const read = (path) => readFileSync(path, 'utf8')

describe('OpenForge HTTP bridge port contract', () => {
  it('defines valid shared production and development defaults', () => {
    expect(Number.isInteger(HTTP_BRIDGE_PORT_CONTRACT.productionDefaultPort)).toBe(true)
    expect(Number.isInteger(HTTP_BRIDGE_PORT_CONTRACT.developmentDefaultPort)).toBe(true)
    expect(HTTP_BRIDGE_PORT_CONTRACT.productionDefaultPort).toBeGreaterThan(0)
    expect(HTTP_BRIDGE_PORT_CONTRACT.productionDefaultPort).toBeLessThanOrEqual(65535)
    expect(HTTP_BRIDGE_PORT_CONTRACT.developmentDefaultPort).toBeGreaterThan(0)
    expect(HTTP_BRIDGE_PORT_CONTRACT.developmentDefaultPort).toBeLessThanOrEqual(65535)
    expect(DEFAULT_HTTP_BRIDGE_PORT_STRING).toBe(String(DEFAULT_HTTP_BRIDGE_PORT))
  })

  it('keeps generated and documented consumers synchronized with the JSON contract', () => {
    expect(() => syncHttpBridgePortContract({ check: true })).not.toThrow()
  })

  it('shares the same production default across Electron, dev scripts, Rust, CLI, provider docs, and provider extensions', () => {
    expect(DEFAULT_SIDECAR_PORT).toBe(DEFAULT_HTTP_BRIDGE_PORT)
    expect(DEFAULT_PRODUCTION_BACKEND_PORT).toBe(DEFAULT_HTTP_BRIDGE_PORT_STRING)
    expect(DEFAULT_DEV_BACKEND_PORT).toBe(DEFAULT_DEV_HTTP_BRIDGE_PORT)

    const layout = resolveRustSidecarLayout()
    expect(read(`${layout.backendCrateRootPath}/src/http_bridge_port_contract.rs`)).toContain(
      `pub const DEFAULT_HTTP_BRIDGE_PORT: u16 = ${DEFAULT_HTTP_BRIDGE_PORT};`,
    )
    expect(read(`${layout.backendCrateRootPath}/src/openforge-cli/http-transport.js`)).toContain(
      `const DEFAULT_OPENFORGE_HTTP_PORT = '${DEFAULT_HTTP_BRIDGE_PORT_STRING}';`,
    )
    expect(read(`${layout.backendCrateRootPath}/src/openforge-cli/openforge-skill.md`)).toContain(
      `The default is \`${DEFAULT_HTTP_BRIDGE_PORT_STRING}\`.`,
    )
    expect(read(`${layout.backendCrateRootPath}/src/pi-extension/openforge.ts`)).toContain(
      `const DEFAULT_OPENFORGE_HTTP_PORT = "${DEFAULT_HTTP_BRIDGE_PORT_STRING}";`,
    )
  })

  it('keeps runtime consumers wired to generated constants instead of local magic defaults', () => {
    expect(read('src/electron/sidecar.ts')).toContain(
      "export const DEFAULT_SIDECAR_PORT = DEFAULT_HTTP_BRIDGE_PORT",
    )
    expect(read('scripts/cargo-target-env.mjs')).toContain(
      'export const DEFAULT_PRODUCTION_BACKEND_PORT = DEFAULT_HTTP_BRIDGE_PORT_STRING',
    )
    expect(read('scripts/cargo-target-env.mjs')).toContain(
      'export const DEFAULT_DEV_BACKEND_PORT = DEFAULT_DEV_HTTP_BRIDGE_PORT',
    )
    const layout = resolveRustSidecarLayout()
    expect(read(`${layout.backendCrateRootPath}/src/http_server/server_lifecycle.rs`)).toContain(
      'unwrap_or(crate::http_bridge_port_contract::DEFAULT_HTTP_BRIDGE_PORT)',
    )
    expect(read(`${layout.backendCrateRootPath}/src/claude_hooks.rs`)).toContain(
      'unwrap_or(crate::http_bridge_port_contract::DEFAULT_HTTP_BRIDGE_PORT)',
    )
  })

  it('derives generated backend contract target paths from the shared Backend Crate layout', () => {
    const targets = httpBridgePortContractTargets(resolveRustSidecarLayout({
      repoRoot: '/repo/openforge',
      config: {
        backendCrateRoot: 'crates/openforge-backend',
        manifestPath: 'crates/openforge-backend/Cargo.toml',
        binaryName: 'openforge-backend',
        iconPath: 'crates/openforge-backend/icons/icon.icns',
        electronBundleRoot: 'target/electron/macos',
      },
    })).map(([filePath]) => filePath)

    expect(targets).toEqual([
      '/repo/openforge/src/electron/httpBridgePortContract.ts',
      '/repo/openforge/crates/openforge-backend/src/http_bridge_port_contract.rs',
      '/repo/openforge/crates/openforge-backend/src/openforge-cli/http-transport.js',
      '/repo/openforge/crates/openforge-backend/src/openforge-cli/help.js',
      '/repo/openforge/crates/openforge-backend/src/openforge-cli/openforge-skill.md',
      '/repo/openforge/crates/openforge-backend/src/pi-extension/openforge.ts',
    ])
  })
})
