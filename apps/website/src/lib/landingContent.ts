import { GITHUB_RELEASES_URL, GITHUB_REPOSITORY_URL } from './urls';

type ButtonVariant = 'primary' | 'secondary';

export interface TopReason {
  title: string;
  description: string;
}

export type LandingActionIcon = 'download' | 'github';

interface BaseLandingActionLink {
  label: string;
  href: string;
  variant: ButtonVariant;
  icon: LandingActionIcon;
  iconClass: string;
}

export interface LandingActionLink extends BaseLandingActionLink {
  ariaLabel: string;
}

export type PluginTheme = 'blue' | 'violet' | 'mint' | 'amber' | 'slate';

export interface FirstPartyPlugin {
  title: string;
  hooks: readonly string[];
  description: string;
  iconPaths: readonly string[];
  theme: PluginTheme;
  wide?: boolean;
}

export const TOP_REASONS = [
  {
    title: 'Frame the task.',
    description: 'Write the outcome once. Keep the prompt, project, owner, and dependencies attached to the work.'
  },
  {
    title: 'Let agents run.',
    description: 'Give each run its own worktree and terminal. Follow progress without babysitting every process.'
  },
  {
    title: 'Review the evidence.',
    description: 'See diffs, blockers, CI, and agent questions in context before you decide what ships.'
  }
] satisfies readonly TopReason[];

const LANDING_ACTIONS = {
  install: {
    label: 'Download for macOS',
    href: GITHUB_RELEASES_URL,
    variant: 'primary',
    icon: 'download',
    iconClass: 'button-icon download-icon'
  },
  source: {
    label: 'View source',
    href: GITHUB_REPOSITORY_URL,
    variant: 'secondary',
    icon: 'github',
    iconClass: 'button-icon'
  }
} satisfies Record<string, BaseLandingActionLink>;

export const HERO_CTA_LINKS = [
  {
    ...LANDING_ACTIONS.install,
    ariaLabel: 'Download OpenForge for macOS from GitHub releases'
  },
  {
    ...LANDING_ACTIONS.source,
    ariaLabel: 'View the OpenForge source on GitHub'
  }
] satisfies readonly LandingActionLink[];

export const FINAL_CTA_LINKS = [
  {
    ...LANDING_ACTIONS.install,
    ariaLabel: 'Download OpenForge for macOS from GitHub releases'
  },
  {
    ...LANDING_ACTIONS.source,
    iconClass: 'button-icon github-icon',
    ariaLabel: 'View the OpenForge source on GitHub'
  }
] satisfies readonly LandingActionLink[];

export const FIRST_PARTY_PLUGINS = [
  {
    title: 'GitHub Sync',
    hooks: ['views.register', 'taskUI.registerSection', 'reviewUI.registerRowAction', 'settings.registerSection'],
    description: 'Pull-request views, task status, review actions, and Jira settings.',
    theme: 'violet',
    wide: true,
    iconPaths: ['M7 3v4a4 4 0 0 0 4 4h6', 'm14 8 3 3-3 3', 'M7 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M17 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z']
  },
  {
    title: 'File Viewer',
    hooks: ['views.register', 'commands.register', 'fs'],
    description: 'Browse and reveal project files from a rail view.',
    theme: 'blue',
    iconPaths: ['M3 6.5h7l2 2h9v10H3z', 'M3 8.5h18']
  },
  {
    title: 'Terminal',
    hooks: ['views.register', 'taskUI.registerTab', 'shell'],
    description: 'Project terminals and task-scoped shell sessions.',
    theme: 'slate',
    iconPaths: ['m5 7 4 4-4 4', 'M11 17h7']
  },
  {
    title: 'Task Browser',
    hooks: ['taskUI.registerTab', 'browserSurfaces', 'commands.register'],
    description: 'A secure, persistent browser surface inside every task.',
    theme: 'mint',
    iconPaths: ['M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a15 15 0 0 1 0 18', 'M12 3a15 15 0 0 0 0 18']
  },
  {
    title: 'Task Schedules',
    hooks: ['views.register', 'background.register', 'backend.registerMethod', 'tasks'],
    description: 'One-off and recurring tasks powered by a background service.',
    theme: 'amber',
    iconPaths: ['M12 3a9 9 0 1 0 9 9', 'M12 7v5l3 2', 'M19 3v4h-4']
  }
] satisfies readonly FirstPartyPlugin[];
