import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { identity } from './manifest.mjs'

const root = resolve(import.meta.dirname, '../..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))

describe('storybook visual coverage inventory', () => {
  it('accounts for every before identity and reconciles its replacements to the current manifest', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')
    const currentIds = new Set(readJson('storybook/visual-manifest.json').map(identity))
    const inventoriedIds = inventory.cases.map(entry => entry.identity)
    const retainedIds = inventory.cases.filter(entry => entry.disposition === 'retained').map(entry => entry.identity)
    const replaced = inventory.cases.filter(entry => entry.disposition === 'replaced')
    const replacementIds = new Set(replaced.map(entry => entry.appearanceCoverage))

    expect(inventory.version).toBe(1)
    expect(inventoriedIds).toHaveLength(inventory.before.counts.total)
    expect(new Set(inventoriedIds).size).toBe(inventoriedIds.length)
    expect(new Set([...retainedIds, ...replacementIds])).toEqual(currentIds)

    for (const entry of inventory.cases) {
      expect(entry.risk.trim()).not.toBe('')
      expect(entry.rationale.trim()).not.toBe('')
      if (entry.disposition === 'retained') {
        expect(currentIds.has(entry.identity), entry.identity).toBe(true)
        continue
      }

      expect(entry.disposition).toBe('replaced')
      expect(currentIds.has(entry.identity), entry.identity).toBe(false)
      expect(currentIds.has(entry.appearanceCoverage), entry.appearanceCoverage).toBe(true)
      expect(entry.behavioralAssertions.length, entry.identity).toBeGreaterThan(0)
      for (const assertion of entry.behavioralAssertions) {
        expect(existsSync(resolve(root, assertion.file)), assertion.file).toBe(true)
        expect(readFileSync(resolve(root, assertion.file), 'utf8')).toContain(assertion.test)
      }
    }
  })

  it('keeps replaced isolated stories and protected runner and regression identities', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')
    const currentIds = new Set(readJson('storybook/visual-manifest.json').map(identity))
    const storySource = readFileSync(resolve(root, 'storybook/stories/components/TaskListItem.stories.ts'), 'utf8')

    for (const entry of inventory.cases.filter(entry => entry.disposition === 'replaced')) {
      expect(storySource).toContain(`export const ${entry.originalStoryExport}: Story`)
    }

    const protectedEntries = inventory.cases.filter(entry => entry.protectedBy?.length)
    expect(protectedEntries.length).toBeGreaterThan(0)
    for (const entry of protectedEntries) {
      expect(entry.disposition, entry.identity).toBe('retained')
      expect(currentIds.has(entry.identity), entry.identity).toBe(true)
    }
  })

  it('records equivalent before and after timing environments and explicit image review decisions', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')

    expect(inventory.selectionRules.length).toBeGreaterThan(0)
    expect(inventory.before.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(inventory.before.environment.containerImage).toContain('@sha256:')
    expect(inventory.before.timing.status).toBe('passed')
    expect(inventory.after.timing.status).toBe('passed')
    expect(inventory.after.environment).toEqual(inventory.before.environment)
    expect(inventory.after.counts.total).toBeLessThan(inventory.before.counts.total)
    expect(inventory.review.changedImages.sort()).toEqual(inventory.after.addedIdentities.sort())
    expect(inventory.review.obsoleteBaselines.sort()).toEqual(inventory.before.removedIdentities.sort())
    expect(inventory.review.decision.trim()).not.toBe('')
  })
})
