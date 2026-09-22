import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Owns one verified child and its private pipes. No socket, inherited credentials or PID lookup. */
export class UpdateHelperProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly exited: Promise<void>
  private queue: Record<string, unknown>[] = []
  private pending?: { resolve(value: Record<string, unknown>): void; reject(error: Error): void }
  private failure?: Error
  private buffered = ''

  constructor(executable: string) {
    const env = Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG'].flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []))
    this.child = spawn(executable, [], { env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.exited = new Promise(resolve => {
      this.child.once('error', error => { this.fail(error); resolve() })
      this.child.once('exit', () => { this.fail(new Error('Update helper exited')); resolve() })
    })
    this.child.stdin.on('error', error => this.fail(error))
    this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      this.buffered += chunk
      if (this.buffered.length > 32 * 1024) { this.fail(new Error('Oversized helper response')); return }
      while (this.buffered.includes('\n')) {
        const end = this.buffered.indexOf('\n')
        const line = this.buffered.slice(0, end)
        this.buffered = this.buffered.slice(end + 1)
        try {
          const value: unknown = JSON.parse(line)
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid helper response')
          if (this.pending) { const pending = this.pending; this.pending = undefined; pending.resolve(value as Record<string, unknown>) }
          else if (this.queue.length < 4) this.queue.push(value as Record<string, unknown>)
          else this.fail(new Error('Unexpected helper responses'))
        } catch { this.fail(new Error('Invalid helper response')) }
      }
    })
    // Drain diagnostics, but never interpret stderr as protocol or copy it into persisted authority.
    this.child.stderr.resume()
  }

  private fail(error: Error): void {
    this.failure ??= error
    this.pending?.reject(this.failure)
    this.pending = undefined
  }

  async receive(timeoutMs = 120_000): Promise<Record<string, unknown>> {
    const queued = this.queue.shift()
    if (queued) return queued
    if (this.failure) throw this.failure
    if (this.pending) throw new Error('Concurrent helper response wait')
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise((resolve, reject) => {
        this.pending = { resolve, reject }
        timer = setTimeout(() => this.fail(new Error('Update helper response deadline exceeded')), timeoutMs)
      })
    } finally { clearTimeout(timer) }
  }

  async send(envelope: { payload: string; mac: string }): Promise<void> {
    if (this.failure) throw this.failure
    await new Promise<void>((resolve, reject) => this.child.stdin.write(`${JSON.stringify(envelope)}\n`, error => error ? reject(error) : resolve()))
  }

  async stop(): Promise<void> {
    // Only our own pre-launch child. The kernel host-exit fence prevents replacement while we live.
    this.child.kill('SIGKILL')
    await this.exited
    this.closePipes()
  }

  release(): void {
    this.closePipes()
    this.child.unref()
  }

  private closePipes(): void {
    this.child.stdin.destroy()
    this.child.stdout.destroy()
    this.child.stderr.destroy()
  }
}
