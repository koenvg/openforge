import { execFileSync as defaultExecFileSync } from 'node:child_process'
import path from 'node:path'
import {
  DEFAULT_DEV_HTTP_BRIDGE_PORT,
  DEFAULT_HTTP_BRIDGE_PORT_STRING,
} from './openforge-http-bridge-ports.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const SHARED_TARGET_DIR_NAME = '.cargo-target'
const NON_STANDARD_COMMON_DIR_TARGET_NAME = 'openforge-cargo-target'
export const DEFAULT_PRODUCTION_BACKEND_PORT = DEFAULT_HTTP_BRIDGE_PORT_STRING
export const DEFAULT_DEV_BACKEND_PORT = DEFAULT_DEV_HTTP_BRIDGE_PORT

export function resolveGitCommonDir(cwd, gitCommonDir) {
  return path.normalize(path.isAbsolute(gitCommonDir) ? gitCommonDir : path.resolve(cwd, gitCommonDir))
}

export function sharedCargoTargetDirFromGitCommonDir(gitCommonDir) {
  const normalizedGitCommonDir = path.normalize(gitCommonDir)

  if (path.basename(normalizedGitCommonDir) === '.git') {
    return path.join(path.dirname(normalizedGitCommonDir), SHARED_TARGET_DIR_NAME)
  }

  return path.join(normalizedGitCommonDir, NON_STANDARD_COMMON_DIR_TARGET_NAME)
}

export function parsePort(value, envName) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${envName} must be an integer port between 1 and 65535`)
  }
  return port
}

export function isInheritedProductionBridgePort(value) {
  if (value == null) return false
  const port = Number(value)
  return Number.isInteger(port) && port === Number(DEFAULT_PRODUCTION_BACKEND_PORT)
}

function resolveDevBackendPort(env) {
  if (env.OPENFORGE_BACKEND_PORT != null) {
    const port = parsePort(env.OPENFORGE_BACKEND_PORT, 'OPENFORGE_BACKEND_PORT')
    if (port !== Number(DEFAULT_PRODUCTION_BACKEND_PORT)) return String(port)
  }

  if (env.AI_COMMAND_CENTER_PORT != null && !isInheritedProductionBridgePort(env.AI_COMMAND_CENTER_PORT)) {
    return String(parsePort(env.AI_COMMAND_CENTER_PORT, 'AI_COMMAND_CENTER_PORT'))
  }

  return String(DEFAULT_DEV_BACKEND_PORT)
}

function resolveDevHttpPort(env, backendPort) {
  if (env.OPENFORGE_HTTP_PORT != null && !isInheritedProductionBridgePort(env.OPENFORGE_HTTP_PORT)) {
    return env.OPENFORGE_HTTP_PORT
  }

  return backendPort
}

export function computeCargoTargetDir({
  cwd = process.cwd(),
  env = process.env,
  execFileSync = defaultExecFileSync,
  rustSidecarLayout = null,
} = {}) {
  if (env.CARGO_TARGET_DIR) {
    return { cargoTargetDir: env.CARGO_TARGET_DIR, source: 'env' }
  }

  try {
    const gitCommonDir = resolveGitCommonDir(
      cwd,
      String(
        execFileSync('git', ['rev-parse', '--git-common-dir'], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      ).trim(),
    )

    return {
      cargoTargetDir: sharedCargoTargetDirFromGitCommonDir(gitCommonDir),
      source: 'git-common-dir',
    }
  } catch {
    const layout = rustSidecarLayout ?? resolveRustSidecarLayout({ repoRoot: cwd })
    return {
      cargoTargetDir: layout.defaultCargoTargetDir,
      source: 'fallback',
    }
  }
}

export function buildElectronSidecarDevEnv(options = {}) {
  const env = options.env ?? process.env
  const result = computeCargoTargetDir({ ...options, env })
  const backendPort = resolveDevBackendPort(env)

  return {
    ...result,
    env: {
      ...env,
      CARGO_TARGET_DIR: result.cargoTargetDir,
      OPENFORGE_BACKEND_PORT: backendPort,
      OPENFORGE_HTTP_PORT: resolveDevHttpPort(env, backendPort),
    },
  }
}
