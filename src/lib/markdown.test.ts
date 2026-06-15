import { describe, expect, it } from 'vitest'
import { renderMarkdownHtml, resolveMarkdownImageSrc } from './markdown'
import {
  renderMarkdownHtml as renderPluginSdkMarkdownHtml,
  resolveMarkdownImageSrc as resolvePluginSdkMarkdownImageSrc,
} from '@openforge/plugin-sdk/markdown'

describe('app markdown rendering ownership', () => {
  it('uses the plugin SDK markdown implementation as the shared owner', () => {
    expect(renderMarkdownHtml).toBe(renderPluginSdkMarkdownHtml)
    expect(resolveMarkdownImageSrc).toBe(resolvePluginSdkMarkdownImageSrc)
  })
})
