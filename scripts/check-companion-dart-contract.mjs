#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const contractSource = await readFile(
  resolve(root, 'docs/contracts/companion-v1.openapi.json'),
  'utf8',
)
const contract = JSON.parse(contractSource)
const generated = await readFile(
  resolve(root, 'apps/mobile_companion/lib/src/generated/companion_v1_client.dart'),
  'utf8',
)

const contractSha256 = createHash('sha256').update(contractSource).digest('hex')
if (!generated.includes(`'${contractSha256}'`)) {
  throw new Error(
    'Generated Dart Companion client fingerprint is stale. Regenerate it from companion-v1.openapi.json.',
  )
}

const operations = Object.values(contract.paths)
  .flatMap((path) => Object.values(path))
  .map((operation) => operation.operationId)
  .filter(Boolean)

const missing = operations.filter((operationId) => !generated.includes(operationId))
if (missing.length > 0) {
  throw new Error(`Generated Dart Companion client is missing operations: ${missing.join(', ')}`)
}

for (const [schemaName, schema] of Object.entries(contract.components.schemas)) {
  if (!Array.isArray(schema.required)) continue
  for (const field of schema.required) {
    if (!generated.includes(`'${field}'`) && !generated.includes(field)) {
      throw new Error(`Generated Dart Companion client is missing ${schemaName}.${field}`)
    }
  }
}

console.log(`Companion Dart contract is compatible (${operations.length} operations).`)
