import { writable } from 'svelte/store'
import type { SkillIdentity, SkillInfo } from './types'

export const activeProjectId = writable<string | null>(null)
export const skills = writable<SkillInfo[]>([])
export const selectedSkillIdentity = writable<SkillIdentity | null>(null)
