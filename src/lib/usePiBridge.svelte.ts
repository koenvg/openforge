import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { onDestroy } from 'svelte'

interface UsePiBridgeOptions {
  taskId: () => string
  onData: (data: string) => void
  onComplete?: (reason: string) => void
}

export function usePiBridge(options: UsePiBridgeOptions) {
  const taskId = $derived(options.taskId())
  const onData = $derived(options.onData)
  const onComplete = $derived(options.onComplete)

  let currentInstanceId: string | null = $state(null)
  let attachedTaskId: string | null = $state(null)
  let outputUnlisten: null | (() => void) = null
  let completeUnlisten: null | (() => void) = null

  const appWindow = getCurrentWebviewWindow()

  async function detachListeners() {
    outputUnlisten?.()
    completeUnlisten?.()
    outputUnlisten = null
    completeUnlisten = null
    attachedTaskId = null
    currentInstanceId = null
  }

  async function attachListeners(nextTaskId: string) {
    await detachListeners()

    outputUnlisten = await appWindow.listen<{ instance_id: number; data: string }>(
      `pi-output-${nextTaskId}`,
      (event) => {
        const instanceId = String(event.payload.instance_id)
        if (currentInstanceId === null) {
          currentInstanceId = instanceId
        }
        if (instanceId === currentInstanceId) {
          onData(event.payload.data)
        }
      },
    )

    completeUnlisten = await appWindow.listen<{ instance_id: number; reason: string }>(
      `pi-complete-${nextTaskId}`,
      (event) => {
        const instanceId = String(event.payload.instance_id)
        if (currentInstanceId === null) {
          currentInstanceId = instanceId
        }
        if (instanceId === currentInstanceId) {
          onComplete?.(event.payload.reason)
        }
      },
    )

    attachedTaskId = nextTaskId
  }

  $effect(() => {
    if (!taskId) {
      if (attachedTaskId !== null) {
        void detachListeners()
      }
      return
    }

    if (attachedTaskId !== taskId) {
      void attachListeners(taskId)
    }
  })

  onDestroy(() => {
    outputUnlisten?.()
    completeUnlisten?.()
    outputUnlisten = null
    completeUnlisten = null
    attachedTaskId = null
    currentInstanceId = null
  })
}
