import { describe, it, expect } from 'vitest'
import {
  getFileStatusIcon,
  getFileStatusColor,
  getFileStatusClass,
  getFileStatusLabel,
  getFileStatusPresentation,
} from '@openforge-app/pr-review-ui/fileStatus'

describe('getFileStatusPresentation', () => {
  it.each([
    ['added', 'Added', 'text-success border-success/45 bg-success/5'],
    ['removed', 'Deleted', 'text-error border-error/45 bg-error/5'],
    ['modified', 'Modified', 'text-primary border-primary/45 bg-primary/5'],
    ['renamed', 'Renamed', 'text-info border-info/45 bg-info/5'],
  ])('maps %s to its badge label and classes', (status, label, badgeClass) => {
    expect(getFileStatusPresentation(status)).toMatchObject({ label, badgeClass })
  })

  it('preserves unknown status labels and uses the fallback badge classes', () => {
    expect(getFileStatusPresentation('unknown')).toMatchObject({
      label: 'unknown',
      badgeClass: 'text-base-content/60 border-base-300 bg-base-200',
    })
  })
})

describe('fileStatus', () => {
  describe('getFileStatusIcon', () => {
    it('returns "+" for added status', () => {
      expect(getFileStatusIcon('added')).toBe('+')
    })

    it('returns "−" (Unicode minus U+2212) for removed status', () => {
      expect(getFileStatusIcon('removed')).toBe('−')
    })

    it('returns "±" for modified status', () => {
      expect(getFileStatusIcon('modified')).toBe('±')
    })

    it('returns "→" for renamed status', () => {
      expect(getFileStatusIcon('renamed')).toBe('→')
    })

    it('returns "•" for unknown status', () => {
      expect(getFileStatusIcon('unknown')).toBe('•')
    })
  })

  describe('getFileStatusColor', () => {
    it('returns "var(--success)" for added status', () => {
      expect(getFileStatusColor('added')).toBe('var(--success)')
    })

    it('returns "var(--error)" for removed status', () => {
      expect(getFileStatusColor('removed')).toBe('var(--error)')
    })

    it('returns "var(--warning)" for modified status', () => {
      expect(getFileStatusColor('modified')).toBe('var(--warning)')
    })

    it('returns "var(--accent)" for renamed status', () => {
      expect(getFileStatusColor('renamed')).toBe('var(--accent)')
    })

    it('returns "var(--text-secondary)" for unknown status', () => {
      expect(getFileStatusColor('unknown')).toBe('var(--text-secondary)')
    })
  })

  describe('getFileStatusClass', () => {
    it('returns "text-success" for added status', () => {
      expect(getFileStatusClass('added')).toBe('text-success')
    })

    it('returns "text-error" for removed status', () => {
      expect(getFileStatusClass('removed')).toBe('text-error')
    })

    it('returns "text-warning" for modified status', () => {
      expect(getFileStatusClass('modified')).toBe('text-warning')
    })

    it('returns "text-primary" for renamed status', () => {
      expect(getFileStatusClass('renamed')).toBe('text-primary')
    })

    it('returns "text-base-content/50" for unknown status', () => {
      expect(getFileStatusClass('unknown')).toBe('text-base-content/50')
    })
  })

  describe('getFileStatusLabel', () => {
    it('returns "Added" for added status', () => {
      expect(getFileStatusLabel('added')).toBe('Added')
    })

    it('returns "Deleted" for removed status', () => {
      expect(getFileStatusLabel('removed')).toBe('Deleted')
    })

    it('returns "Modified" for modified status', () => {
      expect(getFileStatusLabel('modified')).toBe('Modified')
    })

    it('returns "Renamed" for renamed status', () => {
      expect(getFileStatusLabel('renamed')).toBe('Renamed')
    })

    it('returns the status string unchanged for unknown status', () => {
      expect(getFileStatusLabel('unknown')).toBe('unknown')
    })
  })
})
