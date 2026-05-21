import { defineConfig } from 'vitest/config'

const sourceAlias = (path: string) => new URL(path, import.meta.url).pathname

export default defineConfig({
  resolve: {
    alias: {
      '@openforge/plugin-sdk/frontend': sourceAlias('./src/frontend.ts'),
      '@openforge/plugin-sdk/backend': sourceAlias('./src/backend.ts'),
      '@openforge/plugin-sdk/testing': sourceAlias('./src/testing.ts'),
      '@openforge/plugin-sdk/vite': sourceAlias('./src/vite.ts'),
      '@openforge/plugin-sdk/domain': sourceAlias('./src/domain.ts'),
      '@openforge/plugin-sdk/markdown': sourceAlias('./src/markdown.ts'),
      '@openforge/plugin-sdk/numberParsing': sourceAlias('./src/numberParsing.ts'),
      '@openforge/plugin-sdk/sanitize': sourceAlias('./src/sanitize.ts'),
      '@openforge/plugin-sdk/ui/MarkdownContent.svelte': sourceAlias('./src/ui/MarkdownContent.svelte'),
      '@openforge/plugin-sdk/ui/ResizablePanel.svelte': sourceAlias('./src/ui/ResizablePanel.svelte'),
      '@openforge/plugin-sdk': sourceAlias('./src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
