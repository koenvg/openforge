import { FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND } from './frontendHostRequestProtocol.js'

export const LIST_BROWSER_SESSION_PURGE_INTENTS_COMMAND = 'list_browser_session_purge_intents'
export const ACKNOWLEDGE_BROWSER_SESSION_PURGE_INTENT_COMMAND = 'acknowledge_browser_session_purge_intent'

export const internalSidecarCommandRegistrations = [
  { ipcCommand: LIST_BROWSER_SESSION_PURGE_INTENTS_COMMAND, domain: 'plugins' },
  { ipcCommand: ACKNOWLEDGE_BROWSER_SESSION_PURGE_INTENT_COMMAND, domain: 'plugins' },
  { ipcCommand: FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND, domain: 'plugins' },
] as const
