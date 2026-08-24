import { describe, expect, it } from 'vitest';

import { runCliAgainstJsonBridge } from './cli-test-utils.js';

describe('OpenForge debug commands', () => {
  it('prints read-only process memory diagnostics through the nested debug command', async () => {
    const response = {
      sidecar: { pid: 10, rssBytes: 1024, totalTreeRssBytes: 3072, command: 'openforge' },
      pluginHost: null,
      ptyProcessTrees: [],
      totals: { trackedUniqueRssBytes: 3072 },
    };

    const result = await runCliAgainstJsonBridge(['debug', 'process-memory'], {
      url: '/debug/process-memory',
      response,
    });

    expect(result).toEqual(response);
  });
});
