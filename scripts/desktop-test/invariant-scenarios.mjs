import { runFirstAttachmentScenario } from './first-attachment-scenario.mjs'
import { runDetachDuringRecoveryScenario } from './detach-during-recovery-scenario.mjs'
import { runIdleResourceScenario } from './idle-resource-scenario.mjs'


export const invariantScenarioDefinitions = Object.freeze({
  'first-attachment': Object.freeze({
    mutating: true,
    run: runFirstAttachmentScenario,
  }),
  'detach-during-recovery': Object.freeze({
    mutating: true,
    run: runDetachDuringRecoveryScenario,
  }),
  'idle-resources': Object.freeze({
    mutating: false,
    run: runIdleResourceScenario,
  }),
})
