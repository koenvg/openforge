import type { ChildProcess } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

/** Owns only captured fixture handles. Every wait is bounded; logs survive failure. */
export class FixtureProcess {
  readonly exited: Promise<void>
  output = ''
  errors = ''
  private closed = false
  private failure?: Error
  private groupRetired = false
  private stopping?: Promise<void>

  constructor(readonly child: ChildProcess, readonly root: string, readonly name: string, private readonly options: { ownedProcessGroup?: boolean } = {}) {
    const log = join(root, `${name}.log`)
    appendFileSync(log, `\nowned pid=${child.pid ?? 'spawn-failed'}\n`, { mode: 0o600 })
    this.exited = new Promise(resolve => {
      child.once('error', error => { this.failure = error; this.closed = true; resolve() })
      child.once('exit', (code, signal) => {
        this.closed = true
        appendFileSync(log, `\nexit=${code} signal=${signal}\n`)
        resolve()
      })
    })
    child.stdin?.on('error', error => { this.failure = error })
    child.stdout?.on('data', chunk => {
      appendFileSync(log, chunk)
      this.output = (this.output + String(chunk)).slice(-32_768)
    })
    child.stderr?.on('data', chunk => {
      appendFileSync(log, chunk)
      this.errors = (this.errors + String(chunk)).slice(-32_768)
    })
  }

  async waitForOutput(text: string, timeoutMs: number): Promise<void> {
    const until = Date.now() + timeoutMs
    while (!this.output.includes(text)) {
      if (this.closed || this.failure || Date.now() >= until) {
        throw new Error(`${this.name} did not report ${JSON.stringify(text)}; diagnostics: ${this.root}\n${this.output}\n${this.errors}`, { cause: this.failure })
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }

  async waitForExit(timeoutMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([this.exited, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${this.name} exit timed out; diagnostics: ${this.root}`)), timeoutMs)
      })])
    } finally { clearTimeout(timer) }
  }

  stop(): Promise<void> { return this.stopping ??= this.retire() }

  private async retire(): Promise<void> {
    const group = this.options.ownedProcessGroup && !this.groupRetired ? this.child.pid : undefined
    try {
      if (group) {
        try { process.kill(-group, 'SIGKILL') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      } else if (!this.closed) this.child.kill('SIGKILL')
      await this.waitForExit(5_000)
      if (group) {
        const until = Date.now() + 5_000
        for (;;) {
          try { process.kill(-group, 0) }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
            this.groupRetired = true
            appendFileSync(join(this.root, `${this.name}.log`), `owned group=${group} retired\n`)
            break
          }
          if (Date.now() >= until) throw new Error(`${this.name} group teardown timed out; diagnostics: ${this.root}`)
          await new Promise(resolve => setTimeout(resolve, 20))
        }
      }
    }
    finally {
      this.child.stdin?.destroy()
      this.child.stdout?.destroy()
      this.child.stderr?.destroy()
      this.child.unref()
    }
  }
}
