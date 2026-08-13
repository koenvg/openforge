# Mobile Companion private release guide

OpenForge Companion v1 is distributed privately. This guide produces signed Android release candidates for direct/internal distribution and signed iOS archives for TestFlight or another private Apple distribution method. It does **not** publish to the public App Store or Play Store.

## Stable application identity and ownership

Both platforms use the stable application identifier `com.openforge.app.companion`.

Signing ownership stays outside this repository:

- The Apple release owner controls the Apple Developer team, the App Store Connect app record for `com.openforge.app.companion`, the distribution certificate, provisioning profile, and App Store Connect API key.
- The Android release owner controls the upload keystore and passwords used for both APK and AAB builds. Keep the same key for future updates.
- `.p12`, `.mobileprovision`, `.jks`, `.keystore`, generated signing configuration, and local key-property files are ignored. Never commit or paste them into build logs.

The iOS and Android signing owners should each have at least two trusted maintainers with a documented recovery path. Do not share credentials through Task prompts, Handoff Notes, chat, or repository files.

## Versioning

Supported build commands always pass explicit Flutter build metadata; artifacts never inherit the placeholder `1.0.0+1` value from `pubspec.yaml`.

The numeric build number is `git rev-list --count HEAD`. It increases with source history and is shared by Android and iOS. CI checks out full history before deriving it. Debug builds also put that number in the user-visible patch component, so source build `3451` appears as `1.0.3451 (3451)` in Android app information. Signed releases keep an operator-selected semantic version name and use the same source-derived build number:

```sh
export OPENFORGE_MOBILE_BUILD_NAME=1.0.0
./scripts/mobile-companion build-android-release
```

`OPENFORGE_MOBILE_BUILD_NUMBER` remains an escape hatch for release-store recovery. When set, it must be a positive integer no greater than Android's `2100000000` limit and greater than every previously distributed build number. Do not use it for routine builds.

To identify an installed Android build, first read **Settings → Apps → OpenForge Companion → App details**. Android versions that omit the build code can report both values over USB debugging:

```sh
adb shell dumpsys package com.openforge.app.companion \
  | grep -E 'version(Name|Code)='
```

Compare `versionName` and `versionCode` with the build log's `OpenForge Companion version <name>+<number>` line. For an APK that is not installed, Android Studio's APK Analyzer shows the same manifest values. TestFlight and App Store Connect show the signed iOS semantic version and build number together.

## Android private release

Required environment:

```sh
export OPENFORGE_ANDROID_KEYSTORE_PATH="$HOME/.openforge-signing/openforge-companion-upload.jks"
export OPENFORGE_ANDROID_STORE_PASSWORD='...'
export OPENFORGE_ANDROID_KEY_ALIAS='openforge-companion-upload'
export OPENFORGE_ANDROID_KEY_PASSWORD='...'
```

Build both private artifacts from the repository root:

```sh
./scripts/mobile-companion build-android-release
```

Outputs:

- `apps/mobile_companion/build/app/outputs/flutter-apk/app-release.apk` — direct installation on approved devices.
- `apps/mobile_companion/build/app/outputs/bundle/release/app-release.aab` — upload to a private/internal Play testing track when one is used.

For manual Android device testing, copy the built APK to the standard retrieval location:

```sh
cp apps/mobile_companion/build/app/outputs/flutter-apk/app-release.apk \
  "$HOME/OpenForge-Companion-debug.apk"
```

Despite the compatibility filename, the copied artifact is release-signed. Verify the signer before distribution with Android SDK `apksigner verify --print-certs <apk>` and compare its SHA-256 certificate digest with the release-owner record.

## iOS TestFlight/private release

Install Xcode and the Apple distribution certificate/provisioning profile in the build user's keychain/profile directory. Then set:

```sh
export OPENFORGE_IOS_DEVELOPMENT_TEAM=ABCDE12345
# Defaults to app-store-connect; use ad-hoc only for an owner-approved private build.
export OPENFORGE_IOS_EXPORT_METHOD=app-store-connect
# Recommended for non-interactive builds with an installed distribution profile.
export OPENFORGE_IOS_PROVISIONING_PROFILE_SPECIFIER='OpenForge Companion App Store'
```

Build from the repository root:

```sh
./scripts/mobile-companion build-ios-release
```

The signed IPA is written under `apps/mobile_companion/build/ios/ipa/`. The command creates restrictive temporary Xcode signing/export configuration and removes or restores it after the build. It does not persist certificates, profiles, or passwords.

For TestFlight, upload the IPA with the release owner's App Store Connect tooling/API key, assign it only to approved internal/external testers, and complete Apple's required export-compliance metadata. Ad hoc installs require an owner-created profile containing each approved device UDID.

## Manual CI workflow

Run **Mobile Companion Private Release** (`.github/workflows/mobile-release.yml`) with `version_name` and the optional `upload_testflight` flag. The workflow derives the build number from full source history and uses protected GitHub environments:

### `android-internal` secrets

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

### `ios-testflight` secrets

- `IOS_DEVELOPMENT_TEAM`
- `IOS_DISTRIBUTION_CERTIFICATE_BASE64`
- `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`
- `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_ISSUER_ID`, and `APP_STORE_CONNECT_API_PRIVATE_KEY` when TestFlight upload is enabled

Require environment reviewers and restrict who can trigger each environment. CI artifacts expire after 14 days. Download them only to an approved machine, verify signing, and distribute through TestFlight, an internal Android track, or an authenticated private channel. The workflow intentionally contains no GitHub public release, App Store submission, or Play production-track step.

## Release-candidate validation

Before distributing a candidate:

1. Run `./scripts/mobile-companion check` and the repository automated checks.
2. Build with a unique build number and verify application identifiers/signers.
3. Install the exact candidate artifact on one physical iOS device and one physical Android device.
4. Complete every row in [the physical-device acceptance matrix](mobile-companion-acceptance-matrix.md) over LAN and a tester-owned Tailscale network.
5. Record device OS versions, artifact hashes/build numbers, desktop version, timestamps, and evidence links without recording credentials, QR contents, bearer tokens, certificate private keys, Task content, or terminal output.
6. Do not call the candidate complete until every required row passes.

## Privacy and product boundary

Read [Mobile Companion privacy and network boundary](mobile-companion-privacy.md) before inviting testers. OpenForge operates no Companion server; the desktop and opt-in Companion Gateway must be running. Tailscale is user-managed infrastructure. V1 has no background notifications, analytics, subscriptions, hosted synchronization, or public-store launch work.
