import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { identity } from './manifest.mjs'

const root = resolve(import.meta.dirname, '../..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const countBy = values =>
  Object.fromEntries(
    values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map()),
  )

describe('storybook visual coverage inventory', () => {
  it('accounts for every before identity and reconciles its replacements to the current manifest', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')
    const currentManifest = readJson('storybook/visual-manifest.json')
    const currentIds = new Set(currentManifest.map(identity))
    const inventoriedIds = inventory.cases.map(entry => entry.identity)
    const retainedIds = inventory.cases.filter(entry => entry.disposition === 'retained').map(entry => entry.identity)
    const replaced = inventory.cases.filter(entry => entry.disposition === 'replaced')
    const removedUpstream = inventory.cases.filter(entry => entry.disposition === 'removed-upstream')
    const replacementIds = new Set(replaced.map(entry => entry.appearanceCoverage))
    const addedIds = inventory.additionalSelections.map(entry => entry.identity)
    const historicalManifest = currentManifest.filter(entry => !addedIds.includes(identity(entry)))
    expect(new Set(addedIds).size).toBe(addedIds.length)

    expect(inventory.version).toBe(1)
    expect(inventoriedIds).toHaveLength(inventory.before.counts.total)
    expect(new Set(inventoriedIds).size).toBe(inventoriedIds.length)
    expect(new Set([...retainedIds, ...replacementIds, ...addedIds])).toEqual(currentIds)
    for (const entry of inventory.additionalSelections) {
      expect(currentIds.has(entry.identity), entry.identity).toBe(true)
      expect(entry.risk.trim(), entry.identity).not.toBe('')
      expect(entry.rationale.trim(), entry.identity).not.toBe('')
    }
    expect(new Set(removedUpstream.map(entry => entry.identity))).toEqual(
      new Set(inventory.integration.upstreamRemovedIdentities),
    )
    expect(inventory.integration.baseRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(inventory.integration.counts).toEqual({
      total: historicalManifest.length,
      catalogs: countBy(historicalManifest.map(entry => entry.catalog)),
      themes: countBy(historicalManifest.map(entry => entry.theme)),
      viewports: countBy(historicalManifest.map(entry => `${entry.viewport.width}x${entry.viewport.height}`)),
    })

    for (const entry of inventory.cases) {
      expect(entry.risk.trim()).not.toBe('')
      expect(entry.rationale.trim()).not.toBe('')
      if (entry.disposition === 'retained') {
        expect(currentIds.has(entry.identity), entry.identity).toBe(true)
        continue
      }
      if (entry.disposition === 'removed-upstream') {
        expect(currentIds.has(entry.identity), entry.identity).toBe(false)
        expect(entry.removedByRevision).toBe(inventory.integration.upstreamRemovalRevision)
        continue
      }

      expect(entry.disposition).toBe('replaced')
      expect(currentIds.has(entry.identity), entry.identity).toBe(false)
      expect(currentIds.has(entry.appearanceCoverage), entry.appearanceCoverage).toBe(true)

      const assertions = entry.behavioralAssertions ?? []
      expect(entry.appearanceCoverage || assertions.length, entry.identity).toBeTruthy()
      for (const assertion of assertions) {
        expect(existsSync(resolve(root, assertion.file)), assertion.file).toBe(true)
        expect(readFileSync(resolve(root, assertion.file), 'utf8')).toContain(assertion.test)
      }
    }
  })

  it('keeps replaced isolated stories and protected runner and regression identities', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')
    const currentIds = new Set(readJson('storybook/visual-manifest.json').map(identity))
    const taskListStorySource = 'storybook/stories/components/TaskListItem.stories.ts'

    for (const entry of inventory.cases.filter(entry => entry.disposition === 'replaced')) {
      const storySource = readFileSync(resolve(root, entry.storySource ?? taskListStorySource), 'utf8')
      expect(storySource).toContain(`export const ${entry.originalStoryExport}:`)
    }

    const protectedEntries = inventory.cases.filter(entry => entry.protectedBy?.length)
    expect(protectedEntries.length).toBeGreaterThan(0)
    for (const entry of protectedEntries) {
      expect(entry.disposition, entry.identity).toBe('retained')
      expect(currentIds.has(entry.identity), entry.identity).toBe(true)
    }
  })
  it('tracks page removals against reviewed appearance and surviving development stories', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')
    const currentIds = new Set(readJson('storybook/visual-manifest.json').map(identity))
    const pageRemovals = inventory.cases.filter(entry => entry.identity.startsWith('pages/') && entry.disposition === 'replaced')
    expect(pageRemovals.length).toBeGreaterThan(0)
    for (const entry of pageRemovals) {
      expect(entry.storySource, entry.identity).toMatch(/^storybook\/stories\/pages\/.*\.stories\.ts$/)
      expect(entry.originalStoryExport, entry.identity).toBeTruthy()
      expect(entry.rationale, entry.identity).not.toMatch(/later component and page curation/)
      expect(entry.appearanceCoverage, entry.identity).not.toBe(entry.identity)
      expect(currentIds.has(entry.appearanceCoverage), entry.identity).toBe(true)
      for (const match of entry.rationale.matchAll(/(?:pages|components)\/[a-z][a-z0-9-]+--[a-z0-9-]+--openforge-(?:light|dark)--\d+x\d+/g)) {
        expect(currentIds.has(match[0]), `${entry.identity}: ${match[0]}`).toBe(true)
      }
    }
  })

  it('records equivalent before and after timing environments and explicit image review decisions', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')

    expect(inventory.scope).toContain('KVG-5142')
    expect(
      inventory.cases.some(
        entry => entry.disposition === 'replaced' && !entry.behavioralAssertions?.length,
      ),
    ).toBe(true)
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
  it('documents every retained page family after curation', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')
    const currentPages = readJson('storybook/visual-manifest.json').filter(entry => entry.catalog === 'pages')
    const families = new Set(currentPages.map(entry => entry.story.split('--')[0]))
    expect(new Set([...Object.keys(inventory.pageSlice.retainedFamilies), ...Object.keys(inventory.additionalPageFamilies)])).toEqual(families)
    for (const reason of [...Object.values(inventory.pageSlice.retainedFamilies), ...Object.values(inventory.additionalPageFamilies)]) expect(reason.trim().length).toBeGreaterThan(25)
  })

  it('records the page slice timing and exact baseline deletions', () => {
    const inventory = readJson('storybook/visual-coverage-inventory.json')
    const manifest = readJson('storybook/visual-manifest.json')
    const removedPages = inventory.cases.filter(entry => entry.identity.startsWith('pages/') && entry.disposition === 'replaced').map(entry => entry.identity)
    const pageSlice = inventory.pageSlice
    expect(pageSlice.before.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(pageSlice.after.revision).toContain('working tree based on')
    expect(pageSlice.before.environment).toEqual(pageSlice.after.environment)
    expect(pageSlice.before.timing.status).toBe('passed')
    expect(pageSlice.after.timing.status).toBe('passed')
    const addedIds = new Set(inventory.additionalSelections.map(entry => entry.identity))
    const historicalManifest = manifest.filter(entry => !addedIds.has(identity(entry)))
    expect(pageSlice.after.counts).toEqual({ total: historicalManifest.length, pages: historicalManifest.filter(entry => entry.catalog === 'pages').length, components: historicalManifest.filter(entry => entry.catalog === 'components').length })
    expect(pageSlice.before.counts.total - pageSlice.after.counts.total).toBe(removedPages.length)
    expect(pageSlice.review.addedBaselines).toEqual([])
    expect(new Set(pageSlice.review.obsoleteBaselines)).toEqual(new Set(removedPages))
    expect(pageSlice.review.obsoleteBaselines).toHaveLength(removedPages.length)
    expect(pageSlice.review.decision.trim()).not.toBe('')
  })

})
