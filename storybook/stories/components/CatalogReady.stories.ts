import type { Meta, StoryObj } from '@storybook/svelte-vite'
import ThemeFixture from '../../shared/ThemeFixture.svelte'

const meta = {
  title: 'Components/Catalog ready',
  component: ThemeFixture,
  args: {
    catalog: 'Components Storybook',
  },
} satisfies Meta<ThemeFixture>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}
