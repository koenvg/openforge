import type { Snippet } from 'svelte'
import type { Props as LoadingProps } from './LoadingIndicator'
import type { Props as AlertProps } from './Alert'
import type { Props as ProgressProps } from './Progress'

declare const children: Snippet

const loading: LoadingProps[] = [
  { decorative: true, size: 'xs', title: 'Loading', class: 'plugin-owned' },
  { 'aria-label': 'Loading records', size: 'sm' },
  { 'aria-labelledby': 'loading-label', size: 'md', role: 'status', 'aria-live': 'off' },
  { decorative: false, 'aria-label': 'Loading', size: 'lg' },
]
const alerts: AlertProps[] = ['neutral', 'info', 'success', 'warning', 'danger'].map(variant => ({
  children, variant: variant as AlertProps['variant'], role: 'status', 'aria-live': 'polite',
}))
const progress: ProgressProps[] = [
  { value: 25, max: 50, 'aria-label': 'Download', variant: 'primary' },
  { id: 'download', 'aria-labelledby': 'download-label', variant: 'neutral' },
  ...(['info', 'success', 'warning', 'danger'] as const).map(variant => ({ variant })),
]
// @ts-expect-error No inventoried extra-large loading indicator.
const tooLarge: LoadingProps = { size: 'xl' }
// @ts-expect-error No undocumented alert urgency variant.
const urgent: AlertProps = { children, variant: 'urgent' }
// @ts-expect-error Alert content is required.
const empty: AlertProps = { variant: 'danger' }
// @ts-expect-error Progress has only its inventoried bar height.
const largeProgress: ProgressProps = { size: 'lg' }
void [loading, alerts, progress, tooLarge, urgent, empty, largeProgress]
