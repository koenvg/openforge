import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { checkCoverage } from './coverage.mjs'

try {
  const { values } = parseArgs({ options: {
    root: { type: 'string', default: fileURLToPath(new URL('../../', import.meta.url)) },
    json: { type: 'boolean', default: false },
    'enforce-complete': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } })
  if (values.help) {
    console.log('Usage: pnpm storybook:coverage [--json] [--enforce-complete] [--root <repository>]\nBuild both catalogs with pnpm storybook:build first. Uncovered UI is reported in incremental mode; invalid adopted entries always fail.')
  } else {
    const root = resolve(values.root)
    const errors = []
    /** @type {Record<'pages' | 'components', unknown>} */
    const indexes = { pages: null, components: null }
    for (const catalog of /** @type {const} */ (['pages', 'components'])) {
      const path = resolve(root, `storybook-static/${catalog}/index.json`)
      try { indexes[catalog] = JSON.parse(readFileSync(path, 'utf8')) }
      catch (error) { errors.push(`${catalog} catalog index ${path}: ${message(error)}; run pnpm storybook:build`) }
    }
    const inventoryPath = resolve(root, 'storybook/coverage-inventory.mjs')
    let inventory
    try { inventory = (await import(pathToFileURL(inventoryPath).href)).default }
    catch (error) { errors.push(`inventory ${inventoryPath}: ${message(error)}`) }
    /** @type {import('../../storybook/coverage-types.ts').CoverageReport} */
    let report = { errors: [], uncovered: [], covered: 0, excluded: 0 }
    try { report = checkCoverage(root, inventory, indexes) }
    catch (error) { errors.push(`discovery: ${message(error)}`) }
    report.errors.unshift(...errors)
    const complete = values['enforce-complete']
    if (values.json) console.log(JSON.stringify({ ...report, mode: complete ? 'complete' : 'incremental' }, null, 2))
    else {
      console.log(`Storybook coverage (${complete ? 'complete enforcement' : 'incremental adoption'}): ${report.covered} covered, ${report.excluded} excluded, ${report.uncovered.length} uncovered, ${report.errors.length} errors`)
      for (const error of report.errors) console.log(`ERROR ${error}`)
      for (const target of report.uncovered) {
        console.log(target.contribution
          ? `UNCOVERED pages contribution ${target.contribution} at ${target.source}`
          : `UNCOVERED module ${target.source} (assign to pages or components)`)
      }
    }
    if (report.errors.length || (complete && report.uncovered.length)) process.exitCode = 1
  }
} catch (error) {
  console.error(message(error))
  process.exitCode = 1
}

/** @param {unknown} error */
function message(error) { return error instanceof Error ? error.message : String(error) }
