import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'

export async function pathExists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function assertExists(path, label) {
  try {
    await stat(path)
  } catch {
    throw new Error(`${label} not found at ${path}`)
  }
}
