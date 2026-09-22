import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const actionUrl = new URL('../.github/actions/native-impact/action.yml', import.meta.url)

it('collects native impact and retains JSON evidence even when classification fails', () => {
  const action = readFileSync(actionUrl, 'utf8')

  for (const output of ['packagedRuntime', 'mobileIos', 'ghosttyMac', 'whisperMac', 'fullRun', 'uncertain']) {
    expect(action).toContain(`${output}:`)
    expect(action).toContain(`steps.classify.outputs.${output}`)
  }
  expect(action).toContain('node scripts/native-impact.mjs collect')
  expect(action).toContain('GITHUB_EVENT_NAME')
  expect(action).toContain('GITHUB_EVENT_PATH')
  expect(action).toContain('if: always()')
  expect(action).toContain('actions/upload-artifact@v6')
  expect(action).toContain('"packagedRuntime":true')
  expect(action).toContain('"mobileIos":true')
  expect(action).toContain('"ghosttyMac":true')
  expect(action).toContain('"whisperMac":true')
  expect(action).toContain('id: evidence')
  expect(action).toContain('steps.evidence.outcome')
  expect(action).toContain('Evidence publication failed. Optional native jobs will run fail-closed.')
  expect(action.indexOf('id: evidence')).toBeLessThan(action.indexOf('Record native impact status'))
  expect(action).not.toContain('continue-on-error')

  const fallback = JSON.parse(action.match(/printf '%s\\n' '(\{.*\})'/)?.[1] ?? '')
  expect(fallback.decision).toMatchObject({
    fullRun: false,
    uncertain: true,
    packagedRuntime: true,
    mobileIos: true,
    ghosttyMac: true,
    whisperMac: true,
  })
})
