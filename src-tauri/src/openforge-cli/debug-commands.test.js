import { describe, expect, it } from 'vitest';

import { runCliAgainstJsonBridge } from './cli-test-utils.js';

describe('OpenForge debug commands', () => {
  it('prints read-only process memory diagnostics through the nested debug command', async () => {
    const response = {
      sidecar: { pid: 10, rssBytes: 1024, totalTreeRssBytes: 3072, command: 'openforge' },
      pluginHost: {
        state: 'Running',
        rootPid: 20,
        rootRssBytes: 4096,
        totalTreeRssBytes: 4096,
        runtimeMetricsStatus: 'available',
        v8MemoryUsage: {
          rssBytes: 4000,
          heapTotalBytes: 3000,
          heapUsedBytes: 2000,
          externalBytes: 1000,
          arrayBuffersBytes: 500,
        },
        plugins: [{
          pluginId: 'com.example.memory',
          state: 'ready',
          active: true,
          activationCount: 2,
          reloadCount: 1,
        }],
        pluginCount: 1,
        pluginsTruncated: false,
      },
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
