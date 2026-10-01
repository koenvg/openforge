import type { MessageBoxOptions } from 'electron'
import type { UpdateAuthorization } from './updateAuthorization.js'

export function firstAdoptionApprovalPrompt(request: Readonly<UpdateAuthorization>): MessageBoxOptions {
  if (!request.firstAdoption) throw new Error('First-adoption approval requires an installed bundle identity')
  return {
    type: 'warning', title: 'Stop sessions for first adoption?',
    message: 'This installation cannot preserve its existing sessions during this update.',
    detail: `Existing terminals, running agents and tool processes will stop. Save your work before continuing. Live-session preservation applies only after this first adoption.\n\nInstallation: ${request.installedBundlePath}\nInstalled build: ${request.firstAdoption.installedManifestSha256}\nTarget build: ${request.manifestSha256}\n\nThis is separate from trusting a local build. Approval applies only to this installation, these builds and this update operation.`,
    buttons: ['Approve interruption for this update', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
  }
}

/** Main-process native consent. Closing the dialog never approves interruption. */
export async function confirmNativeFirstAdoption(request: Readonly<UpdateAuthorization>): Promise<'approve' | 'cancel'> {
  const { dialog } = await import('electron')
  const result = await dialog.showMessageBox(firstAdoptionApprovalPrompt(request))
  return result.response === 0 ? 'approve' : 'cancel'
}
