export function identity(entry) {
  return `${entry.catalog}/${entry.story}--${entry.theme}--${entry.viewport.width}x${entry.viewport.height}`
}

export function validateManifest(entries, indexes) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('manifest must be a non-empty array')
  const seen = new Set()
  for (const [index, entry] of entries.entries()) {
    const fail = (message) => { throw new Error(`visual manifest entry ${index}: ${message}`) }
    if (!entry || typeof entry !== 'object') fail('invalid entry')
    for (const key of Object.keys(entry)) {
      if (!['catalog', 'story', 'theme', 'viewport', 'ready', 'expectedErrors', 'tolerance'].includes(key)) fail(`unknown field ${key}`)
    }
    if (!['pages', 'components'].includes(entry.catalog)) fail('invalid catalog')
    if (!/^[a-z0-9-]+$/.test(entry.story ?? '')) fail('invalid story identity')
    if (!['openforge-light', 'openforge-dark'].includes(entry.theme)) fail('invalid theme')
    if (!entry.viewport || Object.keys(entry.viewport).sort().join() !== 'height,width' ||
      !Object.values(entry.viewport).every(value => Number.isInteger(value) && value >= 100 && value <= 3840)) fail('invalid viewport')
    if (typeof entry.ready !== 'string' || !entry.ready.trim()) fail('ready selector is required')
    if (!Array.isArray(entry.expectedErrors) || !entry.expectedErrors.every(value => typeof value === 'string' && value.trim())) fail('expectedErrors must contain exact diagnostic strings')
    if (entry.tolerance !== undefined) {
      const tolerance = entry.tolerance
      if (!tolerance || Object.keys(tolerance).sort().join() !== 'maxChannelDelta,maxPixels,reason' ||
        !Number.isInteger(tolerance.maxPixels) || tolerance.maxPixels < 1 || tolerance.maxPixels > 20 ||
        tolerance.maxChannelDelta !== 1 || typeof tolerance.reason !== 'string' || !tolerance.reason.trim()) fail('invalid tolerance: require reason, maxPixels 1..20 and maxChannelDelta 1')
    }
    if (indexes[entry.catalog]?.entries?.[entry.story]?.type !== 'story') fail(`missing story ${entry.catalog}/${entry.story}; rebuild catalogs or correct manifest`)
    const key = identity(entry)
    if (seen.has(key)) fail(`duplicate identity ${key}`)
    seen.add(key)
  }
  return entries
}

export function validateBaselines(entries, files, mode) {
  const expected = new Set(entries.map(entry => identity(entry) + '.png'))
  const unexpected = files.filter(file => !/^(pages|components)\/[a-z0-9-]+\.png$/.test(file))
  if (unexpected.length) throw new Error(`unexpected baseline files: ${unexpected.join(', ')}`)
  const obsolete = files.filter(file => !expected.has(file))
  const missing = [...expected].filter(file => !files.includes(file))
  if (mode === 'check' && (missing.length || obsolete.length)) {
    throw new Error([missing.length && `missing baseline: ${missing.join(', ')}; run storybook:visual:update and review`, obsolete.length && `obsolete baselines: ${obsolete.join(', ')}; remove explicitly after review`].filter(Boolean).join('\n'))
  }
  return obsolete
}
