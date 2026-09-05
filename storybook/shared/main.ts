import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type { StorybookConfig } from '@storybook/svelte-vite'
import { mergeConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { createOpenForgePluginSdkSourceAliases } from '../../packages/plugin-sdk/src/vite.ts'
import { createDaisyUiTailwindPluginAliases } from '../../src/lib/viteDaisyUi.ts'

export function createStorybookConfig(stories: string[]): StorybookConfig {
  return {
    stories,
    addons: ['@storybook/addon-a11y'],
    framework: {
      name: '@storybook/svelte-vite',
      options: { docgen: false },
    },
    async viteFinal(config) {
      return mergeConfig(config, {
        plugins: [
          svelte({ configFile: fileURLToPath(new URL('../../svelte.config.js', import.meta.url)) }),
          tailwindcss(),
        ],
        resolve: {
          alias: [
            ...createOpenForgePluginSdkSourceAliases(new URL('../../', import.meta.url)),
            ...createDaisyUiTailwindPluginAliases(),
          ],
        },
      })
    },
  }
}
