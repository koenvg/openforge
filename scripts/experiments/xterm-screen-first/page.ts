import { FixtureComparison, type Fixture } from './adapter'

declare global { interface Window { screenFirstDemo: FixtureComparison } }

const response = await fetch('/fixture.json')
if (!response.ok) throw new Error('Frozen Ghostty fixture unavailable')
const fixture: Fixture = await response.json()
const element = (id: string) => document.getElementById(id)!
let demo: FixtureComparison
let busy = false
const update = () => {
  if (!demo) return
  const status = demo.status()
  element('status').textContent = `${status.historyPaused ? 'History paused.' : 'Page scheduled in one second.'} ${status.pendingPages} page pending. Candidate has ${status.candidate.history} history rows. Input received: ${JSON.stringify(status.input)}.`
  element('baseline-state').textContent = status.baselineConcealed ? 'Concealed until history completes. Input blocked.' : 'History complete. Current screen visible.'
  for (const button of Array.from(document.querySelectorAll('button'))) button.disabled = busy
  element('release').toggleAttribute('disabled', busy || status.pendingPages === 0)
}
demo = new FixtureComparison(fixture, element('candidate'), element('baseline'), update)
window.screenFirstDemo = demo
await demo.ready
update()
for (const [id, action] of Object.entries({
  pause: async () => { demo.pauseHistory() }, resume: async () => { demo.resumeHistory() }, release: () => demo.releaseOnePage(), live: () => demo.injectLiveOutput(),
  reset: () => demo.reset(), history: () => demo.scrollHistory(), bottom: () => demo.liveScreen(),
})) {
  element(id).addEventListener('click', async () => {
    if (busy) return
    busy = true
    update()
    try { await action() } catch (error) { element('error').textContent = String(error) }
    finally { busy = false; update() }
  })
}
