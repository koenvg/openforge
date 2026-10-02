import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { serve } from './server.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const endpoint = process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222'
// Check the existing session first. Never launch, replace or close a browser.
let version
try {
  const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error(String(response.status))
  version = await response.json()
} catch {
  throw new Error(`Connect your existing Arc session at ${endpoint} before launching. No other browser will be started.`)
}
execFileSync('pnpm', ['--ignore-workspace', 'install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit' })
execFileSync('node', ['build.mjs'], { cwd: root, stdio: 'inherit' })
const server = await serve(Number(process.env.SCREEN_FIRST_PORT ?? 5251))
const socket = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Arc did not open the fixture tab')), 5000)
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id !== 1) return
    clearTimeout(timeout)
    if (message.error) reject(new Error(JSON.stringify(message.error)))
    else resolve()
  })
  socket.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: server.url } }))
})
socket.close()
console.log(`Fixture-only comparison opened in the existing Arc session: ${server.url}\nCtrl-C stops this isolated server, not Arc.`)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0) })
