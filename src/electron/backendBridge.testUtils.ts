import type { SidecarLaunchConfig } from './sidecar'

export function sidecarConfig(): SidecarLaunchConfig {
  return {
    command: 'openforge-sidecar',
    args: [],
    env: {},
    host: '127.0.0.1',
    port: 17642,
    token: 'launch-token',
    baseUrl: 'http://127.0.0.1:17642',
    healthUrl: 'http://127.0.0.1:17642/app/health',
    readinessUrl: 'http://127.0.0.1:17642/app/readiness',
    eventUrl: 'http://127.0.0.1:17642/app/events',
  }
}
