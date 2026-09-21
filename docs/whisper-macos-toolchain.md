# Whisper on macOS arm64

OpenForge builds whisper-rs-sys 0.14.1's vendored whisper.cpp 1.7.6 CPU kernels for `armv8-a`, not the packaging host's CPU. NEON, Accelerate, and embedded Metal support remain available. Intel settings are unchanged.

## Failure evidence

KVG-4728's [native macOS 15 run](https://github.com/koenvg/openforge/actions/runs/35535077246) failed while compiling `ggml-cpu/arch/arm/quants.c:217`. Its `packaged-session-runtime-arm64` artifact records an Apple M1 virtual machine, native arm64 execution, and AppleClang 17.0.0.17000013.

Vendored ggml defaults to `GGML_NATIVE=ON`. Its ARM CMake code tries to extract `-mcpu=...` from verbose compiler output. That extraction failed on this runner, so it used `-mcpu=native`. It then compiled and ran individual feature probes. The i8mm probe failed, while the empty-program `+noi8mm` compilation succeeded. The resulting CPU flags were:

```text
-mcpu=native+dotprod+noi8mm+nosve+nosme
```

Despite `+noi8mm`, ggml's subsequent preprocessor check reported `ARM feature MATMUL_INT8 enabled`. The source guards `vmmlaq_s32` with `__ARM_FEATURE_MATMUL_INT8`, so it selected code that the compiler's target-feature check rejected. The empty-program negative-feature probe does not verify that the feature macro disappears or that guarded intrinsic code compiles.

A fresh [macOS 15 reproduction](https://github.com/koenvg/openforge/actions/runs/35574085597) at commit `2bffadee4` failed at the same intrinsic. Its `CMakeConfigureLog.yaml` shows that `-mcpu=native+i8mm` compiled and linked successfully, then failed to run with `Illegal instruction`. The negative-feature probe compiled successfully. The captured compiler macros still define `__ARM_FEATURE_MATMUL_INT8` under `+noi8mm`, but not under `-march=armv8-a`. This establishes both the unsupported runner instruction and the compiler macro/target-feature mismatch. AppleClang 21 on the local development machine removes the macro for `+noi8mm`, so local compilation alone would miss the macOS 15 failure.

Enabling i8mm would hide the error but require instructions unavailable on the M1 baseline. A distributable binary must not derive its required instruction set from the packaging machine.

## Build policy

`.cargo/config.toml` supplies `CMAKE_PROJECT_whisper.cpp_INCLUDE`, with a repository-relative path resolved by Cargo. whisper-rs-sys forwards `CMAKE_*` variables to CMake, but does not forward `GGML_*` variables. Setting `GGML_NATIVE=OFF` in the shell therefore does not configure this dependency. The deprecated `WHISPER_NATIVE=OFF` alias also does not turn off ggml's default.

`config/whisper-portable-cpu.cmake` runs after CMake identifies the target. For Darwin arm64 it sets `GGML_NATIVE=OFF` and `GGML_CPU_ARM_ARCH=armv8-a`. It changes no compiler selection, deployment target, Metal option, or unrelated project's configuration. The architecture check uses the target, not the host, and leaves Intel and non-Darwin targets unchanged.

whisper-rs-sys does not declare its CMake environment overrides as Cargo rebuild inputs. Packaging therefore cleans this dependency's release artifacts before rebuilding. This prevents an older host-specialized build from silently surviving a configuration change. Direct Cargo users with existing artifacts should run once after changing this policy:

```sh
cd src-tauri
cargo clean --release -p whisper-rs-sys --target aarch64-apple-darwin
cargo build --locked --release --target aarch64-apple-darwin
```

For debug artifacts, omit `--release` from the clean command. Builds must run inside the checkout so Cargo discovers `.cargo/config.toml`.

## Regression coverage

The separate `Whisper macOS compatibility` workflow uses `macos-15` without a Rust cache. It records compiler macros, packages the native app, checks actual CPU compilation commands and preprocessor macros, transcribes pinned speech with GPU disabled and enabled, runs backend tests/check/clippy, and runs the packaged Electron smoke test. It uploads logs and CMake evidence as `whisper-macos-arm64`.

The existing Packaged Session Runtime workflow stays on `macos-14` for arm64 and `macos-15-intel` for Intel. This repair does not change daemon staging.

Run the fast target-policy checks locally:

```sh
python3 scripts/test-whisper-cmake.py
pnpm exec vitest run scripts/electron-package.test.mjs
```

After an arm64 release build, pass its whisper CMake output directory to the compile-command check:

```sh
python3 scripts/check-whisper-cpu-build.py \
  src-tauri/target/aarch64-apple-darwin/release/build/whisper-rs-sys-<hash>/out/build
```

Run real speech inference with the same Rust dependency and features as the backend:

```sh
bash scripts/prepare-whisper-test-fixtures.sh /tmp/openforge-whisper-fixtures
export OPENFORGE_WHISPER_TEST_MODEL=/tmp/openforge-whisper-fixtures/ggml-tiny.en-q5_1.bin
export OPENFORGE_WHISPER_TEST_AUDIO=/tmp/openforge-whisper-fixtures/jfk.wav
cargo test --locked --release --manifest-path src-tauri/Cargo.toml \
  --target aarch64-apple-darwin --test whisper_native -- --ignored --nocapture --test-threads=1
```

The downloader verifies SHA-256 hashes for the quantized tiny English model and upstream JFK speech sample. The ignored tests are explicitly invoked in CI and fail if fixtures are missing. Each checks recognized speech, not merely model loading. GPU-enabled inference permits whisper's normal CPU fallback; the uploaded voice log shows whether Metal initialized on the runner.
