import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { orderFilesDepthFirst } from './fileTreeModel'

/**
 * Sort files in the depth-first, directories-before-files order used by FileTree.svelte.
 * Compact directory labels do not change the underlying traversal order.
 */
export function sortFilesAsTree(files: PrFileDiff[]): PrFileDiff[] {
  return orderFilesDepthFirst(files)
}
