import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { initTheme } from './lib/theme'
import { installTerminalTestProbe } from './lib/terminalTestProbe'

initTheme()
installTerminalTestProbe({
  isDevelopment: import.meta.env.DEV,
  url: window.location.href,
})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
