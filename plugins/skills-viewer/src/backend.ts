import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, sep } from 'node:path'
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import { parseSkillFrontmatter, SKILL_SOURCE_DIRS, type SkillInfo, type SkillSourceDir } from './lib/skillDomain'

type SkillLevel = SkillInfo['level']

interface ListSkillsRequest {
  projectId: string
}

interface SaveSkillContentRequest {
  projectId: string
  name: string
  level: SkillLevel
  sourceDir: string
  sourcePath?: string | null
  content: string
  fileName?: string | null
  relativePath?: string | null
}

function codexHomeDir(): string {
  const codexHome = process.env.CODEX_HOME
  return codexHome && codexHome.length > 0 ? codexHome : join(homedir(), '.codex')
}

function skillSourceDir(root: string, sourceDir: string, level: SkillLevel): string {
  if (sourceDir === '.pi' && level === 'user') {
    return join(root, '.pi', 'agent', 'skills')
  }

  if (sourceDir === '.codex' && level === 'user') {
    return join(codexHomeDir(), 'skills')
  }

  return join(root, sourceDir, 'skills')
}

function isSupportedSkillSourceDir(sourceDir: string): sourceDir is SkillSourceDir {
  return (SKILL_SOURCE_DIRS as readonly string[]).includes(sourceDir)
}

async function scanSkillDirectory(dir: string, level: SkillLevel, sourceDir: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return skills
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillFile = join(dir, entry.name, 'SKILL.md')
    let content: string
    try {
      content = await readFile(skillFile, 'utf8')
    } catch {
      continue
    }

    const frontmatter = parseSkillFrontmatter(content)
    skills.push({
      name: frontmatter.name ?? entry.name,
      description: frontmatter.description,
      agent: null,
      template: content,
      level,
      source_dir: sourceDir,
      source_path: entry.name,
      file_name: null,
      relative_path: `${entry.name}/SKILL.md`,
    })
  }

  return skills
}

async function scanPiSkillDirectory(dir: string, level: SkillLevel): Promise<SkillInfo[]> {
  const skills = await scanSkillDirectory(dir, level, '.pi')
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return skills
  }

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== '.md') continue
    const filePath = join(dir, entry.name)
    let content: string
    try {
      content = await readFile(filePath, 'utf8')
    } catch {
      continue
    }

    const frontmatter = parseSkillFrontmatter(content)
    const fallbackName = entry.name.slice(0, -extname(entry.name).length)
    skills.push({
      name: frontmatter.name ?? fallbackName,
      description: frontmatter.description,
      agent: null,
      template: content,
      level,
      source_dir: '.pi',
      source_path: entry.name,
      file_name: entry.name,
      relative_path: entry.name,
    })
  }

  return skills
}

async function scanSkillRoot(root: string, level: SkillLevel): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  for (const sourceDir of SKILL_SOURCE_DIRS) {
    const dir = skillSourceDir(root, sourceDir, level)
    if (sourceDir === '.pi') {
      skills.push(...await scanPiSkillDirectory(dir, level))
    } else {
      skills.push(...await scanSkillDirectory(dir, level, sourceDir))
    }
  }
  return skills
}

function compareSkillSource(left: SkillInfo, right: SkillInfo): number {
  const nameOrder = left.name.localeCompare(right.name)
  if (nameOrder !== 0) return nameOrder

  if (left.level !== right.level) return left.level === 'project' ? -1 : 1

  const leftSourceIndex = SKILL_SOURCE_DIRS.indexOf(left.source_dir as SkillSourceDir)
  const rightSourceIndex = SKILL_SOURCE_DIRS.indexOf(right.source_dir as SkillSourceDir)
  const sourceOrder = (leftSourceIndex === -1 ? SKILL_SOURCE_DIRS.length : leftSourceIndex) -
    (rightSourceIndex === -1 ? SKILL_SOURCE_DIRS.length : rightSourceIndex)
  if (sourceOrder !== 0) return sourceOrder

  const sourcePathOrder = left.source_path.localeCompare(right.source_path)
  if (sourcePathOrder !== 0) return sourcePathOrder

  const fileNameOrder = (left.file_name ? 1 : 0) - (right.file_name ? 1 : 0)
  if (fileNameOrder !== 0) return fileNameOrder

  return left.relative_path.localeCompare(right.relative_path)
}

async function listSkills(api: BackendOpenForgeAPI, request: ListSkillsRequest): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  const project = await api.projects.get(request.projectId)
  if (project) {
    skills.push(...await scanSkillRoot(project.path, 'project'))
  }

  skills.push(...await scanSkillRoot(homedir(), 'user'))

  return skills.sort(compareSkillSource)
}

function isValidRootMarkdownSkillFileName(fileName: string): boolean {
  return !fileName.startsWith('.') &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    basename(fileName) === fileName &&
    extname(fileName) === '.md' &&
    fileName.slice(0, -3).length > 0
}

function assertSafeSkillName(name: string): void {
  if (!name || name.includes('/') || name.includes('\\') || name.split(sep).length !== 1 || name === '.' || name === '..') {
    throw new Error(`Invalid skill name: ${name}`)
  }
}

function getValidatedRelativeSkillPathSegments(relativePath: string, sourceDir: string): string[] {
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\')) {
    throw new Error(`Invalid skill relative path: ${relativePath}`)
  }

  const parts = relativePath.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid skill relative path: ${relativePath}`)
  }

  if (parts.length === 1) {
    if (sourceDir !== '.pi' || !isValidRootMarkdownSkillFileName(parts[0])) {
      throw new Error(`Invalid skill relative path: ${relativePath}`)
    }
    return parts
  }

  if (parts.length === 2 && parts[1] === 'SKILL.md') {
    assertSafeSkillName(parts[0])
    return parts
  }

  throw new Error(`Invalid skill relative path: ${relativePath}`)
}

async function saveSkillContent(api: BackendOpenForgeAPI, request: SaveSkillContentRequest): Promise<void> {
  if (!isSupportedSkillSourceDir(request.sourceDir)) {
    throw new Error(`Unsupported skill source directory: ${request.sourceDir}`)
  }
  if (request.level !== 'project' && request.level !== 'user') {
    throw new Error(`Unsupported skill level: ${request.level}`)
  }

  const root = request.level === 'project'
    ? (await api.projects.get(request.projectId))?.path
    : homedir()
  if (!root) {
    throw new Error(`Project not found: ${request.projectId}`)
  }

  const skillsDir = skillSourceDir(root, request.sourceDir, request.level)
  if (request.relativePath) {
    const relativePathParts = getValidatedRelativeSkillPathSegments(request.relativePath, request.sourceDir)
    await mkdir(join(skillsDir, ...relativePathParts.slice(0, -1)), { recursive: true })
    await writeFile(join(skillsDir, ...relativePathParts), request.content, 'utf8')
    return
  }

  if (request.fileName) {
    if (request.sourceDir !== '.pi') {
      throw new Error('Root markdown skill files are only supported for .pi skills')
    }
    if (!isValidRootMarkdownSkillFileName(request.fileName)) {
      throw new Error(`Invalid skill file name: ${request.fileName}`)
    }
    await mkdir(skillsDir, { recursive: true })
    await writeFile(join(skillsDir, request.fileName), request.content, 'utf8')
    return
  }

  const sourcePath = request.sourcePath ?? request.name
  assertSafeSkillName(sourcePath)
  const skillDir = join(skillsDir, sourcePath)
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), request.content, 'utf8')
}

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod<ListSkillsRequest, SkillInfo[]>('listSkills', {
      input: {
        type: 'object',
        required: ['projectId'],
        properties: { projectId: { type: 'string' } },
      },
      handler: (request) => listSkills(openforge, request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<SaveSkillContentRequest, void>('saveSkillContent', {
      input: {
        type: 'object',
        required: ['projectId', 'name', 'level', 'sourceDir', 'content'],
        properties: {
          projectId: { type: 'string' },
          name: { type: 'string' },
          level: { enum: ['project', 'user'] },
          sourceDir: { type: 'string' },
          sourcePath: { type: ['string', 'null'] },
          content: { type: 'string' },
          fileName: { type: ['string', 'null'] },
          relativePath: { type: ['string', 'null'] },
        },
      },
      handler: (request) => saveSkillContent(openforge, request),
    }))
  },
})
