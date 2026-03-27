import { createLogger, type LogErrorOptions, type Logger } from 'vite'

const LIGHTNING_CSS_HIGHLIGHT_WARNING =
  "[lightningcss minify] 'highlight' is not recognized as a valid pseudo-element"

const SUPPRESSED_DIFF_HIGHLIGHTS = [
  'diff-search-match',
  'diff-search-current',
  'diff-occurrence-match',
]

interface LoggerWithWarn {
  warn(msg: string, options?: LogErrorOptions): void
}

export function shouldSuppressLightningCssHighlightWarning(message: string): boolean {
  if (!message.includes(LIGHTNING_CSS_HIGHLIGHT_WARNING)) {
    return false
  }

  return SUPPRESSED_DIFF_HIGHLIGHTS.some((highlightName) =>
    message.includes(`::highlight(${highlightName})`),
  )
}

export function createViteLogger<T extends LoggerWithWarn>(logger: T): T {
  const originalWarn = logger.warn.bind(logger)

  logger.warn = (msg: string, options?: LogErrorOptions) => {
    if (shouldSuppressLightningCssHighlightWarning(msg)) {
      return
    }

    originalWarn(msg, options)
  }

  return logger
}

export function createOpenForgeViteLogger(): Logger {
  return createViteLogger(createLogger())
}
