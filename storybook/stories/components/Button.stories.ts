import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { createRawSnippet } from 'svelte'
import Button from '../../../packages/plugin-sdk/src/ui/Button.svelte'

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: createRawSnippet(() => ({ render: () => '<span>Create task</span>' })) },
} satisfies Meta<typeof Button>
export default meta
export const Primary: StoryObj<typeof meta> = {}
