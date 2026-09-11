import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { createRawSnippet } from 'svelte'
import Button from '../../../packages/plugin-sdk/src/ui/Button.svelte'
import ButtonShowcase from './ButtonShowcase.svelte'

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: createRawSnippet(() => ({ render: () => '<span>Create task</span>' })) },
} satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {}
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Outline: Story = { args: { variant: 'outline' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Destructive: Story = { args: { variant: 'destructive' } }
export const Link: Story = { args: { variant: 'link' } }
export const Disabled: Story = { args: { disabled: true } }
export const Loading: Story = { args: { loading: true, loadingLabel: 'Creating task' } }
export const AllVariants: Story = {
  render: () => ({ Component: ButtonShowcase }),
}
