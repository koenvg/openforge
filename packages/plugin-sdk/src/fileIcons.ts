export const DEFAULT_FILE_ICON = 'file'
export const DEFAULT_FOLDER_ICON = 'folder'
export const DEFAULT_FOLDER_OPEN_ICON = 'folder-open'

// Lowercased extension (no leading dot) -> Material icon base name.
// Only names that exist in vscode-material-icons/generated/icons are used.
const EXTENSION_ICONS: Readonly<Record<string, string>> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'react_ts',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'react',
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  css: 'css', less: 'css',
  scss: 'sass', sass: 'sass',
  html: 'html', htm: 'html',
  svelte: 'svelte',
  vue: 'vue',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'h', hpp: 'h', hh: 'h',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'console', bash: 'console', zsh: 'console', fish: 'console',
  sql: 'database',
  graphql: 'graphql', gql: 'graphql',
  xml: 'xml',
  svg: 'svg',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  webp: 'image', bmp: 'image', ico: 'image', avif: 'image',
  mp4: 'video', m4v: 'video', webm: 'video', ogv: 'video', ogg: 'video', mov: 'video',
  pdf: 'pdf',
  zip: 'zip', tar: 'zip', gz: 'zip', tgz: 'zip', rar: 'zip', '7z': 'zip',
  lock: 'lock',
  toml: 'settings',
  txt: 'document', log: 'document',
  env: 'tune',
}

// Exact lowercased filename -> Material icon base name (takes precedence over extension).
const FILENAME_ICONS: Readonly<Record<string, string>> = {
  'package.json': 'nodejs',
  'package-lock.json': 'lock',
  'pnpm-lock.yaml': 'lock',
  'yarn.lock': 'lock',
  dockerfile: 'docker',
  '.dockerignore': 'docker',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.npmrc': 'npm',
  '.npmignore': 'npm',
}

export function getFileIconName(filename: string): string {
  const base = (filename.split('/').pop() ?? filename).toLowerCase()

  if (base in FILENAME_ICONS) return FILENAME_ICONS[base]
  if (base.endsWith('.d.ts')) return 'typescript-def'
  if (base === 'readme' || /^readme\.[^.]+$/.test(base)) return 'readme'
  if (base === '.env' || base.startsWith('.env.')) return 'tune'

  const ext = base.includes('.') ? (base.split('.').pop() ?? '') : ''
  return EXTENSION_ICONS[ext] ?? DEFAULT_FILE_ICON
}

export function getFolderIconName(open: boolean): string {
  return open ? DEFAULT_FOLDER_OPEN_ICON : DEFAULT_FOLDER_ICON
}

export const BUNDLED_ICON_NAMES: readonly string[] = Object.freeze(
  Array.from(
    new Set<string>([
      DEFAULT_FILE_ICON,
      DEFAULT_FOLDER_ICON,
      DEFAULT_FOLDER_OPEN_ICON,
      'typescript-def',
      'readme',
      'tune',
      ...Object.values(EXTENSION_ICONS),
      ...Object.values(FILENAME_ICONS),
    ]),
  ).sort(),
)
