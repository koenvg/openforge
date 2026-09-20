export interface FileStatusPresentation {
  icon: string
  color: string
  textClass: string
  label: string
  badgeClass: string
}

const FILE_STATUS_PRESENTATIONS = {
  added: {
    icon: '+',
    color: 'var(--of-success)',
    textClass: 'text-of-success',
    label: 'Added',
    badgeClass: 'text-of-success border-of-success/45 bg-of-success/5',
  },
  removed: {
    icon: '−',
    color: 'var(--of-danger)',
    textClass: 'text-of-danger',
    label: 'Deleted',
    badgeClass: 'text-of-danger border-of-danger/45 bg-of-danger/5',
  },
  modified: {
    icon: '±',
    color: 'var(--of-warning)',
    textClass: 'text-of-warning',
    label: 'Modified',
    badgeClass: 'text-of-accent border-of-accent/45 bg-of-accent/5',
  },
  renamed: {
    icon: '→',
    color: 'var(--of-accent)',
    textClass: 'text-of-accent',
    label: 'Renamed',
    badgeClass: 'text-of-info border-of-info/45 bg-of-info/5',
  },
} as const satisfies Record<string, FileStatusPresentation>

const UNKNOWN_FILE_STATUS_PRESENTATION = {
  icon: '•',
  color: 'var(--of-text-muted)',
  textClass: 'text-of-text/50',
  badgeClass: 'text-of-text/60 border-of-border bg-of-surface-subtle',
} as const

export function getFileStatusPresentation(status: string): Readonly<FileStatusPresentation> {
  if (Object.hasOwn(FILE_STATUS_PRESENTATIONS, status)) {
    return FILE_STATUS_PRESENTATIONS[status as keyof typeof FILE_STATUS_PRESENTATIONS]
  }

  return { ...UNKNOWN_FILE_STATUS_PRESENTATION, label: status }
}

export function getFileStatusIcon(status: string): string {
  return getFileStatusPresentation(status).icon
}

export function getFileStatusColor(status: string): string {
  return getFileStatusPresentation(status).color
}

export function getFileStatusClass(status: string): string {
  return getFileStatusPresentation(status).textClass
}

export function getFileStatusLabel(status: string): string {
  return getFileStatusPresentation(status).label
}
