import { forwardToSidecar } from './rustSidecarForwarder.js'
import type { ElectronInvokeDeps } from './backendBridge.js'

function payloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function isRepositoryAccessFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Cannot access repository path')
    || message.includes('Unable to read current working directory: Operation not permitted')
}

function normalizeSelectedPath(path: string): string {
  const trimmed = path.trim()
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/u, '')
  return withoutTrailingSeparators || trimmed
}

export async function forwardToSidecarWithRepositoryAccessRecovery(
  command: string,
  payload: unknown,
  deps: ElectronInvokeDeps,
): Promise<unknown> {
  try {
    return await forwardToSidecar(command, payload, deps)
  } catch (error) {
    const repoPath = payloadString(payload, 'repoPath')
    if (command !== 'start_implementation' || !repoPath || !deps.selectDirectory || !isRepositoryAccessFailure(error)) {
      throw error
    }

    const selectedPath = await deps.selectDirectory({
      defaultPath: repoPath,
      buttonLabel: 'Grant Access',
      message: 'OpenForge needs permission to access this repository folder before it can create a worktree.',
    })

    if (!selectedPath) {
      throw error
    }

    if (normalizeSelectedPath(selectedPath) !== normalizeSelectedPath(repoPath)) {
      throw new Error('Selected repository folder does not match the active project path. Update the project path first if you want to use a different repository.')
    }

    return forwardToSidecar(command, { ...(payload as Record<string, unknown>), repoPath: selectedPath }, deps)
  }
}
