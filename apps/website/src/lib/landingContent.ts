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

export type PluginDiagramSlot = 'northwest' | 'northeast' | 'southwest' | 'southeast';
export type PluginTheme = 'blue' | 'violet' | 'mint' | 'amber';

export interface PluginCapability {
  title: string;
  code: string;
  description: string;
  iconPaths: readonly string[];
  slot: PluginDiagramSlot;
  theme: PluginTheme;
  pipePath: string;
}

type PluginDiagram = readonly [
  PluginCapability & { slot: 'northwest'; theme: 'blue' },
  PluginCapability & { slot: 'northeast'; theme: 'violet' },
  PluginCapability & { slot: 'southwest'; theme: 'mint' },
  PluginCapability & { slot: 'southeast'; theme: 'amber' },
];

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

export const PLUGIN_CAPABILITIES = [
  {
    title: 'Project views',
    slot: 'northwest',
    theme: 'blue',
    pipePath: 'M430 300 H370 V150 H300',
    code: 'views.register',
    description: 'Dashboards, review queues, and repository lenses.',
    iconPaths: ['M4 5.5h16v13H4z', 'M4 10h16', 'M9 10v8.5']
  },
  {
    title: 'Task context',
    slot: 'northeast',
    theme: 'violet',
    pipePath: 'M570 300 H630 V150 H700',
    code: 'taskPane.registerTab',
    description: 'Notes, checklists, docs, and team review rituals.',
    iconPaths: ['M5 4.5h14v15H5z', 'M10 4.5v15', 'M13 9h3', 'M13 13h3']
  },
  {
    title: 'Background automations',
    slot: 'southwest',
    theme: 'mint',
    pipePath: 'M430 380 H370 V530 H300',
    code: 'background.register',
    description: 'Blocked work, CI events, stale tasks, and recurring prompts.',
    iconPaths: [
      'M6 16.5a3.5 3.5 0 0 1 0-7 5.5 5.5 0 0 1 10.7-1.8A4.2 4.2 0 1 1 18 16.5h-2.2',
      'M9 16.5h3',
      'm11 13.5 3 3-3 3'
    ]
  },
  {
    title: 'Host capabilities',
    slot: 'southeast',
    theme: 'amber',
    pipePath: 'M570 380 H630 V530 H700',
    code: 'tasks · fs · shell · notifications',
    description: 'Explicit, reviewable access for trusted extensions.',
    iconPaths: ['M12 3 20 6.5v5.7c0 4.5-3.1 7.4-8 8.8-4.9-1.4-8-4.3-8-8.8V6.5L12 3Z', 'm8.8 12.1 2 2 4.6-4.8']
  }
] satisfies PluginDiagram;
