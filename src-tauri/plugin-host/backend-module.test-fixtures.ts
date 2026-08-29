import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, vi } from 'vitest'

export const unicodeLineSeparatorFixturePath = fileURLToPath(
  new URL('./fixtures/external-text-unicode-line-separator.jsonl', import.meta.url),
)

export async function writeCommonJsModule(path: string, source: string): Promise<void> {
  await writeFile(path, source)
}

export async function updateBackendModule(path: string, source: string): Promise<void> {
  const commonJsSource = source.replace(/\bexport default\b/, 'module.exports =')
  if (commonJsSource === source) throw new Error('Backend module fixture requires an export default declaration')
  await writeCommonJsModule(path, commonJsSource)
}

export async function writeBackendModule(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openforge-plugin-host-'))
  const file = join(dir, `backend-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`)
  await updateBackendModule(file, source)
  return file
}

export async function expectOnlyPluginHostStderr(expectedLines: string[], operation: () => Promise<void>): Promise<void> {
  const chunks: string[] = []
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })

  try {
    await operation()
  } finally {
    stderr.mockRestore()
  }

  expect(chunks.join('')).toBe(expectedLines.map(line => `${line}\n`).join(''))
}
