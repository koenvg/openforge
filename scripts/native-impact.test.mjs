import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { classifyNativeImpact } from './native-impact.mjs'

describe('native impact classification', () => {
  it('selects packaged runtime for session daemon changes', () => {
    expect(classifyNativeImpact({
      changedPaths: ['src-tauri/crates/session-daemon/src/main.rs'],
    })).toEqual({
      fullRun: false,
      uncertain: false,
      packagedRuntime: true,
      mobileIos: false,
      ghosttyMac: false,
      whisperMac: false,
      reasons: {
        packagedRuntime: ['src-tauri/crates/session-daemon/src/main.rs'],
        mobileIos: [],
        ghosttyMac: [],
        whisperMac: [],
      },
    })
  })

  it('selects iOS for Mobile Companion application changes', () => {
    const decision = classifyNativeImpact({
      changedPaths: ['apps/mobile_companion/ios/Runner/AppDelegate.swift'],
    })

    expect(decision.mobileIos).toBe(true)
    expect(decision.reasons.mobileIos).toEqual([
      'apps/mobile_companion/ios/Runner/AppDelegate.swift',
    ])
    expect(decision.packagedRuntime).toBe(false)
    expect(decision.ghosttyMac).toBe(false)
    expect(decision.whisperMac).toBe(false)
  })

  it('selects macOS Ghostty for compatibility crate changes', () => {
    const decision = classifyNativeImpact({
      changedPaths: ['src-tauri/ghostty-compat/src/lib.rs'],
    })

    expect(decision.ghosttyMac).toBe(true)
    expect(decision.reasons.ghosttyMac).toEqual([
      'src-tauri/ghostty-compat/src/lib.rs',
    ])
    expect(decision.packagedRuntime).toBe(false)
    expect(decision.mobileIos).toBe(false)
    expect(decision.whisperMac).toBe(false)
  })

  it('selects Whisper for its portable CPU policy', () => {
    const decision = classifyNativeImpact({
      changedPaths: ['config/whisper-portable-cpu.cmake'],
    })

    expect(decision.whisperMac).toBe(true)
    expect(decision.reasons.whisperMac).toEqual([
      'config/whisper-portable-cpu.cmake',
    ])
    expect(decision.packagedRuntime).toBe(false)
    expect(decision.mobileIos).toBe(false)
    expect(decision.ghosttyMac).toBe(false)
  })

  it('does not select native work for unrelated documentation', () => {
    const decision = classifyNativeImpact({
      changedPaths: ['docs/task-browser.md'],
    })

    expect(decision.packagedRuntime).toBe(false)
    expect(decision.mobileIos).toBe(false)
    expect(decision.ghosttyMac).toBe(false)
    expect(decision.whisperMac).toBe(false)
    expect(decision.reasons).toEqual({
      packagedRuntime: [],
      mobileIos: [],
      ghosttyMac: [],
      whisperMac: [],
    })
  })

  it('selects every Rust-backed family for shared Cargo inputs', () => {
    const decision = classifyNativeImpact({ changedPaths: ['src-tauri/Cargo.lock'] })

    expect(decision.packagedRuntime).toBe(true)
    expect(decision.mobileIos).toBe(false)
    expect(decision.ghosttyMac).toBe(true)
    expect(decision.whisperMac).toBe(true)
  })

  it('selects every family when the classifier changes', () => {
    const decision = classifyNativeImpact({ changedPaths: ['scripts/native-impact.mjs'] })

    expect(decision.packagedRuntime).toBe(true)
    expect(decision.mobileIos).toBe(true)
    expect(decision.ghosttyMac).toBe(true)
    expect(decision.whisperMac).toBe(true)
  })

  it('selects each workflow-owned family when native workflow orchestration changes', () => {
    const nativeCompatibility = classifyNativeImpact({
      changedPaths: ['.github/workflows/native-compatibility.yml'],
    })
    const packagedRuntime = classifyNativeImpact({
      changedPaths: ['.github/workflows/packaged-session-runtime.yml'],
    })
    const whisper = classifyNativeImpact({
      changedPaths: ['.github/workflows/whisper-macos.yml'],
    })

    expect(nativeCompatibility.mobileIos).toBe(true)
    expect(nativeCompatibility.ghosttyMac).toBe(true)
    expect(packagedRuntime.packagedRuntime).toBe(true)
    expect(whisper.whisperMac).toBe(true)
  })

  it('selects every family when revision data is missing', () => {
    const decision = classifyNativeImpact({ uncertainty: 'missing-revision' })

    expect(decision.uncertain).toBe(true)
    expect(decision.packagedRuntime).toBe(true)
    expect(decision.mobileIos).toBe(true)
    expect(decision.ghosttyMac).toBe(true)
    expect(decision.whisperMac).toBe(true)
    expect(decision.reasons.packagedRuntime).toEqual(['uncertain:missing-revision'])
  })

  it('selects every family for malformed changed-path input', () => {
    const decision = classifyNativeImpact({ changedPaths: 'src-tauri/Cargo.lock' })

    expect(decision.uncertain).toBe(true)
    expect(decision.packagedRuntime).toBe(true)
    expect(decision.mobileIos).toBe(true)
    expect(decision.ghosttyMac).toBe(true)
    expect(decision.whisperMac).toBe(true)
    expect(decision.reasons.whisperMac).toEqual(['uncertain:malformed-input'])
  })

  it.each(['schedule', 'workflow_dispatch'])('selects every family for %s full runs', (eventName) => {
    const decision = classifyNativeImpact({ fullRunEvent: eventName })

    expect(decision.fullRun).toBe(true)
    expect(decision.uncertain).toBe(false)
    expect(decision.packagedRuntime).toBe(true)
    expect(decision.mobileIos).toBe(true)
    expect(decision.ghosttyMac).toBe(true)
    expect(decision.whisperMac).toBe(true)
    expect(decision.reasons.mobileIos).toEqual([`full-run:${eventName}`])
  })

  it('selects packaged runtime and Whisper when Electron packaging changes', () => {
    const decision = classifyNativeImpact({
      changedPaths: ['scripts/electron-package/package-assembly.mjs'],
    })

    expect(decision.packagedRuntime).toBe(true)
    expect(decision.whisperMac).toBe(true)
    expect(decision.mobileIos).toBe(false)
    expect(decision.ghosttyMac).toBe(false)
  })

  it('selects packaged runtime and Whisper when the Electron build changes', () => {
    const decision = classifyNativeImpact({ changedPaths: ['scripts/electron-build.mjs'] })

    expect(decision.packagedRuntime).toBe(true)
    expect(decision.whisperMac).toBe(true)
    expect(decision.mobileIos).toBe(false)
    expect(decision.ghosttyMac).toBe(false)
  })

  it.each([
    'scripts/electron-process.mjs',
    'scripts/desktop-test/daemon-ownership.mjs',
    'scripts/desktop-test/daemon-protocol.mjs',
    'openforge-data-identity.json',
    'builtin-plugins.json',
    'scripts/generate-desktop-ipc-registry.mjs',
    'tsconfig.json',
  ])('selects packaged runtime and Whisper for packaging dependency %s', (path) => {
    const decision = classifyNativeImpact({ changedPaths: [path] })

    expect(decision.packagedRuntime).toBe(true)
    expect(decision.whisperMac).toBe(true)
    expect(decision.reasons.packagedRuntime).toEqual([path])
    expect(decision.reasons.whisperMac).toEqual([path])
  })

  it('selects iOS when the Mobile Companion build command changes', () => {
    const decision = classifyNativeImpact({ changedPaths: ['scripts/mobile-companion'] })

    expect(decision.mobileIos).toBe(true)
    expect(decision.packagedRuntime).toBe(false)
    expect(decision.ghosttyMac).toBe(false)
    expect(decision.whisperMac).toBe(false)
  })

  it('selects macOS Ghostty when shared terminal model behavior changes', () => {
    const decision = classifyNativeImpact({
      changedPaths: ['src-tauri/src/terminal_model/checkpoint.rs'],
    })

    expect(decision.ghosttyMac).toBe(true)
    expect(decision.packagedRuntime).toBe(false)
    expect(decision.mobileIos).toBe(false)
    expect(decision.whisperMac).toBe(false)
  })

  it('selects Whisper when native speech implementation changes', () => {
    const decision = classifyNativeImpact({
      changedPaths: ['src-tauri/src/whisper_manager/inference.rs'],
    })

    expect(decision.whisperMac).toBe(true)
    expect(decision.packagedRuntime).toBe(false)
    expect(decision.mobileIos).toBe(false)
    expect(decision.ghosttyMac).toBe(false)
  })

  it('returns stable decisions regardless of path order or duplicates', () => {
    const paths = [
      'config/whisper-portable-cpu.cmake',
      'src-tauri/crates/session-daemon/src/main.rs',
      'config/whisper-portable-cpu.cmake',
    ]

    expect(classifyNativeImpact({ changedPaths: paths })).toEqual(
      classifyNativeImpact({ changedPaths: [...paths].reverse() }),
    )
  })

  it('prints a deterministic decision for an explicit NUL-delimited path list', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openforge-native-impact-'))
    const pathsFile = join(directory, 'paths.bin')
    writeFileSync(pathsFile, Buffer.from(
      'src-tauri/crates/session-daemon/src/main.rs\0config/whisper-portable-cpu.cmake\0',
    ))

    const stdout = execFileSync(process.execPath, [
      new URL('./native-impact.mjs', import.meta.url).pathname,
      'classify',
      '--paths-file',
      pathsFile,
    ], { encoding: 'utf8' })

    expect(JSON.parse(stdout)).toEqual(classifyNativeImpact({
      changedPaths: [
        'config/whisper-portable-cpu.cmake',
        'src-tauri/crates/session-daemon/src/main.rs',
      ],
    }))
  })
})
