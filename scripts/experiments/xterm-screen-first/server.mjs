import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('./dist/', import.meta.url))
export async function serve(port = 0) {
  const server = createServer(async (request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html'
    if (!/^[a-zA-Z0-9.-]+$/.test(name)) { response.writeHead(404).end(); return }
    try {
      const data = await readFile(dist + name)
      const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html'
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(data)
    } catch { response.writeHead(404).end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
