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
    ['added', 'Added', 'text-of-success border-of-success/45 bg-of-success/5'],
    ['removed', 'Deleted', 'text-of-danger border-of-danger/45 bg-of-danger/5'],
    ['modified', 'Modified', 'text-of-accent border-of-accent/45 bg-of-accent/5'],
    ['renamed', 'Renamed', 'text-of-info border-of-info/45 bg-of-info/5'],
  ])('maps %s to its badge label and classes', (status, label, badgeClass) => {
    expect(getFileStatusPresentation(status)).toMatchObject({ label, badgeClass })
  })

  it('preserves unknown status labels and uses the fallback badge classes', () => {
    expect(getFileStatusPresentation('unknown')).toMatchObject({
      label: 'unknown',
      badgeClass: 'text-of-text/60 border-of-border bg-of-surface-subtle',
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
    it('returns the semantic success token for added status', () => {
      expect(getFileStatusColor('added')).toBe('var(--of-success)')
    })

    it('returns the semantic danger token for removed status', () => {
      expect(getFileStatusColor('removed')).toBe('var(--of-danger)')
    })

    it('returns the semantic warning token for modified status', () => {
      expect(getFileStatusColor('modified')).toBe('var(--of-warning)')
    })

    it('returns the semantic accent token for renamed status', () => {
      expect(getFileStatusColor('renamed')).toBe('var(--of-accent)')
    })

    it('returns the semantic muted text token for unknown status', () => {
      expect(getFileStatusColor('unknown')).toBe('var(--of-text-muted)')
    })
  })

  describe('getFileStatusClass', () => {
    it('returns the semantic success class for added status', () => {
      expect(getFileStatusClass('added')).toBe('text-of-success')
    })

    it('returns the semantic danger class for removed status', () => {
      expect(getFileStatusClass('removed')).toBe('text-of-danger')
    })

    it('returns the semantic warning class for modified status', () => {
      expect(getFileStatusClass('modified')).toBe('text-of-warning')
    })

    it('returns the semantic accent class for renamed status', () => {
      expect(getFileStatusClass('renamed')).toBe('text-of-accent')
    })

    it('returns a translucent semantic text class for unknown status', () => {
      expect(getFileStatusClass('unknown')).toBe('text-of-text/50')
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
