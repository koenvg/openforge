import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function readPackageJson(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json')
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function isPublishableWorkspacePackage(manifest) {
  return manifest.private !== true && Boolean(manifest.publishConfig)
}

export function readWorkspacePackages(repoRoot = process.cwd()) {
  const packagesDir = join(repoRoot, 'packages')
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const packageDir = join(packagesDir, entry.name)
      return { packageDir, manifest: readPackageJson(packageDir) }
    })
    .sort((left, right) => String(left.manifest.name).localeCompare(String(right.manifest.name)))
}
