import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { collectFileTreeDirectoryPaths } from './fileTreeModel'

export class FileTreeNavigationState {
  selectedFilename = $state<string | null>(null)
  expandedDirectories = $state<Set<string>>(new Set())

  constructor(files: readonly PrFileDiff[] = []) {
    this.expandAll(files)
  }

  expandAll(files: readonly PrFileDiff[]) {
    this.expandedDirectories = collectFileTreeDirectoryPaths(files)
  }

  select(filename: string) {
    this.selectedFilename = filename
  }

  activeFilename(visibleFilenames: readonly string[]): string | null {
    if (this.selectedFilename && visibleFilenames.includes(this.selectedFilename)) {
      return this.selectedFilename
    }
    return visibleFilenames[0] ?? null
  }

  selectByOffset(visibleFilenames: readonly string[], offset: number): string | null {
    if (visibleFilenames.length === 0) return null

    const currentIndex = this.selectedFilename
      ? visibleFilenames.indexOf(this.selectedFilename)
      : -1
    const nextIndex = currentIndex === -1
      ? (offset > 0 ? 0 : visibleFilenames.length - 1)
      : currentIndex + offset
    if (nextIndex < 0 || nextIndex >= visibleFilenames.length) return null

    const nextFilename = visibleFilenames[nextIndex]
    if (nextFilename === this.selectedFilename) return null
    this.selectedFilename = nextFilename
    return nextFilename
  }

  toggleDirectory(path: string) {
    const expandedDirectories = new Set(this.expandedDirectories)
    if (expandedDirectories.has(path)) {
      expandedDirectories.delete(path)
    } else {
      expandedDirectories.add(path)
    }
    this.expandedDirectories = expandedDirectories
  }

  setSelectedParentExpanded(expanded: boolean): boolean {
    if (!this.selectedFilename) return false

    const parts = this.selectedFilename.split('/')
    if (parts.length < 2) return false

    const parentPath = parts.slice(0, -1).join('/')
    const expandedDirectories = new Set(this.expandedDirectories)
    if (expanded) {
      expandedDirectories.add(parentPath)
    } else {
      expandedDirectories.delete(parentPath)
    }
    this.expandedDirectories = expandedDirectories
    return true
  }
}
