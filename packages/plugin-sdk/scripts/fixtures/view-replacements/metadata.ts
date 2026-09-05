import type { OpenForgePackageMetadata } from '@openforge-app/plugin-sdk'

// Copy this object into package.json#openforge after building frontend.js.
export const metadata = {
  id: 'acme.workspaces',
  apiVersion: 1,
  displayName: 'Example workspaces',
  description: 'Selectable project dashboard and task detail examples.',
  frontend: './dist/frontend.js',
  requires: ['viewReplacements', 'tasks'],
} satisfies OpenForgePackageMetadata
