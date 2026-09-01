import {
  ELECTRON_APP_NAME as MANIFEST_APP_NAME,
  ELECTRON_APP_PACKAGE_NAME,
  ELECTRON_BUNDLE_IDENTIFIER,
  ELECTRON_TEMPLATE_APP_NAME,
  electronPackageIdentityForRepoRoot,
} from '../data-identity.mjs'
import { resolveRustSidecarLayout } from '../rust-sidecar-layout.mjs'
import { repoRootFromScript } from './repo-root.mjs'

export const APP_NAME = MANIFEST_APP_NAME
export { ELECTRON_APP_PACKAGE_NAME, ELECTRON_BUNDLE_IDENTIFIER }
export const ELECTRON_APP_NAME = ELECTRON_TEMPLATE_APP_NAME

export function electronBundlePath(repoRoot = repoRootFromScript()) {
  const packageIdentity = electronPackageIdentityForRepoRoot(repoRoot)
  return resolveRustSidecarLayout({ repoRoot, appName: packageIdentity.appName }).electronAppPath
}

export function sidecarBinaryPathForTarget(repoRoot = repoRootFromScript(), cargoBuildTarget = '') {
  return resolveRustSidecarLayout({ repoRoot }).releaseSidecarBinaryPath({ cargoBuildTarget })
}

export function createElectronAppPackageJson({ version = '0.0.1', packageName = ELECTRON_APP_PACKAGE_NAME, dependencies = {} } = {}) {
  const packageJson = {
    name: packageName,
    version,
    type: 'module',
    main: 'dist-electron/main.js',
    private: true,
  }

  if (Object.keys(dependencies).length > 0) {
    packageJson.dependencies = dependencies
  }

  return packageJson
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function updatePlistStringValue(plist, key, value) {
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*<string>)([^<]*)(</string>)`)
  if (!pattern.test(plist)) {
    const rootDictionaryEnd = plist.lastIndexOf('</dict>')
    if (rootDictionaryEnd === -1) return plist
    return `${plist.slice(0, rootDictionaryEnd)}\n\t<key>${key}</key>\n\t<string>${value}</string>\n${plist.slice(rootDictionaryEnd)}`
  }
  return plist.replace(pattern, `$1${value}$3`)
}

export function updatePlistBooleanValue(plist, key, value) {
  const boolTag = value ? 'true' : 'false'
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*)<(true|false)\\s*/>`)
  if (!pattern.test(plist)) {
    return plist.replace('</dict>', `\n\t<key>${key}</key>\n\t<${boolTag}/>\n</dict>`)
  }
  return plist.replace(pattern, `$1<${boolTag}/>`)
}
