import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPublicUiDeclarationsHideBitsUi,
  findPrivateBitsUiTypeLeaks,
} from '../scripts/public-ui-declaration-contract.mjs'
import { OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS } from './publicUiExports.mjs'

describe('public UI declaration contract', () => {
  it('rejects a Bits UI type inherited by an OpenForge component interface', () => {
    const source = `<script lang="ts">
      import { Select } from 'bits-ui'
      interface Props extends Select.RootProps { label: string }
      let { label }: Props = $props()
    </script>`

    expect(findPrivateBitsUiTypeLeaks(source)).toEqual(['Select'])
    expect(() => assertPublicUiDeclarationsHideBitsUi([{ componentName: 'LeakySelect', source }]))
      .toThrow('Public OpenForge UI declarations expose private Bits UI types (LeakySelect: Select)')
  })

  it('rejects directly imported private types', () => {
    const source = `<script lang="ts">
      import type {
        DialogRootProps as PrivateDialogProps,
      } from 'bits-ui'
      type InternalDialogProps = PrivateDialogProps
      type Props = InternalDialogProps & { label: string }
      let props: Props = $props()
    </script>`

    expect(findPrivateBitsUiTypeLeaks(source)).toEqual(['PrivateDialogProps'])
  })

  it('keeps every current public OpenForge component declaration private-library-free', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const components = OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.map(({ componentName, sourcePath }) => ({
      componentName,
      source: readFileSync(resolve(packageRoot, sourcePath), 'utf8'),
    }))

    expect(() => assertPublicUiDeclarationsHideBitsUi(components)).not.toThrow()
  })
})
