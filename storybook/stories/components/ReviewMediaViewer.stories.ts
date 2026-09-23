import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import MediaViewerDialog from '../../../packages/pr-review-ui/src/MediaViewerDialog.svelte'
import type { ReviewImageOpenRequest } from '../../../packages/pr-review-ui/src/reviewMedia'

function image(label: string, color: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="${color}"/><text x="400" y="250" text-anchor="middle" fill="white" font-family="sans-serif" font-size="42">${label}</text></svg>`)
}

const request: ReviewImageOpenRequest = {
  activeIndex: 0,
  items: [
    { kind: 'image', filename: 'review-screen.png', label: 'Before', alt: 'Review before image', src: image('Before', '#243256') },
    { kind: 'image', filename: 'review-screen-after.png', label: 'After', alt: 'Review after image', src: image('After', '#296a70') },
  ],
}
const meta = {
  title: 'Components/Review Media Viewer', component: MediaViewerDialog,
  args: { request, onClose: fn() },
} satisfies Meta<typeof MediaViewerDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Images: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('dialog', { name: 'Media preview' })).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Next media' }))
    await expect(body.getByRole('heading', { name: 'review-screen-after.png' })).toBeVisible()
  },
}
