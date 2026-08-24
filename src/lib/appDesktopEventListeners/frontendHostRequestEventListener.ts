import { FRONTEND_HOST_REQUEST_EVENT } from '../../electron/frontendHostRequestProtocol'
import { handleFrontendHostRequest } from '../frontendHostRequestBridge'
import {
  invokeFrontendAgentCommand,
  listFrontendAgentCommands,
} from '../plugin/pluginActivationLifecycle'
import { defineDesktopEventListener } from './types'

export function createFrontendHostRequestEventListener() {
  return defineDesktopEventListener(
    FRONTEND_HOST_REQUEST_EVENT,
    async (event) => handleFrontendHostRequest(event.payload, {
      list: listFrontendAgentCommands,
      invoke: invokeFrontendAgentCommand,
    }),
  )
}
