export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number | null
  modifiedAt: number | null
}

export type FileContent =
  | { type: 'text'; content: string; size: number; mimeType: string | null }
  | { type: 'image'; content: string; size: number; mimeType: string | null }
  | { type: 'binary'; content: null; size: number; mimeType: string | null }
  | { type: 'document'; content: null; size: number; mimeType: string | null }
  | { type: 'large-file'; content: null; size: number; mimeType: string | null }
