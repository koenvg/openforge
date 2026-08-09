#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { generateCompanionDartClient } from './generate-companion-dart-client.mjs'

const root = resolve(import.meta.dirname, '..')
const contractSource = await readFile(
  resolve(root, 'docs/contracts/companion-v1.openapi.json'),
  'utf8',
)
const generatedPath = resolve(
  root,
  'apps/mobile_companion/lib/src/generated/companion_v1_client.dart',
)
const checkedIn = await readFile(generatedPath, 'utf8')
const expected = generateCompanionDartClient(contractSource)

if (checkedIn !== expected) {
  throw new Error(
    'Generated Dart Companion client is out of date. Run `pnpm mobile:contract:generate` and commit the result.',
  )
}

console.log('Companion Dart client matches the OpenAPI contract.')
