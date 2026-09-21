import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

function job(id) {
  const match = workflow.match(new RegExp(`^  ${id}:\\n[\\s\\S]*?(?=^  [\\w-]+:|$(?![\\s\\S]))`, 'm'))
  expect(match, `Missing CI job ${id}`).not.toBeNull()
  return match[0]
}

describe('independent desktop CI', () => {
  it.each(['packaged-electron-smoke', 'live-electron-terminal-invariants'])(
    '%s is eligible without upstream checks or build artifacts',
    (id) => {
      const desktop = job(id)
      expect(desktop).not.toMatch(/^    (needs|if):/m)
      expect(desktop).not.toContain('needs.')
      expect(desktop).not.toContain('actions/download-artifact')
      expect(desktop).not.toContain('continue-on-error:')
      for (const setup of [
        'runs-on: macos-14',
        'uses: actions/checkout@v6',
        'node scripts/rust-sidecar-layout.mjs backend-crate-root',
        'uses: dtolnay/rust-toolchain@stable',
        'uses: swatinem/rust-cache@v2',
        'uses: ./.github/actions/prepare-ghostty',
        'uses: pnpm/action-setup@v6',
        'uses: actions/setup-node@v6',
        'node-version: 22',
      ]) expect(desktop).toContain(setup)
    },
  )

  it('retains packaged builds, smoke coverage, result artifacts and failure gates', () => {
    const smoke = job('packaged-electron-smoke')
    for (const contract of [
      'name: Packaged Electron Smoke',
      'timeout-minutes: 20',
      'CARGO_BUILD_TARGET: aarch64-apple-darwin',
      'npm_config_arch: arm64',
      'targets: aarch64-apple-darwin',
      'run: pnpm install',
      'pnpm electron:package 2>&1 | tee /tmp/packaged-smoke-package.log',
      "if: steps.package_app.outputs.exit_code == '0'",
      'pnpm electron:smoke:packaged --skip-package 2>&1 | tee /tmp/packaged-smoke.log',
      'name: packaged-electron-smoke-logs',
      'name: packaged-electron-smoke-results',
      'echo "${{ steps.package_app.outputs.exit_code }}" > /tmp/ci-results/package-exit-code',
      'echo "${{ steps.smoke.outputs.exit_code }}" > /tmp/ci-results/smoke-exit-code',
      "if: steps.package_app.outputs.exit_code != '0' || steps.smoke.outputs.exit_code != '0'",
      'run: exit 1',
    ]) expect(smoke).toContain(contract)
    expect(smoke.match(/echo "exit_code=\$\?" >> "\$GITHUB_OUTPUT"/g)).toHaveLength(2)
    expect(smoke.match(/if: always\(\)/g)).toHaveLength(3)
    expect(smoke.match(/set \+e -o pipefail/g)).toHaveLength(2)
  })

  it('retains live build preparation, both races and always-uploaded evidence', () => {
    const invariants = job('live-electron-terminal-invariants')
    for (const contract of [
      'name: Live Electron Terminal Invariants',
      'timeout-minutes: 30',
      'uses: oven-sh/setup-bun@v2',
      'run: pnpm install --frozen-lockfile',
      'set -o pipefail',
      'pnpm e2e:invariants -- \\',
      '--scenario first-attachment \\',
      '--scenario detach-during-recovery \\',
      '--output artifacts/desktop-test/ci-terminal-invariants \\',
      '2>&1 | tee artifacts/desktop-test/ci-terminal-invariants/ci.log',
      'if: always()',
      'uses: actions/upload-artifact@v6',
      'name: live-electron-terminal-invariants',
      'path: artifacts/desktop-test/ci-terminal-invariants/',
      'retention-days: 7',
      'if-no-files-found: warn',
    ]) expect(invariants).toContain(contract)
    expect(invariants).not.toContain('set +e')
    expect(invariants).not.toContain('--reuse')
  })
})
