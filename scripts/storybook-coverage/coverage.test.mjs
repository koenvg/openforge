import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { discoverCoverage } from './discovery.mjs'
import { checkCoverage } from './coverage.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const roots = []
function repository(files) {
  const root = mkdtempSync(join(tmpdir(), 'storybook-coverage-'))
  roots.push(root)
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), contents)
  }
  return root
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

test('discovers host, shared-package and bundled-plugin modules and separate visual contributions', () => {
  const root = repository({
    'src/Page.svelte': '<h1>Page</h1>',
    'packages/controls/src/Button.svelte': '<button>Save</button>',
    'packages/controls/src/ButtonTestWrapper.svelte': '<p>Test wrapper</p>',
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'com.openforge.demo' } }),
    'plugins/demo/src/View.svelte': '<h1>Demo</h1>',
    'plugins/demo/src/index.ts': `import View from './View.svelte'
      api.views.register({ id: 'home', component: View })
      api.taskUI.registerTab({ id: 'detail', component: View })
      api.commands.register({ id: 'refresh', handler() {} })`,
    'plugins/demo/src/example.test.ts': `api.views.register({ id: 'test', component: View })`,
    'packages/controls/dist/Generated.svelte': '<p>Generated</p>',
    'src/node_modules/vendor/External.svelte': '<p>External</p>',
    'storybook/shared/Frame.svelte': '<p>Story-only</p>',
    'apps/website/src/Landing.svelte': '<h1>Separate app</h1>',
  })
  const found = discoverCoverage(root)
  expect(found.modules.map(item => item.source)).toEqual([
    'packages/controls/src/Button.svelte',
    'packages/controls/src/ButtonTestWrapper.svelte',
    'plugins/demo/src/View.svelte',
    'src/Page.svelte',
  ])
  expect(found.contributions).toEqual([
    { source: 'plugins/demo/src/index.ts', contribution: 'com.openforge.demo:taskUI.registerTab:detail' },
    { source: 'plugins/demo/src/index.ts', contribution: 'com.openforge.demo:views.register:home' },
  ])
})

const emptyInventory = () => ({ pages: [], components: [], exclusions: [] })
const indexes = {
  pages: { v: 5, entries: { 'pages-home--ready': { id: 'pages-home--ready', type: 'story' } } },
  components: { v: 5, entries: { 'components-button--primary': { id: 'components-button--primary', type: 'story' } } },
}

test('adopts pages and components but reports every unassigned module without failing incremental adoption', () => {
  const root = repository({
    'src/Page.svelte': '<h1>Home</h1>',
    'src/Button.svelte': '<button>Save</button>',
    'src/Other.svelte': '<p>Not adopted</p>',
  })
  const inventory = {
    ...emptyInventory(),
    pages: [{ source: 'src/Page.svelte', stories: ['pages-home--ready'] }],
    components: [{ source: 'src/Button.svelte', stories: ['components-button--primary'] }],
  }
  expect(checkCoverage(root, inventory, indexes)).toMatchObject({
    errors: [],
    uncovered: [{ source: 'src/Other.svelte' }],
    covered: 2,
    excluded: 0,
  })
})

test.each([
  ['missing source', { source: 'src/Missing.svelte', stories: ['pages-home--ready'] }, /invalid source/],
  ['traversal', { source: 'src/../src/Page.svelte', stories: ['pages-home--ready'] }, /invalid source/],
  ['absolute path', { source: '/src/Page.svelte', stories: ['pages-home--ready'] }, /invalid source/],
  ['wrong extension', { source: 'src/data.ts', stories: ['pages-home--ready'] }, /invalid source/],
  ['empty stories', { source: 'src/Page.svelte', stories: [] }, /non-empty stories/],
  ['duplicate stories', { source: 'src/Page.svelte', stories: ['pages-home--ready', 'pages-home--ready'] }, /duplicate story/],
  ['empty id', { source: 'src/Page.svelte', stories: [' '] }, /invalid story/],
  ['unknown fields', { source: 'src/Page.svelte', stories: ['pages-home--ready'], story: 'typo' }, /unknown field/],
])('rejects %s assignments', (_name, entry, diagnostic) => {
  const root = repository({ 'src/Page.svelte': '<h1>Home</h1>', 'src/data.ts': 'export const x = 1' })
  const result = checkCoverage(root, { ...emptyInventory(), pages: [entry] }, indexes)
  expect(result.errors.join('\n')).toMatch(diagnostic)
  expect(result.errors.join('\n')).toContain('pages')
  expect(result.uncovered).toContainEqual({ source: 'src/Page.svelte' })
})

test('rejects duplicate and conflicting module assignments across all inventory groups', () => {
  const root = repository({ 'src/Page.svelte': '<h1>Home</h1>' })
  const page = { source: 'src/Page.svelte', stories: ['pages-home--ready'] }
  const result = checkCoverage(root, {
    pages: [page, page],
    components: [{ source: 'src/Page.svelte', stories: ['components-button--primary'] }],
    exclusions: [{ source: 'src/Page.svelte', kind: 'nonvisual-provider', reason: 'No UI' }],
  }, indexes)
  expect(result.errors.filter(error => /duplicate assignment/.test(error))).toHaveLength(3)
})

test('rejects component-catalog assignments and exclusions for visual plugin contributions', () => {
  const root = repository({
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'demo' } }),
    'plugins/demo/src/View.svelte': '<p>View</p>',
    'plugins/demo/src/index.ts': `api.views.register({ id: 'home', component: View })`,
  })
  const target = { source: 'plugins/demo/src/index.ts', contribution: 'demo:views.register:home' }
  expect(checkCoverage(root, { ...emptyInventory(), pages: [{ ...target, stories: ['pages-home--ready'] }] }, indexes)).toMatchObject({ errors: [], covered: 1 })
  expect(checkCoverage(root, { ...emptyInventory(), components: [{ ...target, stories: ['components-button--primary'] }] }, indexes).errors.join('\n')).toContain('pages catalog')
  expect(checkCoverage(root, { ...emptyInventory(), exclusions: [{ ...target, kind: 'registration-shim', reason: 'Registration' }] }, indexes).errors.join('\n')).toContain('cannot exclude a visual contribution')
})

test.each([null, {}, { ...emptyInventory(), pages: 'wrong' }])('rejects malformed inventory without throwing: %j', inventory => {
  const root = repository({ 'src/Page.svelte': '<h1>Home</h1>' })
  expect(checkCoverage(root, inventory, indexes).errors.join('\n')).toContain('inventory')
})

test('allows only justified nonvisual providers, registration shims and test-only wrappers', () => {
  const root = repository({
    'src/Provider.svelte': '<script>let { children } = $props()</script>{@render children?.()}',
    'src/Registration.svelte': '<script>const register = () => {}; register()</script>',
    'src/ControlTestWrapper.svelte': '<button>Only in tests</button>',
    'src/Control.test.ts': `import Wrapper from './ControlTestWrapper.svelte'`,
  })
  const result = checkCoverage(root, { ...emptyInventory(), exclusions: [
    { source: 'src/Provider.svelte', kind: 'nonvisual-provider', reason: 'Forwards the child snippet without its own interface.' },
    { source: 'src/Registration.svelte', kind: 'registration-shim', reason: 'Registers lifecycle callbacks; renders nothing.' },
    { source: 'src/ControlTestWrapper.svelte', kind: 'test-only-wrapper', reason: 'Exercises snippet props in the control tests.' },
  ] }, indexes)
  expect(result).toMatchObject({ errors: [], uncovered: [], excluded: 3 })
})

test.each([
  ['empty reason', '<script>const x = 1</script>', 'nonvisual-provider', '  ', /non-empty reason/],
  ['unknown category', '', 'not-ready', 'Will add later', /exclusion kind/],
  ['visible provider', '<p>Visible UI</p>', 'nonvisual-provider', 'Wraps context', /independently visible/],
  ['component wrapper', '<Child />', 'registration-shim', 'Wraps a child', /independently visible/],
  ['dynamic markup', '{@html content}', 'nonvisual-provider', 'Generated content', /independently visible/],
  ['non-test wrapper', '<button>Save</button>', 'test-only-wrapper', 'Test wrapper', /test-only/],
])('rejects %s exclusions', (_name, contents, kind, reason, diagnostic) => {
  const root = repository({ 'src/Provider.svelte': contents })
  const result = checkCoverage(root, { ...emptyInventory(), exclusions: [{ source: 'src/Provider.svelte', kind, reason }] }, indexes)
  expect(result.errors.join('\n')).toMatch(diagnostic)
  expect(result.uncovered).toContainEqual({ source: 'src/Provider.svelte' })
})

test('test-like names cannot exclude UI used by production, including through another test-named wrapper', () => {
  const root = repository({
    'src/InnerTestWrapper.svelte': '<p>Visible</p>',
    'src/OuterTestWrapper.svelte': `<script>import Inner from './InnerTestWrapper.svelte'</script><Inner />`,
    'src/main.ts': `import Outer from './OuterTestWrapper.svelte'`,
  })
  const result = checkCoverage(root, { ...emptyInventory(), exclusions: [
    { source: 'src/InnerTestWrapper.svelte', kind: 'test-only-wrapper', reason: 'Looks like a test' },
  ] }, indexes)
  expect(result.errors.join('\n')).toContain('used by production')
})

test.each(['pages-missing--ready', 'pages-home--renamed'])('identifies missing or renamed story %s with its catalog and production source', story => {
  const root = repository({ 'src/Page.svelte': '<h1>Home</h1>' })
  const report = checkCoverage(root, { ...emptyInventory(), pages: [{ source: 'src/Page.svelte', stories: [story] }] }, indexes)
  expect(report.errors).toContain(`pages[0] src/Page.svelte: missing story ${story} in pages catalog index`)
  expect(report.uncovered).toContainEqual({ source: 'src/Page.svelte' })
})

test('does not accept a story from the other catalog or a docs entry as coverage', () => {
  const root = repository({ 'src/Page.svelte': '<h1>Home</h1>' })
  const inventory = { ...emptyInventory(), pages: [{ source: 'src/Page.svelte', stories: ['components-button--primary'] }] }
  expect(checkCoverage(root, inventory, indexes).errors.join('\n')).toContain('missing story components-button--primary in pages')
  const docsIndex = { ...indexes, pages: { v: 5, entries: { 'pages-home--ready': { id: 'pages-home--ready', type: 'docs' } } } }
  inventory.pages[0].stories = ['pages-home--ready']
  expect(checkCoverage(root, inventory, docsIndex).errors.join('\n')).toContain('missing story pages-home--ready')
})

test('missing contribution stories name the registration and contribution identity', () => {
  const root = repository({
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'demo' } }),
    'plugins/demo/src/index.ts': `api.views.register({ id: 'home', component: View })`,
  })
  const report = checkCoverage(root, { ...emptyInventory(), pages: [{
    source: 'plugins/demo/src/index.ts', contribution: 'demo:views.register:home', stories: ['pages-demo--deleted'],
  }] }, indexes)
  expect(report.errors).toContain('pages[0] plugins/demo/src/index.ts (demo:views.register:home): missing story pages-demo--deleted in pages catalog index')
})

test.each([null, {}, { v: 4, entries: {} }, { v: 5, entries: [] }, { v: 5, entries: { broken: null } }])('requires valid indexes for both catalogs even when one has no adopted entries: %j', index => {
  const root = repository({ 'src/Page.svelte': '<h1>Home</h1>' })
  const report = checkCoverage(root, emptyInventory(), { ...indexes, components: index })
  expect(report.errors.join('\n')).toContain('components catalog index')
})

test('a mismatched index key and id cannot validate a stale story', () => {
  const root = repository({ 'src/Page.svelte': '<h1>Home</h1>' })
  const report = checkCoverage(root, { ...emptyInventory(), pages: [{ source: 'src/Page.svelte', stories: ['pages-home--ready'] }] }, {
    ...indexes, pages: { v: 5, entries: { 'pages-home--ready': { id: 'pages-home--renamed', type: 'story' } } },
  })
  expect(report.errors.join('\n')).toContain('pages catalog index')
})

function runCoverage(root, ...args) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('./cli.mjs', import.meta.url)), '--root', root, ...args], { encoding: 'utf8' })
}

test('CLI reports uncovered modules, supports machine-readable output and opts into complete enforcement', () => {
  const root = repository({
    'src/Page.svelte': '<h1>Home</h1>',
    'storybook/coverage-inventory.mjs': `export default ${JSON.stringify(emptyInventory())}`,
    'storybook-static/pages/index.json': JSON.stringify(indexes.pages),
    'storybook-static/components/index.json': JSON.stringify(indexes.components),
  })
  const result = runCoverage(root)
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('UNCOVERED module src/Page.svelte')
  expect(result.stdout).toContain('incremental')
  expect(JSON.parse(runCoverage(root, '--json').stdout)).toMatchObject({ uncovered: [{ source: 'src/Page.svelte' }], errors: [] })
  const strict = runCoverage(root, '--enforce-complete')
  expect(strict.status).toBe(1)
  expect(strict.stdout).toContain('UNCOVERED module src/Page.svelte')
})

test('CLI fails adopted missing stories and names both missing index files with a rebuild command', () => {
  const root = repository({
    'src/Page.svelte': '<h1>Home</h1>',
    'storybook/coverage-inventory.mjs': `export default ${JSON.stringify({ ...emptyInventory(), pages: [{ source: 'src/Page.svelte', stories: ['pages-home--deleted'] }] })}`,
    'storybook-static/pages/index.json': JSON.stringify(indexes.pages),
    'storybook-static/components/index.json': JSON.stringify(indexes.components),
  })
  const missingStory = runCoverage(root)
  expect(missingStory.status).toBe(1)
  expect(missingStory.stdout).toContain('pages[0] src/Page.svelte: missing story pages-home--deleted')
  rmSync(join(root, 'storybook-static'), { recursive: true })
  const missingIndexes = runCoverage(root)
  expect(missingIndexes.status).toBe(1)
  expect(missingIndexes.stdout).toContain('storybook-static/pages/index.json')
  expect(missingIndexes.stdout).toContain('storybook-static/components/index.json')
  expect(missingIndexes.stdout).toContain('pnpm storybook:build')
})

test('discovers every visual registry, with quoted property names, in nested bundled-plugin source files', () => {
  const root = repository({
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'demo' } }),
    'plugins/demo/src/register.ts': `
      api.views['register']({ 'id': 'view', component: View })
      api.taskPane.registerTab({ id: 'pane', component: View })
      api.taskUI.registerTab({ id: 'tab', component: View })
      api.taskUI.registerSection({ id: 'status', component: View })
      api.reviewUI.registerRowAction({ id: 'row', component: View })
      api.settings.registerSection({ id: 'settings', component: View })
      api.injectionPoints.register({ id: 'injection', component: View })
      api.viewReplacements.register({ id: 'replacement', component: View })`,
  })
  expect(discoverCoverage(root).contributions.map(item => item.contribution)).toEqual([
    'demo:injectionPoints.register:injection',
    'demo:reviewUI.registerRowAction:row',
    'demo:settings.registerSection:settings',
    'demo:taskPane.registerTab:pane',
    'demo:taskUI.registerSection:status',
    'demo:taskUI.registerTab:tab',
    'demo:viewReplacements.register:replacement',
    'demo:views.register:view',
  ])
})

test.each([
  `api.views.register({ id: runtimeId, component: View })`,
  `api.views.register(createRegistration())`,
  `api.views.register({ id: 'home', ...overrides })`,
])('fails closed on unresolved contribution declarations: %s', declaration => {
  const root = repository({
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'demo' } }),
    'plugins/demo/src/index.ts': declaration,
  })
  expect(() => discoverCoverage(root)).toThrow(/plugins\/demo\/src\/index.ts.*static/)
})

test('rejects duplicate plugin contribution identities even across registration files', () => {
  const root = repository({
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'demo' } }),
    'plugins/demo/src/first.ts': `api.views.register({ id: 'home', component: View })`,
    'plugins/demo/src/second.ts': `api.views.register({ id: 'home', component: View })`,
  })
  expect(() => discoverCoverage(root)).toThrow(/duplicate contribution demo:views.register:home.*first.ts.*second.ts/)
})

test('discovers visual contributions declared in Svelte scripts and through local registry aliases', () => {
  const root = repository({
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'demo' } }),
    'plugins/demo/src/Registration.svelte': `<script lang="ts">
      const { views } = api
      const register = views.register
      register({ id: 'home', component: View })
    </script>`,
  })
  expect(discoverCoverage(root).contributions).toEqual([
    { source: 'plugins/demo/src/Registration.svelte', contribution: 'demo:views.register:home' },
  ])
})

test('nonvisual providers may compose other proven nonvisual modules but not visible children', () => {
  const root = repository({
    'src/Lifecycle.svelte': '<script>const register = () => {}; register()</script>',
    'src/Provider.svelte': `<script>import Lifecycle from './Lifecycle.svelte'; let { children } = $props()</script><Lifecycle />{@render children()}`,
  })
  const inventory = { ...emptyInventory(), exclusions: [{ source: 'src/Provider.svelte', kind: 'nonvisual-provider', reason: 'Provides lifecycle state to children without UI.' }] }
  expect(checkCoverage(root, inventory, indexes).errors).toEqual([])
  writeFileSync(join(root, 'src/Lifecycle.svelte'), '<p>Now visible</p>')
  expect(checkCoverage(root, inventory, indexes).errors.join('\n')).toContain('independently visible')
})

test('registration aliases resolve in their lexical scope, not unrelated functions or sibling blocks', () => {
  const root = repository({
    'plugins/demo/package.json': JSON.stringify({ openforge: { id: 'demo' } }),
    'plugins/demo/src/index.ts': `
      export function activate(api) {
        const views = api.views
        views.register({ id: 'home', component: View })
        {
          const register = api.taskUI.registerTab
          register({ id: 'detail', component: View })
        }
        { const register = [] }
      }
      function unrelated() { const views = [] }`,
  })
  expect(discoverCoverage(root).contributions.map(item => item.contribution)).toEqual([
    'demo:taskUI.registerTab:detail',
    'demo:views.register:home',
  ])
})
