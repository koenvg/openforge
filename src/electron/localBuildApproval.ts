import type { MessageBoxOptions } from 'electron'
import type { UpdateAuthorization } from './updateAuthorization.js'

export function localBuildApprovalPrompt(request: Readonly<UpdateAuthorization>): MessageBoxOptions {
  if (request.source !== 'local-build') throw new Error('Local approval cannot substitute for publisher verification')
  return {
    type: 'warning', title: 'Approve a local OpenForge build?',
    message: 'Trust this exact local build for this update?',
    detail: `This build is not verified by the release publisher. Approve it only if you trust the source and build process.\n\nInstallation: ${request.installedBundlePath}\nBuild identity: ${request.manifestSha256}\n\nApproval applies only to this build and update operation. It does not approve interruption of existing sessions; first adoption requires a separate confirmation.`,
    buttons: ['Approve this local build', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
  }
}

/** Runs only in the trusted Electron main process. Closing or cancelling denies approval. */
export async function confirmNativeLocalBuild(request: Readonly<UpdateAuthorization>): Promise<'approve' | 'cancel'> {
  const { dialog } = await import('electron')
  const result = await dialog.showMessageBox(localBuildApprovalPrompt(request))
  return result.response === 0 ? 'approve' : 'cancel'
}
