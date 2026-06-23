import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, sep } from 'node:path'
import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge/plugin-sdk/backend'
import { SKILL_SOURCE_DIRS, type SkillInfo, type SkillSourceDir } from './lib/skillDomain'

type SkillLevel = SkillInfo['level']

interface ListSkillsRequest {
  projectId: string
}

interface SaveSkillContentRequest {
  projectId: string
  name: string
  level: SkillLevel
  sourceDir: string
  content: string
  directoryName: string | null
  fileName: string | null
}

function skillSourceDir(root: string, sourceDir: string, level: SkillLevel): string {
  if (sourceDir === '.pi' && level === 'user') {
    return join(root, '.pi', 'agent', 'skills')
  }

  return join(root, sourceDir, 'skills')
}

function isSupportedSkillSourceDir(sourceDir: string): sourceDir is SkillSourceDir {
  return (SKILL_SOURCE_DIRS as readonly string[]).includes(sourceDir)
}

function parseSkillFrontmatter(content: string): { name: string | null; description: string | null } {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return { name: null, description: null }

  const afterFirst = trimmed.slice(3)
  const endIndex = afterFirst.indexOf('\n---')
  if (endIndex < 0) return { name: null, description: null }

  const frontmatter = afterFirst.slice(0, endIndex)
  let name: string | null = null
  let description = ''
  let inDescription = false

  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith('name:')) {
      const value = trimmedLine.slice('name:'.length).trim().replace(/^['"]|['"]$/g, '')
      name = value || null
      inDescription = false
      continue
    }

    if (trimmedLine.startsWith('description:')) {
      const value = trimmedLine.slice('description:'.length).trim().replace(/^['"]|['"]$/g, '')
      if (value === '|' || value === '>' || value === '') {
        inDescription = true
      } else {
        description = value
        inDescription = false
      }
      continue
    }

    if (inDescription) {
      if (trimmedLine && (line.startsWith(' ') || line.startsWith('\t'))) {
        description = description ? `${description} ${trimmedLine}` : trimmedLine
      } else {
        inDescription = false
      }
    }
  }

  return { name, description: description || null }
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
      directory_name: entry.name,
      file_name: null,
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
      directory_name: null,
      file_name: entry.name,
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

  if (left.file_name === null && right.file_name !== null) return -1
  if (left.file_name !== null && right.file_name === null) return 1

  const directoryOrder = (left.directory_name ?? '').localeCompare(right.directory_name ?? '')
  if (directoryOrder !== 0) return directoryOrder

  return (left.file_name ?? '').localeCompare(right.file_name ?? '')
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

  const directoryName = request.directoryName ?? request.name
  assertSafeSkillName(directoryName)
  const skillDir = join(skillsDir, directoryName)
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
          content: { type: 'string' },
          directoryName: { type: ['string', 'null'] },
          fileName: { type: ['string', 'null'] },
        },
      },
      handler: (request) => saveSkillContent(openforge, request),
    }))
  },
})
