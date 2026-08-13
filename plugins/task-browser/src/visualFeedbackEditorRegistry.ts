import type { FrontendOpenForgeAPI, JsonValue } from '@openforge-app/plugin-sdk/frontend'
import {
  createVisualFeedbackEditor,
  type VisualFeedbackEditorState,
} from './visualFeedbackEditorState.svelte'

export const VISUAL_FEEDBACK_DRAFT_KEY = 'visualFeedbackDraftV1'
const editorsByApi = new WeakMap<FrontendOpenForgeAPI, Map<string, VisualFeedbackEditorState>>()

export function getTaskVisualFeedbackEditor(
  api: FrontendOpenForgeAPI,
  taskId: string,
  onError: (error: string | null) => void,
): VisualFeedbackEditorState {
  let taskEditors = editorsByApi.get(api)
  if (taskEditors === undefined) {
    taskEditors = new Map()
    editorsByApi.set(api, taskEditors)
  }

  let editor = taskEditors.get(taskId)
  if (editor === undefined) {
    const storage = api.storage.task(taskId)
    editor = createVisualFeedbackEditor({
      onError,
      persistence: {
        load: () => storage.get(VISUAL_FEEDBACK_DRAFT_KEY),
        save: draft => storage.set(VISUAL_FEEDBACK_DRAFT_KEY, draft as unknown as JsonValue),
        clear: () => storage.delete(VISUAL_FEEDBACK_DRAFT_KEY),
      },
    })
    taskEditors.set(taskId, editor)
  } else {
    editor.setErrorHandler(onError)
  }

  return editor
}
