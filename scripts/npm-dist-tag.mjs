#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import semver from 'semver'

const SAFE_DIST_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

export function validateNpmDistTag(tag) {
  if (
    typeof tag !== 'string' ||
    !SAFE_DIST_TAG_PATTERN.test(tag) ||
    semver.validRange(tag) !== null
  ) {
    throw new Error(`Invalid npm dist-tag: ${JSON.stringify(tag)}`)
  }

  return tag
}

function main() {
  try {
    validateNpmDistTag(process.env.NPM_TAG)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
