import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { initTheme } from './lib/theme'
import { installTerminalTestProbe } from './lib/terminalTestProbe'
import { configureTerminalPerformanceTrace } from './lib/terminalSessionService'
import { createTerminalPerformanceTestTrace } from './lib/terminalPerformanceTesting'

initTheme()
const terminalPerformanceTrace = createTerminalPerformanceTestTrace(
  import.meta.env.DEV,
  window.location.href,
)
configureTerminalPerformanceTrace(terminalPerformanceTrace)
installTerminalTestProbe({
  isDevelopment: import.meta.env.DEV,
  url: window.location.href,
  performanceTrace: terminalPerformanceTrace,
})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
