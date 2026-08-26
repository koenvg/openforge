export const WORKSPACE_TEST_ROOTS = ['apps', 'packages', 'plugins'] as const
export const WORKSPACE_TEST_EXTENSIONS = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx'] as const
export const WORKSPACE_TEST_IGNORED_DIRECTORIES = ['node_modules', 'dist', 'build', 'coverage', '.svelte-kit', 'target'] as const

const workspaceRootGlob = `{${WORKSPACE_TEST_ROOTS.join(',')}}`
const testExtensionGlob = `{${WORKSPACE_TEST_EXTENSIONS.join(',')}}`

export const WORKSPACE_TEST_SUITE_GLOB = `${workspaceRootGlob}/*/**/*.{test,spec}.${testExtensionGlob}`
export const WORKSPACE_TEST_SUITE_EXCLUDES = WORKSPACE_TEST_IGNORED_DIRECTORIES
  .map((directory) => `**/${directory}/**`)

export const SPECIALIZED_WORKSPACE_TEST_PROJECTS = {
  pluginSdk: {
    name: 'plugin-sdk',
    suiteGlob: `packages/plugin-sdk/**/*.{test,spec}.${testExtensionGlob}`,
  },
  pluginRuntime: {
    name: 'plugin-runtime',
    suiteGlob: `packages/plugin-runtime/**/*.{test,spec}.${testExtensionGlob}`,
  },
} as const

export function isWorkspaceTestSuiteFile(fileName: string): boolean {
  const parts = fileName.split('.')
  if (parts.length < 3) return false

  const suiteMarker = parts.at(-2)
  const extension = parts.at(-1)
  return (suiteMarker === 'test' || suiteMarker === 'spec')
    && WORKSPACE_TEST_EXTENSIONS.includes(extension as typeof WORKSPACE_TEST_EXTENSIONS[number])
}
