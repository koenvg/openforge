import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

/** Keep every PDF.js resource and its notices on the library's pinned release. */
export function pdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  return {
    name: 'file-viewer-local-pdf-assets',
    generateBundle() {
      for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
          if (!entry.isFile()) throw new Error(`Unexpected PDF.js asset directory: ${folder}/${entry.name}`)
          this.emitFile({ type: 'asset', fileName: `pdf-assets/${folder}/${entry.name}`, source: readFileSync(join(root, folder, entry.name)) })
        }
      }
      this.emitFile({ type: 'asset', fileName: 'pdf-assets/LICENSE', source: readFileSync(join(root, 'LICENSE')) })
    },
  }
}
