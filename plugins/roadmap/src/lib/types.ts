// Wire types matching the core Rust roadmap command responses
// (src-tauri/src/app_invoke/roadmap.rs + github_client/types.rs).

/** Resolved GitHub coordinates for the active project. */
export interface RepoRef {
  owner: string
  name: string
}

/** A label attached to an issue (subset of repo label fields). */
export interface IssueLabel {
  name: string
  color: string
}

/** A GitHub issue from the core board response. */
export interface RoadmapIssue {
  number: number
  title: string
  body: string | null
  state: string
  html_url: string
  labels: IssueLabel[]
}

/** A repository label (column source). */
export interface RepoLabel {
  name: string
  color: string
}

/** Raw board bundle returned by roadmap_get_board. */
export interface RoadmapBoard {
  repo: RepoRef
  issues: RoadmapIssue[]
  labels: RepoLabel[]
  /** Map keyed by stringified issue number → value (1..10). */
  values: Record<string, number>
  columnLabels: string[]
}

/** A repo label augmented with whether any open issue uses it. */
export interface LabelUsage {
  name: string
  color: string
  used: boolean
}

/** Config bundle returned by roadmap_get_config. */
export interface RoadmapConfig {
  columnLabels: string[]
  labels: LabelUsage[]
}

export interface SetValueRequest {
  projectId: string
  issueNumber: number
  value: number | null
}

export interface SetColumnLabelsRequest {
  projectId: string
  labels: string[]
}

export interface CreateIssueRequest {
  projectId: string
  title: string
  body: string
  labels: string[]
}

export interface EditIssueRequest {
  projectId: string
  number: number
  title?: string
  body?: string
  state?: string
  addLabels?: string[]
  removeLabels?: string[]
}
