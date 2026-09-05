import { createStorybookConfig } from '../shared/main.ts'

export default createStorybookConfig([
  '../stories/pages/**/*.stories.@(js|ts|svelte)',
])
