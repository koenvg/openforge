const DEFAULT_LOGGER_NAME = 'terminalPool'

export function terminalLogMessage(loggerName: string | undefined, message: string): string {
  return `[${loggerName ?? DEFAULT_LOGGER_NAME}] ${message}`
}
