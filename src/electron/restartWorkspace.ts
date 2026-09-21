export interface RestartTaskTabs {
  taskId: string
  tabs: Array<{ index: number; key: string; label: string }>
  activeTabIndex: number
  nextIndex: number
}

export interface RestartWindowWorkspace {
  windowId: string
  navigation: { projectId: string | null; taskId: string | null; view: string; taskView?: string | null }
  tasks: RestartTaskTabs[]
}

export interface RestartWorkspace {
  version: 1
  installationId: string
  operationId: string
  windows: RestartWindowWorkspace[]
  restoredWindowIds: string[]
}

export interface RestartTerminalController {
  installation: string
  lifetime: string
  generation: number
}

export interface RestartTerminalInventory {
  controller: RestartTerminalController
  sessions: Array<{ key: string; instanceId: number; isLive: boolean }>
  hasLegacySessions?: boolean
  daemonRoot?: string
}

export interface RestartTerminalFence {
  controller: RestartTerminalController
  instanceId: number
}
