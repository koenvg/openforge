import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = (name) => readFileSync(
  new URL(`../.github/workflows/${name}`, import.meta.url),
  'utf8',
)

function job(source, id) {
  const match = source.match(new RegExp(`\\n  ${id}:[\\s\\S]*?(?=\\n  [a-z][a-z0-9-]*:|$)`))
  expect(match, `Expected workflow job ${id}`).not.toBeNull()
  return match?.[0] ?? ''
}

describe('optional native workflow allocation', () => {
  it('keeps Android and cross-platform Ghostty in CI while native Apple jobs move out', () => {
    const ci = workflow('ci.yml')
    const android = job(ci, 'mobile-android')
    const crossPlatformGhostty = job(ci, 'ghostty-compatibility')
    const native = workflow('native-compatibility.yml')
    const ios = job(native, 'mobile-ios')
    const macosGhostty = job(native, 'ghostty-macos')

    expect(android).toContain('name: Mobile Companion Android Build')
    expect(android).toContain('runs-on: ubuntu-latest')
    expect(android).toContain('./scripts/mobile-companion build-android')
    expect(crossPlatformGhostty).toContain('name: Linux')
    expect(crossPlatformGhostty).toContain('name: Windows')
    expect(crossPlatformGhostty).not.toContain('name: macOS')

    expect(ios).toContain('name: Mobile Companion iOS Build')
    expect(ios).toContain('runs-on: macos-15')
    expect(native).toContain('FLUTTER_VERSION: "3.44.9"')
    expect(ios).toContain('flutter-version: ${{ env.FLUTTER_VERSION }}')
    expect(ios).toContain('./scripts/mobile-companion build-ios')
    expect(macosGhostty).toContain('name: Ghostty Compatibility (macOS)')
    expect(macosGhostty).toContain('runs-on: macos-15')
    expect(macosGhostty).toContain(
      'cargo test --manifest-path ghostty-compat/Cargo.toml --locked --offline terminal_model::',
    )
  })

  it('gates iOS and macOS Ghostty before runner allocation and fails closed', () => {
    const native = workflow('native-compatibility.yml')
    const impact = job(native, 'impact')
    const ios = job(native, 'mobile-ios')
    const macosGhostty = job(native, 'ghostty-macos')

    expect(impact).toContain('name: Native Impact')
    expect(impact).toContain('runs-on: ubuntu-latest')
    expect(impact).toContain('fetch-depth: 0')
    expect(impact).toContain('uses: ./.github/actions/native-impact')

    for (const [nativeJob, output] of [[ios, 'mobileIos'], [macosGhostty, 'ghosttyMac']]) {
      expect(nativeJob).toContain('needs: impact')
      expect(nativeJob).toContain('if: always() && !cancelled() && (')
      expect(nativeJob).toContain("needs.impact.outputs.fullRun == 'true'")
      expect(nativeJob).toContain("needs.impact.result == 'failure'")
      expect(nativeJob).toContain(`needs.impact.outputs.${output} == 'true'`)
    }
  })

  it('gates the complete packaged runtime matrix with one cheap impact job', () => {
    const packaged = workflow('packaged-session-runtime.yml')
    const impact = job(packaged, 'impact')
    const runtime = job(packaged, 'packaged-runtime')

    expect(impact).toContain('runs-on: ubuntu-latest')
    expect(impact).toContain('uses: ./.github/actions/native-impact')
    expect(runtime).toContain('needs: impact')
    expect(runtime).toContain('if: always() && !cancelled() && (')
    expect(runtime).toContain("needs.impact.outputs.fullRun == 'true'")
    expect(runtime).toContain("needs.impact.result == 'failure'")
    expect(runtime).toContain("needs.impact.outputs.packagedRuntime == 'true'")
    expect(runtime).toContain('runner: macos-15-intel')
    expect(runtime).toContain('runner: macos-15')
    expect(runtime).toContain('for attempt in {1..20}')
    expect(runtime).toContain('pnpm electron:smoke:packaged --skip-package')
    expect(runtime).toContain('packaged-session-runtime-${{ matrix.arch }}')
  })

  it('replaces Whisper path filters with a visible fail-closed decision', () => {
    const whisper = workflow('whisper-macos.yml')
    const trigger = whisper.slice(whisper.indexOf('on:'), whisper.indexOf('permissions:'))
    const impact = job(whisper, 'impact')
    const native = job(whisper, 'native-arm64')

    expect(trigger).toContain('pull_request:')
    expect(trigger).toContain('push:')
    expect(trigger).not.toContain('paths:')
    expect(impact).toContain('runs-on: ubuntu-latest')
    expect(impact).toContain('uses: ./.github/actions/native-impact')
    expect(native).toContain('needs: impact')
    expect(native).toContain('if: always() && !cancelled() && (')
    expect(native).toContain("needs.impact.outputs.fullRun == 'true'")
    expect(native).toContain("needs.impact.result == 'failure'")
    expect(native).toContain("needs.impact.outputs.whisperMac == 'true'")
    expect(native).toContain('python3 scripts/test-whisper-cmake.py')
    expect(native).toContain('pnpm electron:package')
    expect(native).toContain('--test whisper_native')
    expect(native).toContain('cargo clippy --locked')
    expect(native).toContain('pnpm electron:smoke:packaged --skip-package')
    expect(native).toContain('name: whisper-macos-arm64')
  })

  it('keeps manual full runs and staggers daily native schedules', () => {
    const names = [
      'packaged-session-runtime.yml',
      'native-compatibility.yml',
      'whisper-macos.yml',
    ]
    const crons = names.map((name) => {
      const source = workflow(name)
      expect(source, name).toContain('workflow_dispatch:')
      expect(source, name).toContain('schedule:')
      expect(source, name).toContain('cancel-in-progress: true')
      return source.match(/- cron: '([^']+)'/)?.[1]
    })

    expect(crons.every(Boolean)).toBe(true)
    expect(new Set(crons).size).toBe(names.length)
  })
})
