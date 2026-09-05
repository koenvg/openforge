import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MIGRATED_TASK_CONTROL_FILES = [
  './AddTaskDialog.svelte',
  './create-task/CreateTaskEnvironment.svelte',
  './create-task/CreateTaskProgressiveSettings.svelte',
  './create-task/CreateTaskPromptAttachments.svelte',
  './focus-board/BacklogLabelFilterDropdown.svelte',
  './focus-board/BacklogReadyFilterToggle.svelte',
  './focus-board/BoardTextFilter.svelte',
  './focus-board/FocusBoard.svelte',
  './focus-board/TaskListItem.svelte',
  './shared/tasks/TaskContextMenu.svelte',
  './shared/tasks/TaskLabelEditor.svelte',
  './shared/tasks/TaskLabelPills.svelte',
  './shared/adapters/VoiceInput.svelte',
] as const

const EXPECTED_PUBLIC_CONTROLS = {
  './AddTaskDialog.svelte': ['Button', 'Modal'],
  './create-task/CreateTaskEnvironment.svelte': ['Button', 'Panel', 'SearchableSelect', 'Select', 'Switch'],
  './create-task/CreateTaskProgressiveSettings.svelte': ['Switch', 'TextField'],
  './create-task/CreateTaskPromptAttachments.svelte': ['Button', 'Modal'],
  './focus-board/BacklogLabelFilterDropdown.svelte': ['AnchoredMenu'],
  './focus-board/BacklogReadyFilterToggle.svelte': ['Button'],
  './focus-board/BoardTextFilter.svelte': ['Button', 'IconButton'],
  './focus-board/FocusBoard.svelte': ['Badge', 'Button'],
  './focus-board/TaskListItem.svelte': ['Badge', 'IconButton', 'Panel'],
  './shared/tasks/TaskLabelEditor.svelte': ['Button', 'TextField'],
  './shared/tasks/TaskLabelPills.svelte': ['Badge'],
  './shared/adapters/VoiceInput.svelte': ['Button'],
} as const

const ALLOWED_NATIVE_CONTROL_COUNTS = new Map<string, number>([
  ['./create-task/CreateTaskEnvironment.svelte', 2], // Worktree source radios.
  ['./focus-board/BoardTextFilter.svelte', 1], // Feature-owned inline search interaction.
  ['./focus-board/TaskListItem.svelte', 1], // Feature-owned inline title rename.
])

const COVERED_DIRECT_CONTROL_CLASS = /^(?:btn|input|select|textarea|toggle|badge)(?:-[a-z0-9/\[\].-]+)?$/
const COVERED_FIXED_CONTROL_GEOMETRY_CLASS = /^(?:h|min-h|max-h|p|px|py|rounded)(?:-|$)/

function directControlClassViolations(source: string): string[] {
  const classValues = [...source.matchAll(/class=(?:"([^"]*)"|'([^']*)')/g)]
    .map((match) => match[1] ?? match[2] ?? '')
  const classDirectives = [...source.matchAll(/class:((?:btn|input|select|textarea|toggle|badge)(?:-[a-z0-9/\[\].-]+)?)/g)]
    .map((match) => match[1])

  return [
    ...classValues.flatMap((classValue) =>
      classValue.split(/\s+/).filter((classToken) => COVERED_DIRECT_CONTROL_CLASS.test(classToken)),
    ),
    ...classDirectives,
  ]
}

function fixedPublicControlGeometryViolations(source: string): string[] {
  const publicControlTags = [...source.matchAll(/<(?:Button|IconButton|TextField|Textarea|Select|SearchableSelect|Switch|Badge|Panel)\b[\s\S]*?>/g)]

  return publicControlTags.flatMap((match) => {
    const classValue = match[0].match(/class=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean) ?? ''
    return classValue.split(/\s+/).filter((classToken) => COVERED_FIXED_CONTROL_GEOMETRY_CLASS.test(classToken))
  })
}

describe('task control migration', () => {
  it('catches seeded direct classes and public-control geometry overrides', () => {
    expect(directControlClassViolations('<button class="btn btn-sm">Save</button>')).toEqual(['btn', 'btn-sm'])
    expect(fixedPublicControlGeometryViolations('<Button class="h-10 px-4 rounded-lg">Save</Button>')).toEqual([
      'h-10',
      'px-4',
      'rounded-lg',
    ])
  })

  it.each(MIGRATED_TASK_CONTROL_FILES)('%s does not use covered direct control classes', (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const violations = directControlClassViolations(source)

    expect(violations).toEqual([])
  })

  it.each(MIGRATED_TASK_CONTROL_FILES)('%s leaves public control geometry to the component', (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')

    expect(fixedPublicControlGeometryViolations(source)).toEqual([])
  })

  it.each(Object.entries(EXPECTED_PUBLIC_CONTROLS))('%s composes the expected public controls', (relativePath, expectedControls) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const importedControls = [...source.matchAll(/@openforge-app\/plugin-sdk\/ui\/([A-Za-z]+)\.svelte/g)]
      .map((match) => match[1])

    expect(importedControls).toEqual(expect.arrayContaining([...expectedControls]))
  })

  it.each(MIGRATED_TASK_CONTROL_FILES)('%s has only explicitly allowed native controls', (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const nativeControls = [...source.matchAll(/<(?:button|input|select|textarea)\b/g)]

    expect(nativeControls).toHaveLength(ALLOWED_NATIVE_CONTROL_COUNTS.get(relativePath) ?? 0)
  })
})
