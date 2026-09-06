export type Catalog = 'pages' | 'components'

export interface CoverageTarget {
  /** Canonical repository-relative path, with forward slashes. */
  source: string
  /** Plugin ID:registry.method:local ID. Contributions belong in pages only. */
  contribution?: string
}

export interface StoryAssignment extends CoverageTarget {
  stories: string[]
}

export interface CoverageExclusion {
  source: string
  kind: 'nonvisual-provider' | 'registration-shim' | 'test-only-wrapper'
  reason: string
}

export interface CoverageInventory {
  pages: StoryAssignment[]
  components: StoryAssignment[]
  exclusions: CoverageExclusion[]
}

export interface CoverageReport {
  errors: string[]
  uncovered: CoverageTarget[]
  covered: number
  excluded: number
}
