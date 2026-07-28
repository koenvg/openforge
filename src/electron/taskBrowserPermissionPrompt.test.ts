import { describe, expect, it } from 'vitest'

import { taskBrowserPermissionPromptOptions } from './taskBrowserPermissionPrompt'


describe('Task Browser Permission prompt', () => {
  it('clearly identifies the requesting origin and exact permission with safe choices', () => {
    expect(taskBrowserPermissionPromptOptions({
      windowId: 10,
      origin: 'https://meet.example',
      descriptor: { permission: 'media', mediaTypes: ['audio'] },
      permissionLabel: 'Microphone',
    })).toEqual({
      type: 'question',
      title: 'Task Browser Permission',
      message: 'Allow https://meet.example to use Microphone?',
      detail: 'Requesting origin: https://meet.example\nPermission: Microphone',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      checkboxLabel: 'Remember for this Task',
      checkboxChecked: false,
    })
  })
})
