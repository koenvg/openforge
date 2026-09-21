/**
 * Remove or replace named skill tokens (`/name` or `$name`) in prompt text.
 *
 * A token matches only as a whole word: it must sit at the start of the string
 * or after whitespace, and it must be followed by whitespace or the end of the
 * string. Free text that happens to contain the same characters is left alone.
 */
export function replaceNamedSkillTokens(
  prompt: string,
  names: readonly string[],
  replacement = '',
): string {
  let result = prompt
  for (const name of names) {
    const trimmed = name.trim()
    if (trimmed.length === 0) continue
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const token = new RegExp(`(^|\\s)([/$])${escaped}(?=\\s|$)`, 'g')
    result = result.replace(token, (_match, leading: string) => {
      if (replacement === '') return leading
      return `${leading}${replacement}`
    })
  }
  return result
}

/** Remove `/name` and `$name` skill tokens from prompt text. */
export function removeNamedSkillTokens(prompt: string, names: readonly string[]): string {
  return replaceNamedSkillTokens(prompt, names, '')
}
