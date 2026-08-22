import { render } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import PluginNavigationIcon from './PluginNavigationIcon.svelte'

describe('PluginNavigationIcon', () => {
  it('renders the Lucide statistics icon by name', () => {
    const { container } = render(PluginNavigationIcon, {
      props: { icon: 'chart-column-big', size: 24 },
    })

    expect(container.querySelector('.lucide-chart-column-big')).not.toBeNull()
  })

  it('renders Plug for an unsupported icon name', () => {
    const { container } = render(PluginNavigationIcon, {
      props: { icon: 'unsupported-icon', size: 24 },
    })

    expect(container.querySelector('.lucide-plug')).not.toBeNull()
  })
})
