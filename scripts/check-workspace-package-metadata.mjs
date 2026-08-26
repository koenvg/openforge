#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isPublishableWorkspacePackage, readWorkspacePackages } from './workspace-packages.mjs'

const SEE_LICENSE_PREFIX = 'SEE LICENSE IN '

function validateLicenseFile(packageDir, manifest, errors) {
  const license = typeof manifest.license === 'string' ? manifest.license.trim() : ''
  if (!license) return

  if (license === 'MIT') {
    if (!existsSync(join(packageDir, 'LICENSE'))) {
      errors.push(`${manifest.name} declares MIT but does not include a package-local LICENSE file.`)
    }
    return
  }

  if (license.startsWith(SEE_LICENSE_PREFIX)) {
    const licensePath = license.slice(SEE_LICENSE_PREFIX.length).trim()
    if (!licensePath) {
      errors.push(`${manifest.name} has an empty SEE LICENSE IN reference.`)
      return
    }

    if (!existsSync(join(packageDir, licensePath))) {
      errors.push(`${manifest.name} points license metadata at ${licensePath}, but that file does not exist from the package directory.`)
    }
  }
}

export function validateWorkspacePackageMetadata(packages) {
  const errors = []

  for (const { packageDir, manifest } of packages) {
    const packageName = manifest.name || packageDir
    const isPrivate = manifest.private === true
    const hasLicense = typeof manifest.license === 'string' && manifest.license.trim().length > 0
    const hasPublishConfig = Boolean(manifest.publishConfig)
    const isPublishable = isPublishableWorkspacePackage(manifest)

    if (isPrivate && hasPublishConfig) {
      errors.push(`${packageName} is private but still declares publishConfig.`)
    }

    if (!isPrivate && !hasLicense) {
      errors.push(`${packageName} must either set private:true or declare an explicit license.`)
    }

    if (!isPrivate && !isPublishable) {
      errors.push(`${packageName} is public/non-private but lacks publishConfig; set publishConfig for an intentional npm package or private:true for an internal package.`)
    }

    validateLicenseFile(packageDir, { ...manifest, name: packageName }, errors)
  }

  return errors
}

export function formatMetadataErrors(errors) {
  return [
    'Workspace package metadata is ambiguous:',
    ...errors.map(error => `- ${error}`),
  ].join('\n')
}

export function main({ repoRoot = process.cwd(), log = console.log, error = console.error } = {}) {
  const packages = readWorkspacePackages(repoRoot)
  const errors = validateWorkspacePackageMetadata(packages)

  if (errors.length > 0) {
    error(formatMetadataErrors(errors))
    return 1
  }

  log(`Validated license/private metadata for ${packages.length} workspace package(s).`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
