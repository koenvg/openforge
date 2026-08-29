import { createRequire } from 'node:module'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

export type LoadedBackendModule = {
  exports: Record<string, unknown>
  release(): void
}

function releaseCommonJsModule(module: NodeJS.Module, visited = new Set<string>()): void {
  if (visited.has(module.filename)) return
  visited.add(module.filename)
  for (const child of [...module.children]) releaseCommonJsModule(child, visited)
  const parent = module.parent
  if (parent) {
    const childIndex = parent.children.indexOf(module)
    if (childIndex >= 0) parent.children.splice(childIndex, 1)
  }
  module.children.length = 0
  delete require.cache[module.filename]
}

function releaseModulesAddedAfter(cacheSnapshot: ReadonlySet<string>): void {
  for (const modulePath of Object.keys(require.cache)) {
    if (cacheSnapshot.has(modulePath)) continue
    const loadedModule = require.cache[modulePath]
    if (loadedModule) releaseCommonJsModule(loadedModule)
  }
}

function normalizeCommonJsExports(exports: unknown): Record<string, unknown> {
  if (typeof exports === 'object' && exports !== null && Object.hasOwn(exports, 'default')) {
    return exports as Record<string, unknown>
  }
  return { default: exports }
}

let esmImportGeneration = 0

// ESM caches cannot be cleared in-process. The production host releases this graph by
// terminating the plugin's worker; the generation only supports direct runtime tests and retries.
async function loadEsmBackendModule(backendPath: string): Promise<LoadedBackendModule> {
  const moduleUrl = pathToFileURL(backendPath)
  moduleUrl.searchParams.set('openforgeReload', String(++esmImportGeneration))
  const exports = await import(moduleUrl.href) as Record<string, unknown>
  return { exports, release() {} }
}

export async function loadBackendModule(backendPath: string): Promise<LoadedBackendModule> {
  const extension = extname(backendPath)
  if (extension === '.js' || extension === '.mjs') {
    return await loadEsmBackendModule(backendPath)
  }
  if (extension !== '.cjs') {
    throw new Error(`Backend entry must be a JavaScript .js, .mjs, or .cjs bundle: ${backendPath}`)
  }

  const resolvedPath = require.resolve(backendPath)
  const cacheSnapshot = new Set(Object.keys(require.cache))
  delete require.cache[resolvedPath]

  let exports: unknown
  try {
    exports = require(resolvedPath) as unknown
  } catch (error) {
    releaseModulesAddedAfter(cacheSnapshot)
    throw error
  }

  const entryModule = require.cache[resolvedPath]
  let released = false
  return {
    exports: normalizeCommonJsExports(exports),
    release() {
      if (released) return
      released = true
      if (entryModule) {
        releaseCommonJsModule(entryModule)
      } else {
        releaseModulesAddedAfter(cacheSnapshot)
      }
    },
  }
}
