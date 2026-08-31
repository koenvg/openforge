# Plugin SDK file content migration

`FileSystemAPI.readFile()` resolves a `FileContent` object instead of a raw string. Plugins must distinguish text, image, video, binary/document placeholders, and files that are too large to inline. Starting with `@openforge-app/plugin-sdk` 0.3.0, `video` is a public `FileContent.type`; exhaustive switches written against 0.2.x must add that case or an explicit fallback.

```ts
import type { FileContent } from '@openforge-app/plugin-sdk'

const file: FileContent = await api.fs.readFile({ projectId, path: 'README.md' })
```

## Migration note

Before, plugins commonly treated `readFile()` as text-only:

```ts
const content = await api.fs.readFile({ projectId, path })
renderText(content)
```

After the migration, branch on `FileContent.type` and only read `content` as text when the host says it is text:

```ts
const file = await api.fs.readFile({ projectId, path })

switch (file.type) {
  case 'text':
    renderText(file.content, file.mimeType)
    break
  case 'image':
    renderImage(`data:${file.mimeType ?? 'application/octet-stream'};base64,${file.content}`)
    break
  case 'video':
    renderVideo(`data:${file.mimeType ?? 'application/octet-stream'};base64,${file.content}`)
    break
  case 'document':
    renderDocumentPlaceholder({ mimeType: file.mimeType, size: file.size })
    break
  case 'binary':
  case 'large-file':
    renderUnavailablePreview({ kind: file.type, size: file.size })
    break
}
```

`content` is no longer a universal text string. Treat it according to `type`:

| `FileContent.type` | `content` shape | Author guidance |
| --- | --- | --- |
| `text` | UTF-8 text | Render or parse as text. Use `mimeType` for syntax highlighting or format-specific handling. |
| `image` | base64 bytes | Build a `data:` URL from `mimeType` and `content`, or pass the base64 payload to an image renderer. |
| `video` | base64 bytes | Build a `data:` URL from `mimeType` and `content`, then pass it to a video element with controls. Do not enable autoplay. |
| `document` | empty string | Do not parse `content`; show a document preview/download placeholder using `mimeType` and `size`. |
| `binary` | empty string | Do not parse `content`; show an unsupported/binary placeholder using `size`. |
| `large-file` | empty string | Do not render inline; show a too-large placeholder using `size`. |

The metadata fields are always part of the contract:

- `mimeType: string | null` identifies known text, image, video, and document formats and may be `null` for unknown binary files.
- `size: number` is the file size in bytes, including when `content` is intentionally empty.

## Testing fixture guidance

Update plugin fixtures and fakes so they return `FileContent`, not strings. The SDK mock API defaults `readFile()` to an empty text file; pass a `projectFileContents` map to model text, video, image, document, binary, or oversized results by project-relative path:

```ts
import { createMockOpenForgeApi } from '@openforge-app/plugin-sdk/testing'
import type { FileContent } from '@openforge-app/plugin-sdk'

const readme: FileContent = {
  type: 'text',
  content: '# Hello',
  mimeType: 'text/markdown',
  size: 7,
}

const logo: FileContent = {
  type: 'image',
  content: 'iVBORw0KGgo=',
  mimeType: 'image/png',
  size: 8,
}

const recording: FileContent = {
  type: 'video',
  content: 'AAAAHGZ0eXBpc29t',
  mimeType: 'video/mp4',
  size: 12,
}
const pdf: FileContent = {
  type: 'document',
  content: '',
  mimeType: 'application/pdf',
  size: 15360,
}

const archive: FileContent = {
  type: 'binary',
  content: '',
  mimeType: null,
  size: 4096,
}

const api = createMockOpenForgeApi({
  pluginId: 'acme.viewer',
  projectId: 'P-1',
  projectFileContents: {
    'README.md': readme,
    'logo.png': logo,
    'recording.mp4': recording,
    'guide.pdf': pdf,
    'archive.zip': archive,
  },
})
```

Recommended fixture coverage for file-reading plugins:

1. A text fixture that asserts the plugin renders `content` as text and uses `mimeType` where relevant.
2. An image fixture that asserts the plugin treats `content` as base64 and prefixes it with the returned `mimeType`.
3. A video fixture that asserts the plugin treats `content` as base64, uses the supplied video MIME type and byte size, enables native controls, and does not autoplay.
4. A document fixture, such as PDF metadata, that asserts the plugin uses `mimeType`/`size` and does not attempt to render empty `content` as text.
5. A binary or `large-file` fixture that asserts the plugin shows an unsupported or too-large state without reading `content`.

If your tests use local hand-written API objects instead of `@openforge-app/plugin-sdk/testing`, update the `fs.readFile` fake signature to `Promise<FileContent>` and include `type`, `content`, `mimeType`, and `size` in every fixture.
