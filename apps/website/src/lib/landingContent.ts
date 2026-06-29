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

export interface PluginCapability {
  title: string;
  code: string;
  description: string;
  iconPaths: readonly string[];
}

export const TOP_REASONS = [
  {
    title: 'Stay in control of agent work.',
    description: 'Keep scoped changes, Handoff Notes, and review gates visible before work moves forward.'
  },
  {
    title: 'Let agents manage OpenForge tasks through the CLI.',
    description: 'Agents can coordinate Task status and Handoff Notes from command-line workflows.'
  },
  {
    title: 'Customize OpenForge to your workflow with Trusted Plugins.',
    description: 'Shape views, task context, and automations around the stable task-based operator console.'
  }
] satisfies readonly TopReason[];

const LANDING_ACTIONS = {
  install: {
    label: 'Install OpenForge',
    href: GITHUB_RELEASES_URL,
    variant: 'primary',
    icon: 'download',
    iconClass: 'button-icon download-icon'
  },
  source: {
    label: 'GitHub',
    href: GITHUB_REPOSITORY_URL,
    variant: 'secondary',
    icon: 'github',
    iconClass: 'button-icon'
  }
} satisfies Record<string, BaseLandingActionLink>;

export const HERO_CTA_LINKS = [
  {
    ...LANDING_ACTIONS.install,
    ariaLabel: 'Install OpenForge from releases'
  },
  {
    ...LANDING_ACTIONS.source,
    label: 'See GitHub',
    ariaLabel: 'View OpenForge on GitHub'
  }
] satisfies readonly LandingActionLink[];

export const FINAL_CTA_LINKS = [
  {
    ...LANDING_ACTIONS.install,
    ariaLabel: 'Install OpenForge from releases'
  },
  {
    ...LANDING_ACTIONS.source,
    iconClass: 'button-icon github-icon',
    ariaLabel: 'View OpenForge source on GitHub'
  }
] satisfies readonly LandingActionLink[];

export const PLUGIN_CAPABILITIES = [
  {
    title: 'Your views',
    code: 'views.register',
    description: 'project dashboards, review queues, repo lenses',
    iconPaths: ['M4 5.5h16v13H4z', 'M4 10h16', 'M9 10v8.5']
  },
  {
    title: 'Your task context',
    code: 'taskPane.registerTab',
    description: 'notes, checklists, docs, review rituals',
    iconPaths: ['M5 4.5h14v15H5z', 'M10 4.5v15', 'M13 9h3', 'M13 13h3']
  },
  {
    title: 'Your automations',
    code: 'background.register',
    description: 'handoffs, CI, stale work, recurring prompts',
    iconPaths: [
      'M6 16.5a3.5 3.5 0 0 1 0-7 5.5 5.5 0 0 1 10.7-1.8A4.2 4.2 0 1 1 18 16.5h-2.2',
      'M9 16.5h3',
      'm11 13.5 3 3-3 3'
    ]
  },
  {
    title: 'Your host capabilities',
    code: 'tasks · fs · shell · notifications',
    description: 'explicit access for Trusted Plugins',
    iconPaths: ['M12 3 20 6.5v5.7c0 4.5-3.1 7.4-8 8.8-4.9-1.4-8-4.3-8-8.8V6.5L12 3Z', 'm8.8 12.1 2 2 4.6-4.8']
  }
] satisfies readonly PluginCapability[];

