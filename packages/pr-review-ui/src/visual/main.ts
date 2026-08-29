import { mount } from 'svelte'
import '../../../../src/app.css'
import proseAndLists from '../visual-fixtures/prose-and-lists.md?raw'
import structuredContent from '../visual-fixtures/structured-content.md?raw'
import RichMarkdownDiffVisualHarness from './RichMarkdownDiffVisualHarness.svelte'

const fixtures = {
  'prose-and-lists': proseAndLists,
  'structured-content': structuredContent,
}

const params = new URLSearchParams(window.location.search)
const fixtureName = params.get('fixture') ?? 'prose-and-lists'
const theme = params.get('theme') === 'dark' ? 'openforge-dark' : 'openforge'
const content = fixtures[fixtureName as keyof typeof fixtures]

if (!content) throw new Error(`Unknown Markdown visual fixture: ${fixtureName}`)

document.documentElement.dataset.theme = theme

mount(RichMarkdownDiffVisualHarness, {
  target: document.getElementById('app')!,
  props: {
    content,
    filename: `${fixtureName}.md`,
  },
})
