export function parseDesktopTestOptions(argv) {
  const options = {}
  for (const argument of argv) {
    if (argument === '--') continue
    if (argument === '--retain') {
      options.retainRuntime = true
      continue
    }
    const option = [
      ['--output=', 'outputDir'],
      ['--repository=', 'repoPath'],
    ].find(([prefix]) => argument.startsWith(prefix))
    if (!option) throw new Error(`Unknown desktop test option: ${argument}`)
    const [prefix, key] = option
    const value = argument.slice(prefix.length)
    if (!value) throw new Error(`${prefix.slice(0, -1)} requires a value`)
    options[key] = value
  }
  return options
}
