// Source-time shim for Electron main code. electron:build copies the concrete
// package-owned contract beside compiled Electron assets so pluginProtocol.js can
// keep importing ./svelteHostRuntimeContract.mjs at runtime.
export * from '../../packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'
