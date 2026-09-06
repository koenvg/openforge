import { discoverCoverage } from './discovery.mjs'
import { exclusionProblem } from './exclusions.mjs'

/** @typedef {import('../../storybook/coverage-types.ts').CoverageTarget} CoverageTarget */
/** @param {CoverageTarget} target */
function key(target) { return `${target.source}#${target.contribution ?? ''}` }

/**
 * Validate adopted coverage; uncovered items remain explicit during incremental adoption.
 * @param {string} root
 * @param {unknown} inventory
 * @param {Record<'pages' | 'components', unknown>} indexes
 * @returns {import('../../storybook/coverage-types.ts').CoverageReport}
 */
export function checkCoverage(root, inventory, indexes) {
  const discovered = discoverCoverage(root)
  const targets = [...discovered.modules, ...discovered.contributions]
  const known = new Set(targets.map(key))
  /** @type {import('../../storybook/coverage-types.ts').CoverageReport} */
  const report = { errors: [], uncovered: targets, covered: 0, excluded: 0 }
  const catalogStories = new Map()
  for (const catalog of ['pages', 'components']) {
    const builtIndex = indexes[/** @type {'pages' | 'components'} */ (catalog)]
    const stories = new Set()
    if (!record(builtIndex) || builtIndex.v !== 5 || !record(builtIndex.entries)) {
      report.errors.push(`${catalog} catalog index: expected Storybook v5 entries; rebuild with pnpm storybook:build`)
    } else {
      for (const [id, entry] of Object.entries(builtIndex.entries)) {
        if (!record(entry) || entry.id !== id || !['story', 'docs'].includes(entry.type)) {
          report.errors.push(`${catalog} catalog index: malformed entry ${id}`)
        } else if (entry.type === 'story') stories.add(id)
      }
    }
    catalogStories.set(catalog, stories)
  }
  if (!record(inventory) || !['pages', 'components', 'exclusions'].every(group => Array.isArray(inventory[group]))) {
    report.errors.push('inventory: expected pages, components and exclusions arrays')
    return report
  }
  for (const field of Object.keys(inventory)) {
    if (!['pages', 'components', 'exclusions'].includes(field)) report.errors.push(`inventory: unknown field ${field}`)
  }
  const seen = new Map()
  const assigned = new Set()
  for (const group of ['pages', 'components', 'exclusions']) {
    for (const [index, entry] of inventory[group].entries()) {
      const label = `${group}[${index}] ${entry?.source ?? '<no source>'}${entry?.contribution ? ` (${entry.contribution})` : ''}`
      const startErrors = report.errors.length
      if (!record(entry)) {
        report.errors.push(`${label}: expected an inventory entry`)
        continue
      }
      const allowed = group === 'exclusions' ? ['source', 'kind', 'reason'] : ['source', 'contribution', 'stories']
      for (const field of Object.keys(entry)) {
        if (!allowed.includes(field)) report.errors.push(`${label}: unknown field ${field}`)
      }
      const target = { source: entry.source, contribution: entry.contribution }
      if (typeof entry.source !== 'string' || !known.has(key(target))) {
        report.errors.push(`${label}: invalid source or unknown contribution; use a discovered canonical source path`)
        continue
      }
      const identity = key(target)
      if (seen.has(identity)) report.errors.push(`${label}: duplicate assignment, already assigned in ${seen.get(identity)}`)
      seen.set(identity, group)
      if (group === 'exclusions') {
        if (entry.contribution !== undefined) report.errors.push(`${label}: cannot exclude a visual contribution`)
        else {
          if (typeof entry.reason !== 'string' || !entry.reason.trim()) report.errors.push(`${label}: expected non-empty reason`)
          try {
            const problem = exclusionProblem(root, entry.source, entry.kind, discovered.sourceFiles)
            if (problem) report.errors.push(`${label}: ${problem}`)
          } catch (error) {
            report.errors.push(`${label}: cannot verify exclusion: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      } else {
        if (entry.contribution !== undefined && group !== 'pages') report.errors.push(`${label}: visual contributions require the pages catalog`)
        if (!Array.isArray(entry.stories) || entry.stories.length === 0) {
          report.errors.push(`${label}: expected non-empty stories array`)
        } else {
          const storyIds = new Set()
          for (const story of entry.stories) {
            if (typeof story !== 'string' || !/^[a-z0-9][a-z0-9-]*--[a-z0-9][a-z0-9-]*$/.test(story)) report.errors.push(`${label}: invalid story ID ${JSON.stringify(story)}`)
            if (storyIds.has(story)) report.errors.push(`${label}: duplicate story ${story}`)
            storyIds.add(story)
            if (!catalogStories.get(group)?.has(story)) report.errors.push(`${label}: missing story ${story} in ${group} catalog index`)
          }
        }
      }
      if (report.errors.length === startErrors) {
        assigned.add(identity)
        if (group === 'exclusions') report.excluded++
        else report.covered++
      }
    }
  }
  report.uncovered = targets.filter(target => !assigned.has(key(target)))
  return report
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
