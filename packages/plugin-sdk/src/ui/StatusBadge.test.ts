import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRawSnippet } from 'svelte'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import StatusBadge, { type StatusBadgeStatus } from './StatusBadge.svelte'

const pluginSdkRoot = process.cwd().endsWith('packages/plugin-sdk') ? process.cwd() : resolve(process.cwd(), 'packages/plugin-sdk')
const statusBadgeSource = readFileSync(resolve(pluginSdkRoot, 'src/ui/StatusBadge.svelte'), 'utf8')

const children = createRawSnippet(() => ({
  render: () => '<span>Status label</span>',
}))

const statuses: StatusBadgeStatus[] = [
  'pending',
  'failed',
  'success',
  'in-progress',
  'in-review',
  'submitted',
  'expired',
]

describe('plugin-sdk StatusBadge', () => {
  it.each(statuses)('renders the %s status with a semantic icon', (status) => {
    render(StatusBadge, {
      props: { children, status, role: 'status', title: 'Current status' },
    })

    const badge = screen.getByRole('status')
    expect(badge.textContent?.trim()).toBe('Status label')
    expect(badge.getAttribute('title')).toBe('Current status')
    expect(badge.getAttribute('data-status')).toBe(status)
    expect(badge.querySelector(`[data-status-icon="${status}"]`)).toBeTruthy()
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('rotates only the progress icon and disables it for reduced-motion users', () => {
    render(StatusBadge, { props: { children, status: 'in-progress' } })

    const icon = screen.getByText('Status label').closest('[data-status-badge]')?.querySelector('svg')
    expect(icon?.classList.contains('status-badge-icon--spinning')).toBe(true)
    expect(icon?.classList.contains('motion-reduce:animate-none')).toBe(true)
  })

  it.each([
    ['pending', '#fffbeb', '#b45309', 'rgb(217 119 6 / 20%)'],
    ['failed', '#fff1f2', '#be123c', 'rgb(225 29 72 / 20%)'],
    ['success', '#ecfdf5', '#047857', 'rgb(5 150 105 / 20%)'],
    ['in-progress', '#f0f9ff', '#0369a1', 'rgb(2 132 199 / 20%)'],
    ['in-review', '#f5f3ff', '#6d28d9', 'rgb(124 58 237 / 20%)'],
    ['submitted', '#eef2ff', '#4338ca', 'rgb(79 70 229 / 20%)'],
    ['expired', '#f5f5f5', '#525252', 'rgb(115 115 115 / 20%)'],
  ] as const)('matches Spectrum\'s %s light palette', (status, background, foreground, ring) => {
    expect(statusBadgeSource).toContain(`span[data-status='${status}']`)
    expect(statusBadgeSource).toContain(`--status-badge-background: ${background}`)
    expect(statusBadgeSource).toContain(`--status-badge-foreground: ${foreground}`)
    expect(statusBadgeSource).toContain(`--status-badge-ring: ${ring}`)
  })

  it.each([
    ['pending', 'rgb(251 191 36 / 10%)', '#fcd34d', 'rgb(252 211 77 / 25%)'],
    ['failed', 'rgb(251 113 133 / 10%)', '#fda4af', 'rgb(253 164 175 / 25%)'],
    ['success', 'rgb(52 211 153 / 10%)', '#6ee7b7', 'rgb(110 231 183 / 25%)'],
    ['in-progress', 'rgb(56 189 248 / 10%)', '#7dd3fc', 'rgb(125 211 252 / 25%)'],
    ['in-review', 'rgb(167 139 250 / 10%)', '#c4b5fd', 'rgb(196 181 253 / 25%)'],
    ['submitted', 'rgb(129 140 248 / 10%)', '#a5b4fc', 'rgb(165 180 252 / 25%)'],
    ['expired', 'rgb(163 163 163 / 10%)', '#d4d4d4', 'rgb(212 212 212 / 20%)'],
  ] as const)('matches Spectrum\'s %s dark palette', (status, background, foreground, ring) => {
    expect(statusBadgeSource).toContain(`:global([data-theme-appearance='dark']) span[data-status='${status}']`)
    expect(statusBadgeSource).toContain(`--status-badge-background: ${background}`)
    expect(statusBadgeSource).toContain(`--status-badge-foreground: ${foreground}`)
    expect(statusBadgeSource).toContain(`--status-badge-ring: ${ring}`)
  })

})
