import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile, cp, unlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { capture } from './capture.mjs'
import { compare, verifyDiagnostics } from './comparison.mjs'
import { identity } from './manifest.mjs'

export async function selfTest({ browser, url, entries, output }) {
  for (const entry of entries) {
    const first = await capture(browser, url, entry)
    const second = await capture(browser, url, entry)
    verifyDiagnostics(first.diagnostics, entry.expectedErrors)
    verifyDiagnostics(second.diagnostics, entry.expectedErrors)
    assert.equal(compare(first.bytes, second.bytes, entry.tolerance).matches, true, `${entry.story}: repeated capture must pass`)
  }
  const entry = entries.find(entry => entry.catalog === 'components')
  assert.ok(entry, 'self-test requires a component smoke case')
  await assert.rejects(capture(browser, url, { ...entry, ready: '#missing-readiness' }, { timeout: 3000 }), /missing readiness/)
  const declared = await capture(browser, url, { ...entry, expectedErrors: ['declared failure'] }, {
    mutate: page => page.evaluate(() => console.error('declared failure')),
  })
  verifyDiagnostics(declared.diagnostics, ['declared failure'])

  // Alter only disposable container build output. Exercise the real command's
  // exit status, filesystem evidence, and update report, not a second runner.
  const htmlPath = 'storybook-static/components/iframe.html'
  const original = await readFile(htmlPath, 'utf8')
  const probeBaselines = '/work/visual-probe-baselines'
  await cp('/baselines', probeBaselines, { recursive: true })
  function probe(name, mode = 'check') {
    const destination = join(output, 'self-test', name)
    const result = spawnSync(process.execPath, ['scripts/storybook-visual/run.mjs', mode], {
      env: { ...process.env, VISUAL_OUTPUT: destination, VISUAL_BASELINES: probeBaselines }, encoding: 'utf8', timeout: 120000,
    })
    if (result.error) throw result.error
    return { ...result, destination }
  }
  try {
    await writeFile(htmlPath, original.replace('</head>', '<style>button{background:#ff00ff!important}</style></head>'))
    const changed = probe('intentional-change')
    assert.equal(changed.status, 1, changed.stdout + changed.stderr)
    const changedResults = JSON.parse(await readFile(join(changed.destination, 'results.json'), 'utf8'))
    assert.ok(changedResults.some(result => result.pixels > 0), 'disposable change must fail with a pixel difference')
    const updated = probe('update-review', 'update')
    assert.equal(updated.status, 0, updated.stdout + updated.stderr)
    const updateResults = JSON.parse(await readFile(join(updated.destination, 'results.json'), 'utf8'))
    assert.ok(updateResults.some(result => result.pixels > 0 && result.images.length === 3), 'update must preserve real before/current/difference evidence')
    // Restore probe baselines before testing error evidence against original UI.
    await cp('/baselines', probeBaselines, { recursive: true })
    await writeFile(htmlPath, original.replace('</head>', '<script>console.error("disposable unexpected diagnostic")</script></head>'))
    const failed = probe('unexpected-diagnostic')
    assert.equal(failed.status, 1, failed.stdout + failed.stderr)
    const failedResults = JSON.parse(await readFile(join(failed.destination, 'results.json'), 'utf8'))
    const diagnostic = failedResults.find(result => result.error?.includes('disposable unexpected diagnostic'))
    assert.ok(diagnostic, 'unexpected diagnostic must fail the real command')
    for (const name of ['baseline', 'current', 'difference']) {
      assert.ok((await readFile(join(failed.destination, diagnostic.id, `${name}.png`))).length > 0)
    }
  } finally {
    await writeFile(htmlPath, original)
  }
  const selectedPath = join(probeBaselines, identity(entry) + '.png')
  await unlink(selectedPath)
  const missing = probe('missing-baseline')
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /missing baseline/)
  await cp('/baselines', probeBaselines, { recursive: true })
  for (const [name, diagnostic] of [['components/obsolete.png', /obsolete baselines/], ['unexpected.txt', /unexpected baseline files/]]) {
    const path = join(probeBaselines, name)
    try {
      await writeFile(path, 'disposable unexpected file')
      const invalid = probe(name.endsWith('.png') ? 'obsolete-baseline' : 'unexpected-baseline')
      assert.equal(invalid.status, 1)
      assert.match(invalid.stderr, diagnostic)
    } finally {
      await unlink(path)
    }
  }
  const manifestPath = 'storybook/visual-manifest.json'
  const manifest = await readFile(manifestPath, 'utf8')
  try {
    await writeFile(manifestPath, JSON.stringify([...entries, entries[0]]))
    const duplicate = probe('duplicate')
    assert.equal(duplicate.status, 1)
    assert.match(duplicate.stderr, /duplicate identity/)
  } finally {
    await writeFile(manifestPath, manifest)
  }
  const restored = probe('restored')
  assert.equal(restored.status, 0, restored.stdout + restored.stderr)
  console.log('Self-test passed: both cases repeat, disposable pixel failure, update evidence, diagnostic artifacts, readiness, exact diagnostics, and restoration')
}
