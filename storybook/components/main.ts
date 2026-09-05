import { createStorybookConfig } from '../shared/main.ts'

export default createStorybookConfig([
  '../stories/components/**/*.stories.@(js|ts|svelte)',
])
