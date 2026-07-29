import { open, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export class CrashSafeFilePersistence {
  private operation: Promise<void> = Promise.resolve()

  async readUtf8IfExists(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async writeUtf8Atomic(path: string, content: string): Promise<void> {
    const directoryPath = dirname(path)
    const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
    await mkdir(directoryPath, { recursive: true })
    let temporaryFile: Awaited<ReturnType<typeof open>> | null = null
    try {
      temporaryFile = await open(temporaryPath, 'w', 0o600)
      await temporaryFile.writeFile(content, 'utf8')
      await temporaryFile.sync()
      await temporaryFile.close()
      temporaryFile = null
      await rename(temporaryPath, path)

      const directory = await open(directoryPath, 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    } catch (error) {
      await temporaryFile?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}
