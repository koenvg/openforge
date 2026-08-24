import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { generateCompanionDartClient } from './generate-companion-dart-client.mjs'

const root = new URL('../', import.meta.url)
const contractUrl = new URL('docs/contracts/companion-v1.openapi.json', root)
const generatedUrl = new URL(
  'apps/mobile_companion/lib/src/generated/companion_v1_client.dart',
  root,
)

describe('Companion OpenAPI Dart generator', () => {
  it('reproduces the checked-in client byte for byte', async () => {
    const [contractSource, checkedIn] = await Promise.all([
      readFile(contractUrl, 'utf8'),
      readFile(generatedUrl, 'utf8'),
    ])

    expect(generateCompanionDartClient(contractSource)).toEqual(checkedIn)
  })

  it('is deterministic and fingerprints the exact source bytes', async () => {
    const contractSource = await readFile(contractUrl, 'utf8')
    const first = generateCompanionDartClient(contractSource)
    const second = generateCompanionDartClient(contractSource)
    const fingerprint = createHash('sha256').update(contractSource).digest('hex')

    expect(first).toEqual(second)
    expect(first).toContain(`'${fingerprint}'`)
    expect(first).toContain('enum TaskStartOutcome')
    expect(first).toContain('final TaskStartOutcome outcome;')
    expect(first).toContain('List<String> labels = const <String>[]')
    expect(first).toContain(
      'List<TaskRelationship> dependencies = const <TaskRelationship>[]',
    )
    expect(first).toContain(
      'List<DependentTask> dependentTasks = const <DependentTask>[]',
    )
  })

  it('projects model fields, operations, and error codes from the contract', async () => {
    const contract = JSON.parse(await readFile(contractUrl, 'utf8'))
    contract.components.schemas.ErrorCode.enum.push('generator_probe_failed')
    contract.components.schemas.GeneratorProbe = {
      type: 'object',
      additionalProperties: false,
      required: ['probeId', 'label'],
      properties: {
        probeId: { type: 'string', minLength: 1 },
        label: { type: 'string', minLength: 1 },
      },
    }
    contract.paths['/generator-probes/{probeId}'] = {
      get: {
        operationId: 'getGeneratorProbe',
        parameters: [
          { $ref: '#/components/parameters/CompanionProtocolVersion' },
          {
            name: 'probeId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 },
          },
        ],
        security: [{ companionDeviceBearer: [] }],
        responses: {
          200: {
            description: 'Generator probe',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GeneratorProbe' },
              },
            },
          },
        },
      },
    }
    const source = `${JSON.stringify(contract, null, 2)}\n`
    const generated = generateCompanionDartClient(source)
    const fingerprint = createHash('sha256').update(source).digest('hex')

    expect(generated).toContain('final class GeneratorProbe')
    expect(generated).toContain('final String label;')
    expect(generated).toContain('Future<GeneratorProbe> getGeneratorProbe({')
    expect(generated).toContain('Uri.encodeComponent(probeId)')
    expect(generated).toContain("'generator_probe_failed'")
    expect(generated).toContain(`'${fingerprint}'`)
  })
  it('does not decode successful no-content operation responses', async () => {
    const contract = JSON.parse(await readFile(contractUrl, 'utf8'))
    const generated = generateCompanionDartClient(`${JSON.stringify(contract)}\n`)
    const operation = generated.match(
      /Future<void> refreshCompanionGithub\([\s\S]*?^  \}$/m,
    )?.[0]

    expect(operation).toContain(
      '_expectSuccessWithoutBody(response, const <int>{204});',
    )
    expect(operation).not.toContain('_successJson')
  })
})
