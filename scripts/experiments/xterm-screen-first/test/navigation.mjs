// Page.navigate returns before navigation and module startup finish. Poll only
// synchronous public document state so an old context cannot strand an await.
export async function navigate(page, url, comparison = false) {
  url = new URL(url).href
  await page.send('Page.bringToFront')
  await page.send('Page.navigate', { url })
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const state = await page.evaluate(() => ({ url: location.href, complete: document.readyState === 'complete', demo: Boolean(window.screenFirstDemo) }))
      if (state.url === url && state.complete && (!comparison || state.demo)) return
    } catch (error) {
      if (!/context|navigation/i.test(String(error))) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Arc experiment page did not become ready: ${url}`)
}
