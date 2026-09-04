import { mount } from 'svelte'
import '../../../../app.css'
import { DARK_THEME, LIGHT_THEME } from '../../../../lib/themeContract'
import { createThemeDocumentAdapter } from '../../../../lib/themeDocumentAdapter'
import InteractionOverlayVisualHarness from './InteractionOverlayVisualHarness.svelte'

const params = new URLSearchParams(window.location.search)
const theme = params.get('theme') === 'dark' ? DARK_THEME : LIGHT_THEME

createThemeDocumentAdapter(document.documentElement).apply(theme)

mount(InteractionOverlayVisualHarness, {
  target: document.getElementById('app')!,
})
