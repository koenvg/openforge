import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_ICON_NAMES,
  DEFAULT_FILE_ICON,
  getFileIconName,
  getFolderIconName,
} from './fileIcons'

describe('getFileIconName', () => {
  it.each([
    ['foo.ts', 'typescript'],
    ['foo.tsx', 'react_ts'],
    ['foo.js', 'javascript'],
    ['foo.jsx', 'react'],
    ['foo.py', 'python'],
    ['foo.rs', 'rust'],
    ['data.json', 'json'],
    ['README.notes.md', 'markdown'],
    ['logo.svg', 'svg'],
    ['pic.PNG', 'image'],
    ['recording.mp4', 'video'],
    ['recording.WEBM', 'video'],
    ['recording.mov', 'video'],
    ['recording.m4v', 'video'],
    ['recording.ogv', 'video'],
    ['recording.ogg', 'video'],
    ['Component.svelte', 'svelte'],
  ])('maps %s -> %s by extension', (name, expected) => {
    expect(getFileIconName(name)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(getFileIconName('FOO.TS')).toBe('typescript')
  })

  it('uses only the final path segment', () => {
    expect(getFileIconName('a/b/c/foo.ts')).toBe('typescript')
  })

  it('resolves compound extensions by the final extension', () => {
    expect(getFileIconName('dashboard.test.ts')).toBe('typescript')
    expect(getFileIconName('Heatmap.cy.tsx')).toBe('react_ts')
  })

  it.each([
    ['package.json', 'nodejs'],
    ['pnpm-lock.yaml', 'lock'],
    ['.gitignore', 'git'],
    ['Dockerfile', 'docker'],
    ['types.d.ts', 'typescript-def'],
    ['README', 'readme'],
    ['README.md', 'readme'],
    ['.env.local', 'tune'],
  ])('special-cases %s -> %s', (name, expected) => {
    expect(getFileIconName(name)).toBe(expected)
  })

  it('falls back to the default file icon for unknown/no extension', () => {
    expect(getFileIconName('mystery.xyz')).toBe(DEFAULT_FILE_ICON)
    expect(getFileIconName('LICENSE-UNKNOWN')).toBe(DEFAULT_FILE_ICON)
    expect(getFileIconName('')).toBe(DEFAULT_FILE_ICON)
  })
})

describe('getFolderIconName', () => {
  it('returns folder-open when open, folder when closed', () => {
    expect(getFolderIconName(true)).toBe('folder-open')
    expect(getFolderIconName(false)).toBe('folder')
  })
})

describe('BUNDLED_ICON_NAMES', () => {
  it('contains every name the resolvers can return', () => {
    const samples = [
      'foo.ts', 'foo.tsx', 'foo.js', 'foo.jsx', 'foo.py', 'foo.rs',
      'a.json', 'a.yaml', 'a.md', 'a.css', 'a.scss', 'a.html', 'a.svelte',
      'a.vue', 'a.rb', 'a.go', 'a.java', 'a.kt', 'a.swift', 'a.c', 'a.h',
      'a.cpp', 'a.cs', 'a.php', 'a.sh', 'a.sql', 'a.graphql', 'a.xml',
      'a.svg', 'a.png', 'a.pdf', 'a.zip', 'a.toml', 'a.txt', 'a.env',
      'a.mp4', 'a.m4v', 'a.webm', 'a.ogv', 'a.ogg', 'a.mov',
      'package.json', 'pnpm-lock.yaml', '.gitignore', 'Dockerfile',
      'types.d.ts', 'README', '.env.local', '.npmrc', 'mystery.xyz',
    ]
    for (const name of samples) {
      expect(BUNDLED_ICON_NAMES).toContain(getFileIconName(name))
    }
    expect(BUNDLED_ICON_NAMES).toContain(getFolderIconName(true))
    expect(BUNDLED_ICON_NAMES).toContain(getFolderIconName(false))
  })

  it('is sorted and unique', () => {
    const sorted = [...BUNDLED_ICON_NAMES].sort()
    expect(BUNDLED_ICON_NAMES).toEqual(sorted)
    expect(new Set(BUNDLED_ICON_NAMES).size).toBe(BUNDLED_ICON_NAMES.length)
  })
})

describe('vendored icon assets', () => {
  // NB: use import.meta.url directly (not `new URL('./x', import.meta.url)`),
  // which Vite would rewrite into a non-file asset URL.
  const iconsDir = join(dirname(fileURLToPath(import.meta.url)), 'ui', 'icons')

  it('has an SVG file for every bundled icon name', () => {
    for (const name of BUNDLED_ICON_NAMES) {
      expect(existsSync(join(iconsDir, `${name}.svg`)), `missing icon: ${name}.svg`).toBe(true)
    }
  })

  it('vendors exactly the bundled set (no missing, no extras)', () => {
    const vendored = readdirSync(iconsDir)
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/\.svg$/, ''))
      .sort()
    expect(vendored).toEqual([...BUNDLED_ICON_NAMES].sort())
  })
})
