import presentationContract from '../../docs/contracts/action-palette-presentation.json'

export type TaskPaletteActionId =
  | 'start-task'
  | 'merge-pr'
  | 'enqueue-pr'
  | 'return-to-board'
  | 'delete-task'
  | 'complete-task'
  | 'set-aside-task'
  | 'run-app'

export type ProjectPaletteActionId = 'refresh-github'

export type ActionPaletteIcon =
  | 'play'
  | 'merge'
  | 'queue'
  | 'visibility'
  | 'delete'
  | 'complete'
  | 'visibility_off'
  | 'rocket'
  | 'refresh'
  | 'arrow_back'
  | 'search'
  | 'add'
  | 'switch'

export interface ActionPresentationMetadata {
  label: string
  keywords: readonly string[]
  icon: ActionPaletteIcon
  requiresConfirmation: boolean
  destructive: boolean
}

interface ContractActionPresentation extends ActionPresentationMetadata {
  id: string
  desktopId: string
}

function indexTaskPresentation(
  actions: readonly ContractActionPresentation[],
): ReadonlyMap<TaskPaletteActionId, ActionPresentationMetadata> {
  return new Map(actions.map((action) => [
    action.desktopId as TaskPaletteActionId,
    {
      label: action.label,
      keywords: action.keywords,
      icon: action.icon,
      requiresConfirmation: action.requiresConfirmation,
      destructive: action.destructive,
    },
  ]))
}

export const TASK_ACTION_PRESENTATION = indexTaskPresentation(
  presentationContract.taskActions as ContractActionPresentation[],
)

const PROJECT_ACTION_PRESENTATION = new Map<ProjectPaletteActionId, ActionPresentationMetadata>(
  (presentationContract.projectActions as ContractActionPresentation[]).map((action) => [
    action.desktopId as ProjectPaletteActionId,
    {
      label: action.label,
      keywords: action.keywords,
      icon: action.icon,
      requiresConfirmation: action.requiresConfirmation,
      destructive: action.destructive,
    },
  ]),
)

function requiredPresentation<ActionId extends string>(
  presentations: ReadonlyMap<ActionId, ActionPresentationMetadata>,
  actionId: ActionId,
): ActionPresentationMetadata {
  const presentation = presentations.get(actionId)
  if (!presentation) {
    throw new Error(`Missing Action Palette presentation metadata for ${actionId}`)
  }
  return presentation
}

export function getTaskActionPresentation(actionId: TaskPaletteActionId): ActionPresentationMetadata {
  return requiredPresentation(TASK_ACTION_PRESENTATION, actionId)
}

export function getProjectActionPresentation(actionId: ProjectPaletteActionId): ActionPresentationMetadata {
  return requiredPresentation(PROJECT_ACTION_PRESENTATION, actionId)
}
