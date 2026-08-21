#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SDK_PACKAGE_NAME = '@openforge-app/plugin-sdk'

function singleVersionMatch(document, pattern, description) {
  const matches = [...document.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(
      `Plugin SDK authoring guide must contain exactly one ${description}; found ${matches.length}`,
    )
  }
  return matches[0][1]
}

export function assertPluginSdkDocVersion({ document, packageVersion }) {
  const dependencyVersion = singleVersionMatch(
    document,
    /"@openforge-app\/plugin-sdk"\s*:\s*"\^([^"]+)"/g,
    `${SDK_PACKAGE_NAME} dependency example`,
  )
  const guidanceVersion = singleVersionMatch(
    document,
    /current authoring release on npm is\s+`@openforge-app\/plugin-sdk@([^`]+)`/gi,
    `${SDK_PACKAGE_NAME} current-release statement`,
  )

  if (dependencyVersion !== packageVersion) {
    throw new Error(
      `${SDK_PACKAGE_NAME} dependency example uses ^${dependencyVersion}; expected ^${packageVersion}`,
    )
  }
  if (guidanceVersion !== packageVersion) {
    throw new Error(
      `${SDK_PACKAGE_NAME} current authoring release is ${guidanceVersion}; expected ${packageVersion}`,
    )
  }
}

async function main() {
  const repoRoot = join(import.meta.dirname, '..')
  const packageJson = JSON.parse(await readFile(
    join(repoRoot, 'packages/plugin-sdk/package.json'),
    'utf8',
  ))
  const document = await readFile(join(repoRoot, 'docs/plugin-authoring.md'), 'utf8')

  assertPluginSdkDocVersion({ document, packageVersion: packageJson.version })
  console.log(`Plugin SDK authoring guide matches ${SDK_PACKAGE_NAME}@${packageJson.version}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
