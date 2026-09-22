import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowDirectory = join(import.meta.dirname, '..', '.github', 'workflows')
const retiredMacosLabel = ['macos', '14'].join('-')

const expectedMacosLabels = new Map([
  ['ci.yml', Array(6).fill('macos-15')],
  ['mobile-release.yml', ['macos-15']],
  ['packaged-session-runtime.yml', ['macos-15', 'macos-15-intel']],
  ['release.yml', ['macos-15', 'macos-15-intel']],
  ['whisper-macos.yml', ['macos-15']],
])

async function readWorkflows() {
  const names = (await readdir(workflowDirectory))
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()

  return Promise.all(names.map(async (name) => [name, await readFile(join(workflowDirectory, name), 'utf8')]))
}

function explicitMacosLabels(workflow) {
  return [...workflow.matchAll(/^\s+(?:-\s+)?(?:runs-on|runner|platform): (macos-[a-z0-9-]+)\s*$/gm)]
    .map(([, label]) => label)
}

describe('macOS runner allocation', () => {
  it('does not request the retired macOS image', async () => {
    for (const [name, workflow] of await readWorkflows()) {
      expect(workflow, name).not.toContain(retiredMacosLabel)
    }
  })

  it('keeps the complete ARM and Intel runner inventory on the approved images', async () => {
    const actual = new Map(
      (await readWorkflows())
        .map(([name, workflow]) => [name, explicitMacosLabels(workflow)])
        .filter(([, labels]) => labels.length > 0),
    )

    expect(actual).toEqual(expectedMacosLabels)
  })
})
