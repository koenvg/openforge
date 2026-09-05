import type { Meta, StoryObj } from '@storybook/svelte-vite'
import ThemeFixture from '../../shared/ThemeFixture.svelte'

const meta = {
  title: 'Pages/Catalog ready',
  component: ThemeFixture,
  args: {
    catalog: 'Pages Storybook',
  },
} satisfies Meta<ThemeFixture>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}
