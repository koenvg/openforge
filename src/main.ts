import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { configureTerminalPerformanceTrace } from './lib/terminalSessionService'
import { createTerminalPerformanceTestTrace } from './lib/terminalPerformanceTesting'
import { initTerminalFontChoice } from './lib/terminalFont'
import { initTerminalFontSizeChoice } from './lib/terminalFontSize'

initTerminalFontChoice()
initTerminalFontSizeChoice()

const terminalPerformanceTrace = createTerminalPerformanceTestTrace(
  import.meta.env.DEV,
  window.location.href,
)
configureTerminalPerformanceTrace(terminalPerformanceTrace)
if (import.meta.env.DEV) {
  void import('./lib/terminalTestProbe').then(({
    installTerminalPerformanceProbe,
    installTerminalTestProbe,
  }) => {
    installTerminalPerformanceProbe({
      isDevelopment: true,
      url: window.location.href,
      performanceTrace: terminalPerformanceTrace,
    })
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: import.meta.env.VITE_OPENFORGE_E2E === '1',
      launchToken: import.meta.env.VITE_OPENFORGE_E2E_TOKEN,
      url: window.location.href,
    })
  })
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
