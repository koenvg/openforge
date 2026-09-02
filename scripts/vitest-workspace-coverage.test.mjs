import { readdir } from 'node:fs/promises'
import { relative, resolve, matchesGlob } from 'node:path'
import { describe, expect, it } from 'vitest'

import vitestConfig from '../vitest.config.ts'
import {
  isWorkspaceTestSuiteFile,
  SPECIALIZED_WORKSPACE_TEST_PROJECTS,
  WORKSPACE_TEST_IGNORED_DIRECTORIES,
  WORKSPACE_TEST_ROOTS,
} from './vitest-workspace-policy.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..')
const IGNORED_DIRECTORIES = new Set(WORKSPACE_TEST_IGNORED_DIRECTORIES)

async function findTestSuites(directory) {
  const suites = []

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue

    const entryPath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      suites.push(...await findTestSuites(entryPath))
    } else if (isWorkspaceTestSuiteFile(entry.name)) {
      suites.push(relative(REPOSITORY_ROOT, entryPath))
    }
  }

  return suites
}

function projectIncludes(project, suitePath) {
  const include = project.test?.include ?? []
  const exclude = project.test?.exclude ?? []
  return include.some((pattern) => matchesGlob(suitePath, pattern))
    && !exclude.some((pattern) => matchesGlob(suitePath, pattern))
}

describe('root Vitest workspace coverage', () => {
  it('runs existing and future workspace suites in the renderer project by default', async () => {
    const existingSuites = (await Promise.all(
      WORKSPACE_TEST_ROOTS.map((workspaceRoot) => findTestSuites(resolve(REPOSITORY_ROOT, workspaceRoot))),
    )).flat()
    const representativeFutureSuites = [
      'apps/new-app/src/app.test.ts',
      'packages/new-package/test/contract.spec.mjs',
      'plugins/new-plugin/src/plugin.test.tsx',
    ]
    const projects = vitestConfig.test?.projects ?? []
    const rendererProject = projects.find((project) => project.test?.name === 'renderer')
    const specializedProjects = Object.values(SPECIALIZED_WORKSPACE_TEST_PROJECTS)
    const defaultSuites = [...existingSuites, ...representativeFutureSuites]
      .filter((suitePath) => !specializedProjects.some(({ suiteGlob }) => matchesGlob(suitePath, suiteGlob)))

    expect(rendererProject).toBeDefined()
    expect(defaultSuites.filter((suitePath) => !projectIncludes(rendererProject, suitePath))).toEqual([])
  })

  it('pairs every intentional renderer exclusion with its named project', () => {
    const projects = vitestConfig.test?.projects ?? []
    const rendererProject = projects.find((project) => project.test?.name === 'renderer')

    expect(rendererProject).toBeDefined()
    for (const { name, suiteGlob } of Object.values(SPECIALIZED_WORKSPACE_TEST_PROJECTS)) {
      const namedProject = projects.find((project) => project.test?.name === name)

      expect(rendererProject.test?.exclude).toContain(suiteGlob)
      expect(namedProject).toBeDefined()
      expect(namedProject.test?.include).toContain(suiteGlob)
    }
  })

  it('excludes dependency and generated test suites inside workspaces', () => {
    const generatedSuites = [
      'apps/website/node_modules/example/index.test.js',
      'packages/new-package/dist/index.test.js',
      'plugins/new-plugin/build/index.spec.mjs',
    ]
    const projects = vitestConfig.test?.projects ?? []
    const coveredGeneratedSuites = generatedSuites
      .filter((suitePath) => projects.some((project) => projectIncludes(project, suitePath)))

    expect(coveredGeneratedSuites).toEqual([])
  })

  it('reserves worker headroom for async test timers during full-suite runs', () => {
    expect(vitestConfig.test?.maxWorkers).toBe('60%')
  })

  it('runs every renderer suite in the thread pool', async () => {
    const projects = vitestConfig.test?.projects ?? []
    const rendererProject = projects.find((project) => project.test?.name === 'renderer')
    const selfReviewSuites = (await findTestSuites(resolve(REPOSITORY_ROOT, 'src/components/task-detail')))
      .filter((suitePath) => suitePath.includes('/SelfReviewView'))

    expect(rendererProject?.test?.pool).toBe('threads')
    expect(selfReviewSuites).not.toEqual([])

    for (const suitePath of selfReviewSuites) {
      const coveringProjects = projects
        .filter((project) => projectIncludes(project, suitePath))
        .map((project) => project.test?.name)

      expect(coveringProjects).toEqual(['renderer'])
    }
  })
})
