import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_HOST_SHARED_SVELTE_IMPORTS } from '../../packages/plugin-sdk/src/vite'
import { rendererImportMapHtml, rendererImportMapScriptHashSource, svelteHostRuntimeImportMapEntries } from '../../packages/plugin-sdk/src/svelteHostRuntimeContract.mjs'
import {
  ELECTRON_RENDERER_CSP,
  applyElectronRendererCsp,
  createElectronRendererCsp,
  handlePluginProtocolRequest,
  registerPluginProtocolHandler,
  registerPluginProtocolSchemeAsPrivileged,
} from './pluginProtocol'
import { DEFAULT_SIDECAR_PORT } from './sidecar'
import type { SidecarLaunchConfig } from './sidecar'

const sidecarConfig: SidecarLaunchConfig = {
  command: 'openforge-sidecar',
  args: [],
  env: {},
  host: '127.0.0.1',
  port: 17642,
  token: 'secret-token',
  baseUrl: 'http://127.0.0.1:17642',
  healthUrl: 'http://127.0.0.1:17642/app/health',
  readinessUrl: 'http://127.0.0.1:17642/app/readiness',
  eventUrl: 'http://127.0.0.1:17642/app/events',
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'openforge-electron-plugin-protocol-'))
}

function cspDirective(csp: string, name: string): string {
  return csp.split('; ').find(directive => directive.startsWith(`${name} `)) ?? ''
}

describe('Electron plugin:// protocol security contract', () => {
  it('maps every SDK-externalized Svelte runtime import to canonical host-runtime modules', async () => {
    const importMapJson = rendererImportMapHtml().match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/)?.[1]
    expect(importMapJson).toBeTruthy()
    const imports = (JSON.parse(importMapJson as string) as { imports: Record<string, string> }).imports

    expect(imports).toMatchObject(svelteHostRuntimeImportMapEntries())
    for (const specifier of OPENFORGE_HOST_SHARED_SVELTE_IMPORTS) {
      expect(imports[specifier], `${specifier} must be covered by the renderer import map`).toBeTruthy()
      expect(imports[specifier]).toMatch(/^plugin:\/\/host-runtime\/svelte\//)
    }
    expect(imports['svelte/internal/client']).toBe('plugin://host-runtime/svelte/internal/client/index.js')
    expect(imports['svelte/reactivity/window']).toBe('plugin://host-runtime/svelte/reactivity/window/index.js')
    expect(new URL('../../chunks/runtime.js', imports['svelte/internal/client']).toString()).toBe('plugin://host-runtime/svelte/chunks/runtime.js')
  })

  it('registers plugin:// as a privileged secure standard scheme before app ready', () => {
    const protocol = { registerSchemesAsPrivileged: vi.fn() }

    registerPluginProtocolSchemeAsPrivileged(protocol)

    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'plugin',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ])
  })

  it('serves host-runtime assets without requiring a Rust sidecar', async () => {
    const workspaceRoot = await tempWorkspace()
    const response = await handlePluginProtocolRequest('plugin://host-runtime/runtime.js', {
      workspaceRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/javascript')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.text()).toContain('runtimeReady')
  })

  it('rejects host-runtime traversal before touching the filesystem', async () => {
    const workspaceRoot = await tempWorkspace()
    const response = await handlePluginProtocolRequest('plugin://host-runtime/%2e%2e/runtime.js', {
      workspaceRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('serves host-runtime plugin SDK, terminal runtime, and Svelte assets from Electron resources without source-tree fallbacks', async () => {
    const workspaceRoot = await tempWorkspace()
    const hostRuntimeRoot = join(await tempWorkspace(), 'plugin-host')
    await mkdir(join(hostRuntimeRoot, 'plugin-sdk'), { recursive: true })
    await mkdir(join(hostRuntimeRoot, 'terminal-runtime'), { recursive: true })
    await mkdir(join(hostRuntimeRoot, 'svelte'), { recursive: true })
    await writeFile(join(hostRuntimeRoot, 'plugin-sdk', 'index.js'), 'export const pluginSdkFromResources = true;')
    await writeFile(join(hostRuntimeRoot, 'terminal-runtime', 'index.js'), 'export const terminalRuntimeFromResources = true;')
    await writeFile(join(hostRuntimeRoot, 'svelte', 'index.js'), 'export const svelteFromResources = true;')

    const pluginSdkResponse = await handlePluginProtocolRequest('plugin://host-runtime/plugin-sdk/index.js', {
      workspaceRoot,
      hostRuntimeRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
      readFile,
      realpath,
    })
    const terminalRuntimeResponse = await handlePluginProtocolRequest('plugin://host-runtime/terminal-runtime/index.js', {
      workspaceRoot,
      hostRuntimeRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
      readFile,
      realpath,
    })
    const svelteResponse = await handlePluginProtocolRequest('plugin://host-runtime/svelte/index.js', {
      workspaceRoot,
      hostRuntimeRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
      readFile,
      realpath,
    })

    expect(pluginSdkResponse.status).toBe(200)
    expect(await pluginSdkResponse.text()).toBe('export const pluginSdkFromResources = true;')
    expect(terminalRuntimeResponse.status).toBe(200)
    expect(await terminalRuntimeResponse.text()).toBe('export const terminalRuntimeFromResources = true;')
    expect(svelteResponse.status).toBe(200)
    expect(await svelteResponse.text()).toBe('export const svelteFromResources = true;')
  })

  it('resolves extensionless Svelte host-runtime subpaths produced by browser import maps', async () => {
    const workspaceRoot = await tempWorkspace()
    const hostRuntimeRoot = join(await tempWorkspace(), 'plugin-host')
    await mkdir(join(hostRuntimeRoot, 'svelte', 'internal', 'client'), { recursive: true })
    await mkdir(join(hostRuntimeRoot, 'svelte', 'internal', 'flags'), { recursive: true })
    await writeFile(join(hostRuntimeRoot, 'svelte', 'internal', 'client', 'index.js'), 'export const clientRuntime = true;')
    await writeFile(join(hostRuntimeRoot, 'svelte', 'internal', 'flags', 'async.js'), 'export const asyncFlag = true;')

    const clientResponse = await handlePluginProtocolRequest('plugin://host-runtime/svelte/internal/client', {
      workspaceRoot,
      hostRuntimeRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
      readFile,
      realpath,
    })
    const asyncFlagResponse = await handlePluginProtocolRequest('plugin://host-runtime/svelte/internal/flags/async', {
      workspaceRoot,
      hostRuntimeRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
      readFile,
      realpath,
    })

    expect(clientResponse.status).toBe(200)
    expect(clientResponse.headers.get('Content-Type')).toBe('application/javascript')
    expect(await clientResponse.text()).toBe('export const clientRuntime = true;')
    expect(asyncFlagResponse.status).toBe(200)
    expect(await asyncFlagResponse.text()).toBe('export const asyncFlag = true;')
  })

  it('loads an external plugin asset via authenticated Rust asset-root resolution and preserves MIME/CORS headers', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(workspaceRoot, 'installed-plugin')
    await mkdir(join(installRoot, 'assets'), { recursive: true })
    await writeFile(join(installRoot, 'assets', 'index.js'), 'export const ok = true;')
    await writeFile(join(installRoot, 'assets', 'plugin.css'), '.plugin-view { color: red; }')

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/assets/index.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:17642/app/invoke', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: 'resolve_plugin_asset_root', payload: { pluginId: 'com.example.plugin' } }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/javascript')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.text()).toBe('export const ok = true;')

    const stylesheetResponse = await handlePluginProtocolRequest('plugin://com.example.plugin/assets/plugin.css', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })
    expect(stylesheetResponse.status).toBe(200)
    expect(stylesheetResponse.headers.get('Content-Type')).toBe('text/css')
    expect(await stylesheetResponse.text()).toContain('.plugin-view')
  })

  it('propagates reload cache-busting to plugin-owned JavaScript dependency imports', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(workspaceRoot, 'installed-plugin')
    await mkdir(join(installRoot, 'dist'), { recursive: true })
    await writeFile(join(installRoot, 'dist', 'frontend.js'), [
      "import { helper } from './chunk.js'",
      "export { shared } from '../shared.js?existing=1#frag'",
      "import '/dist/root.js'",
      "import { onMount } from 'svelte'",
      "import 'lit'",
      "const lazy = () => import('./lazy.js')",
      'export { helper, onMount, lazy }',
    ].join('\n'))

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/dist/frontend.js?openforgeReload=7', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(200)
    const servedCode = await response.text()
    expect(servedCode).toContain("import { helper } from './chunk.js?openforgeReload=7'")
    expect(servedCode).toContain("export { shared } from '../shared.js?existing=1&openforgeReload=7#frag'")
    expect(servedCode).toContain("import '/dist/root.js?openforgeReload=7'")
    expect(servedCode).toContain("const lazy = () => import(\"./lazy.js?openforgeReload=7\")")
    expect(servedCode).toContain("import { onMount } from 'plugin://host-runtime/svelte/index.js'")
    expect(servedCode).toContain("import 'lit'")
  })

  it('rewrites only real Svelte static import specifiers in served plugin JavaScript', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(workspaceRoot, 'installed-plugin')
    await mkdir(join(installRoot, 'assets'), { recursive: true })
    await writeFile(join(installRoot, 'assets', 'index.js'), [
      "import { onMount } from 'svelte'",
      "import { experimental } from 'svelte/internal/flags/experimental'",
      "const stringSnippet = \"import { onMount } from 'svelte'\"",
      "const templateSnippet = `export { onMount } from 'svelte/internal/client'`",
      "// export * from 'svelte/store'",
      "/* import { tick } from 'svelte' */",
      'export { onMount }',
    ].join('\n'))

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/assets/index.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(200)
    const servedCode = await response.text()
    expect(servedCode).toContain("import { onMount } from 'plugin://host-runtime/svelte/index.js'")
    expect(servedCode).toContain("import { experimental } from 'svelte/internal/flags/experimental'")
    expect(servedCode).toContain("const stringSnippet = \"import { onMount } from 'svelte'\"")
    expect(servedCode).toContain("const templateSnippet = `export { onMount } from 'svelte/internal/client'`")
    expect(servedCode).toContain("// export * from 'svelte/store'")
    expect(servedCode).toContain("/* import { tick } from 'svelte' */")
  })

  it('uses Rust-resolved asset roots for builtin plugins instead of Electron builtin path mapping', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(await tempWorkspace(), 'rust-resolved-builtin')
    await mkdir(join(installRoot, 'dist'), { recursive: true })
    await writeFile(join(installRoot, 'dist', 'index.js'), 'export const builtin = true;')

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.openforge.file-viewer',
        asset_root: installRoot,
        is_builtin: true,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.openforge.file-viewer/dist/index.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('export const builtin = true;')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects invalid plugin ids and traversal paths with the same forbidden response shape as Tauri', async () => {
    const workspaceRoot = await tempWorkspace()
    const fetch = vi.fn()

    for (const url of [
      'plugin:///index.js',
      'plugin://%2e%2e/index.js',
      'plugin://com.example.plugin/%2e%2e/index.js',
      'plugin://com.example.plugin//etc/passwd',
    ]) {
      const response = await handlePluginProtocolRequest(url, {
        workspaceRoot,
        sidecarConfig,
        fetch,
      })
      expect(response.status, url).toBe(403)
      expect(await response.text(), url).toBe('Forbidden')
    }

    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects sidecar asset-root responses that do not match the requested plugin id', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(await tempWorkspace(), 'other-plugin')
    await mkdir(installRoot, { recursive: true })
    await writeFile(join(installRoot, 'index.js'), 'export const wrong = true;')

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.other-plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/index.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Unknown plugin: com.example.plugin')
  })

  it('rejects canonicalized plugin asset paths that escape the plugin install root', async () => {
    const workspaceRoot = await tempWorkspace()
    const installRoot = join(workspaceRoot, 'installed-plugin')
    const outsideRoot = join(workspaceRoot, 'outside')
    await mkdir(installRoot, { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    await writeFile(join(outsideRoot, 'secret.js'), 'export const secret = true;')
    await symlink(join(outsideRoot, 'secret.js'), join(installRoot, 'linked.js'))

    const fetch = vi.fn(async () => new Response(JSON.stringify({
      value: {
        plugin_id: 'com.example.plugin',
        asset_root: installRoot,
        is_builtin: false,
      },
    }), { status: 200 }))

    const response = await handlePluginProtocolRequest('plugin://com.example.plugin/linked.js', {
      workspaceRoot,
      sidecarConfig,
      fetch,
      readFile,
      realpath,
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('keeps renderer CSP compatible with plugin:// import maps and sidecar IPC without unsafe filesystem access', () => {
    expect(ELECTRON_RENDERER_CSP).toContain("default-src 'self'")
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'script-src')).toBe(`script-src 'self' plugin: 'wasm-unsafe-eval' ${rendererImportMapScriptHashSource()}`)
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'script-src')).not.toContain("'unsafe-eval'")
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'script-src')).not.toContain("'unsafe-inline'")
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'style-src')).toBe("style-src 'self' plugin: 'unsafe-inline'")
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'img-src')).toBe("img-src 'self' plugin: https: data:")
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'media-src')).toBe("media-src 'self' https: data: blob:")
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'media-src')).not.toContain('file:')
    expect(cspDirective(ELECTRON_RENDERER_CSP, 'font-src')).toBe("font-src 'self' plugin: data:")
    expect(ELECTRON_RENDERER_CSP).toContain(`connect-src 'self' http://127.0.0.1:${DEFAULT_SIDECAR_PORT} https://api.github.com https://*.atlassian.net`)
    expect(createElectronRendererCsp({ host: '127.0.0.1', port: 18000 })).toContain('http://127.0.0.1:18000')
    expect(ELECTRON_RENDERER_CSP).not.toContain('file:')
  })

  it('applies renderer CSP through Electron session headers', () => {
    const callback = vi.fn()
    const session = {
      webRequest: {
        onHeadersReceived: vi.fn((listener) => listener({ responseHeaders: { Existing: ['ok'] } }, callback)),
      },
    }

    applyElectronRendererCsp(session, 'default-src test:')

    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        Existing: ['ok'],
        'Content-Security-Policy': ['default-src test:'],
      },
    })
  })

  it('registers a plugin protocol handler without exposing sidecar token or filesystem through preload', async () => {
    const protocol = { handle: vi.fn() }
    const workspaceRoot = await tempWorkspace()

    registerPluginProtocolHandler(protocol, {
      workspaceRoot,
      sidecarConfig: null,
      fetch: vi.fn(),
    })

    expect(protocol.handle).toHaveBeenCalledOnce()
    expect(protocol.handle.mock.calls[0][0]).toBe('plugin')
    const handler = protocol.handle.mock.calls[0][1] as (request: Request) => Promise<Response>
    const response = await handler(new Request('plugin://host-runtime/runtime.js'))
    expect(response.status).toBe(200)
  })
})
