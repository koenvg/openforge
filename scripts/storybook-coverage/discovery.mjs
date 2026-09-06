import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverContributions } from './contributions.mjs'

const GENERATED = new Set(['node_modules', 'dist', 'build', 'coverage', 'target', '.svelte-kit', '.git'])

/** @param {string} path */
function directories(path) {
  try { return readdirSync(path, { withFileTypes: true }) }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return []
    throw error
  }
}

/** @param {string} root @param {string} path @returns {string[]} */
function files(root, path) {
  return directories(join(root, path)).flatMap(entry => {
    const child = `${path}/${entry.name}`
    if (entry.isDirectory() && !GENERATED.has(entry.name)) return files(root, child)
    return entry.isFile() ? [child] : []
  })
}

/** @param {string} source */
export function isTestSource(source) {
  return /(?:^|\/)(?:__tests__|test-fixtures|testing)(?:\/)|(?:\.test|\.spec|\.testFixture|TestWrapper|TestView|TestMock)(?:\.|\/)/.test(source)
}

/**
 * Scan source, never execute plugin activation or import production modules.
 * Contribution identity includes the registry so a view and tab may share a local ID.
 * @param {string} root
 */
export function discoverCoverage(root) {
  const host = files(root, 'src')
  const packages = directories(join(root, 'packages')).filter(entry => entry.isDirectory())
    .flatMap(entry => files(root, `packages/${entry.name}/src`))
  const plugins = directories(join(root, 'plugins')).filter(entry => entry.isDirectory())
  const pluginFiles = plugins.flatMap(entry => files(root, `plugins/${entry.name}/src`))
  const modules = [...host, ...packages, ...pluginFiles].filter(source => source.endsWith('.svelte'))
    .sort().map(source => ({ source }))
  /** @type {{source: string, contribution: string}[]} */
  const contributions = []
  for (const plugin of plugins) {
    const directory = `plugins/${plugin.name}`
    const metadata = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')).openforge
    if (!metadata?.id) throw new Error(`${directory}/package.json: missing openforge.id`)
    for (const source of pluginFiles.filter(path => path.startsWith(`${directory}/`) && /\.(?:svelte|[cm]?[jt]sx?)$/.test(path) && !isTestSource(path))) {
      contributions.push(...discoverContributions(source, readFileSync(join(root, source), 'utf8'), metadata.id))
    }
  }
  contributions.sort((a, b) => a.contribution.localeCompare(b.contribution))
  const seen = new Map()
  for (const item of contributions) {
    if (seen.has(item.contribution)) throw new Error(`duplicate contribution ${item.contribution}: ${seen.get(item.contribution)} and ${item.source}`)
    seen.set(item.contribution, item.source)
  }
  return { modules, contributions, sourceFiles: [...host, ...packages, ...pluginFiles] }
}
