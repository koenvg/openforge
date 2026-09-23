import type { PluginEntry } from '../../../src/lib/plugin/types'

export const catalogPlugin: PluginEntry = {
  manifest: {
    id: 'com.openforge.catalog-integration', name: 'Catalog Integration', version: '1.2.0',
    apiVersion: 1, description: 'Adds review tools to the local catalog.',
    permissions: [], frontend: 'dist/frontend.js', backend: null,
  },
  state: 'active', error: null, sourceKind: 'local',
  sourceSpec: '/workspace/plugins/catalog-integration',
  installPath: '/workspace/plugins/catalog-integration',
  packageMetadata: null,
}
