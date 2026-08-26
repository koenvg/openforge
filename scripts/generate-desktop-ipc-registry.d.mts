import type { ParseResult } from '@babel/parser'
import type { File } from '@babel/types'

export interface ParsedDesktopIpcContract {
  functionName: string
  moduleName: string
  ipcCommand: string
  payloadKeys: string[]
}

export function publicCommandContracts(
  sourceFile: ParseResult<File>,
  moduleName: string,
): ParsedDesktopIpcContract[]
