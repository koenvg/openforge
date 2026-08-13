import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import {
  createVisualFeedbackEditor,
  type VisualFeedbackEditorState,
} from './visualFeedbackEditorState.svelte'

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
    editor = createVisualFeedbackEditor({ onError })
    taskEditors.set(taskId, editor)
  } else {
    editor.setErrorHandler(onError)
  }

  return editor
}
