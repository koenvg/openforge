import { mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..')
const mobileScript = join(repoRoot, 'scripts/mobile-companion')

async function fakeFlutterDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'openforge-mobile-release-'))
  const flutter = join(directory, 'flutter')
  const dart = join(directory, 'dart')
  const executable = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_FLUTTER_LOG"
if [[ -n "\${FAKE_IOS_EXPORT_OPTIONS_COPY:-}" && "$*" == build\\ ipa* ]]; then
  for argument in "$@"; do
    case "$argument" in
      --export-options-plist=*) cp "\${argument#*=}" "$FAKE_IOS_EXPORT_OPTIONS_COPY" ;;
    esac
  done
  cp "${repoRoot}/apps/mobile_companion/ios/Flutter/Signing.xcconfig" "$FAKE_IOS_SIGNING_CONFIG_COPY"
fi
`
  await writeFile(flutter, executable)
  await writeFile(dart, '#!/usr/bin/env bash\nexit 0\n')
  await chmod(flutter, 0o755)
  await chmod(dart, 0o755)
  return { directory, flutter }
}

function runMobileScript(command, env) {
  return new Promise((resolve) => {
    const child = spawn(mobileScript, [command], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

describe('Mobile Companion private release commands', () => {
  it('builds signed Android APK and app bundle artifacts for direct and internal distribution', async () => {
    const { directory, flutter } = await fakeFlutterDirectory()
    const log = join(directory, 'flutter.log')
    const keystore = join(directory, 'openforge-upload.jks')
    await writeFile(keystore, 'test fixture only')

    const result = await runMobileScript('build-android-release', {
      FLUTTER_BIN: flutter,
      FAKE_FLUTTER_LOG: log,
      OPENFORGE_ANDROID_KEYSTORE_PATH: keystore,
      OPENFORGE_ANDROID_KEY_ALIAS: 'openforge-upload',
      OPENFORGE_ANDROID_KEY_PASSWORD: 'key-password',
      OPENFORGE_ANDROID_STORE_PASSWORD: 'store-password',
      OPENFORGE_MOBILE_BUILD_NAME: '1.0.0',
      OPENFORGE_MOBILE_BUILD_NUMBER: '42',
    })

    expect(result).toMatchObject({ status: 0 })
    expect(await readFile(log, 'utf8')).toBe(
      'build apk --release --build-name=1.0.0 --build-number=42\n' +
        'build appbundle --release --build-name=1.0.0 --build-number=42\n',
    )
  })

  it('refuses to build an Android release without externally owned signing material', async () => {
    const { directory, flutter } = await fakeFlutterDirectory()
    const log = join(directory, 'flutter.log')

    const result = await runMobileScript('build-android-release', {
      FLUTTER_BIN: flutter,
      FAKE_FLUTTER_LOG: log,
      OPENFORGE_ANDROID_KEYSTORE_PATH: '',
      OPENFORGE_ANDROID_KEY_ALIAS: '',
      OPENFORGE_ANDROID_KEY_PASSWORD: '',
      OPENFORGE_ANDROID_STORE_PASSWORD: '',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('OPENFORGE_ANDROID_KEYSTORE_PATH')
  })

  it('builds an App Store Connect IPA from temporary non-secret signing configuration', async () => {
    const { directory, flutter } = await fakeFlutterDirectory()
    const log = join(directory, 'flutter.log')
    const exportOptionsCopy = join(directory, 'ExportOptions.plist')
    const signingConfigCopy = join(directory, 'Signing.xcconfig')

    const result = await runMobileScript('build-ios-release', {
      FLUTTER_BIN: flutter,
      FAKE_FLUTTER_LOG: log,
      FAKE_IOS_EXPORT_OPTIONS_COPY: exportOptionsCopy,
      FAKE_IOS_SIGNING_CONFIG_COPY: signingConfigCopy,
      OPENFORGE_IOS_DEVELOPMENT_TEAM: 'ABCDE12345',
      OPENFORGE_IOS_PROVISIONING_PROFILE_SPECIFIER: 'OpenForge Companion App Store',
      OPENFORGE_MOBILE_BUILD_NAME: '1.0.0',
      OPENFORGE_MOBILE_BUILD_NUMBER: '42',
    })

    expect(result).toMatchObject({ status: 0 })
    expect(await readFile(log, 'utf8')).toMatch(
      /^build ipa --release --export-options-plist=.+ --build-name=1\.0\.0 --build-number=42\n$/,
    )
    expect(await readFile(exportOptionsCopy, 'utf8')).toContain('<string>app-store-connect</string>')
    expect(await readFile(exportOptionsCopy, 'utf8')).toContain('<string>ABCDE12345</string>')
    expect(await readFile(exportOptionsCopy, 'utf8')).toContain('<key>com.openforge.app.companion</key>')
    expect(await readFile(exportOptionsCopy, 'utf8')).toContain('<string>OpenForge Companion App Store</string>')
    expect(await readFile(signingConfigCopy, 'utf8')).toContain('DEVELOPMENT_TEAM = ABCDE12345')
    expect(await readFile(signingConfigCopy, 'utf8')).toContain('CODE_SIGN_STYLE = Manual')
    expect(await readFile(signingConfigCopy, 'utf8')).toContain(
      'PROVISIONING_PROFILE_SPECIFIER = OpenForge Companion App Store',
    )
  })

  it('keeps stable release identifiers and never falls back to Android debug signing', async () => {
    const [androidBuild, iosProject, releaseEntitlements] = await Promise.all([
      readFile(join(repoRoot, 'apps/mobile_companion/android/app/build.gradle.kts'), 'utf8'),
      readFile(join(repoRoot, 'apps/mobile_companion/ios/Runner.xcodeproj/project.pbxproj'), 'utf8'),
      readFile(join(repoRoot, 'apps/mobile_companion/ios/Runner/Release.entitlements'), 'utf8'),
    ])

    expect(androidBuild).toContain('namespace = "com.openforge.app.companion"')
    expect(androidBuild).toContain('applicationId = "com.openforge.app.companion"')
    expect(androidBuild).not.toContain('signingConfigs.getByName("debug")')
    expect(iosProject).toContain('PRODUCT_BUNDLE_IDENTIFIER = com.openforge.app.companion;')
    expect(iosProject).toContain('PRODUCT_BUNDLE_IDENTIFIER = com.openforge.app.companion.RunnerTests;')
    expect(releaseEntitlements).toContain('$(AppIdentifierPrefix)com.openforge.app.companion')
  })

  it('defines a manual private release workflow without public store publication', async () => {
    const workflow = await readFile(join(repoRoot, '.github/workflows/mobile-release.yml'), 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('environment: android-internal')
    expect(workflow).toContain('environment: ios-testflight')
    expect(workflow).toContain('./scripts/mobile-companion build-android-release')
    expect(workflow).toContain('./scripts/mobile-companion build-ios-release')
    expect(workflow).toContain('build/app/outputs/flutter-apk/app-release.apk')
    expect(workflow).toContain('build/app/outputs/bundle/release/app-release.aab')
    expect(workflow).toContain('build/ios/ipa/*.ipa')
    expect(workflow).not.toContain('softprops/action-gh-release')
    expect(workflow).not.toContain('google-play')
  })
})
