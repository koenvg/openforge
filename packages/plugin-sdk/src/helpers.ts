import type { PluginCommandContribution, PluginContributionPoints, PluginViewContribution } from '../../../src/lib/plugin/types'

export function isPluginViewContribution(contribution: unknown): contribution is PluginViewContribution {
  return typeof contribution === 'object' && contribution !== null
    && 'id' in contribution && 'title' in contribution && 'icon' in contribution
}

export function isPluginCommandContribution(contribution: unknown): contribution is PluginCommandContribution {
  return typeof contribution === 'object' && contribution !== null
    && 'id' in contribution && 'title' in contribution
}

export function getViewContributions(contributes: PluginContributionPoints | undefined): PluginViewContribution[] {
  return contributes?.views ?? []
}

export function getCommandContributions(contributes: PluginContributionPoints | undefined): PluginCommandContribution[] {
  return contributes?.commands ?? []
}
