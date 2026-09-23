import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import AuthoredPrCard from '../../../packages/pr-review-ui/src/AuthoredPrCard.svelte'
import { authoredReviewRequest } from '../../shared/fixtures/githubSyncReviewFixtures'

const meta = {
  title: 'Components/Authored Pull Request Card', component: AuthoredPrCard,
  args: { pr: authoredReviewRequest, selected: false, onClick: fn() },
} satisfies Meta<typeof AuthoredPrCard>
export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Polish the release checklist')).toBeVisible()
    await expect(canvas.getByText('CI Passed')).toBeVisible()
  },
}
