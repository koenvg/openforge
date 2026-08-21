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
    color: 'var(--success)',
    textClass: 'text-success',
    label: 'Added',
    badgeClass: 'text-success border-success/45 bg-success/5',
  },
  removed: {
    icon: '−',
    color: 'var(--error)',
    textClass: 'text-error',
    label: 'Deleted',
    badgeClass: 'text-error border-error/45 bg-error/5',
  },
  modified: {
    icon: '±',
    color: 'var(--warning)',
    textClass: 'text-warning',
    label: 'Modified',
    badgeClass: 'text-primary border-primary/45 bg-primary/5',
  },
  renamed: {
    icon: '→',
    color: 'var(--accent)',
    textClass: 'text-primary',
    label: 'Renamed',
    badgeClass: 'text-info border-info/45 bg-info/5',
  },
} as const satisfies Record<string, FileStatusPresentation>

const UNKNOWN_FILE_STATUS_PRESENTATION = {
  icon: '•',
  color: 'var(--text-secondary)',
  textClass: 'text-base-content/50',
  badgeClass: 'text-base-content/60 border-base-300 bg-base-200',
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
