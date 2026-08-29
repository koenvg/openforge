import { printJson, requestJson } from './http-transport.js';

async function showProcessMemoryDiagnostics() {
  printJson(await requestJson('/debug/process-memory'));
}


async function showProcessMemoryHistory() {
  printJson(await requestJson('/debug/process-memory/history'));
}
export const DEBUG_COMMAND_SPECS = [
  {
    path: ['debug', 'process-memory'],
    flags: [],
    usage: 'openforge debug process-memory',
    handler: showProcessMemoryDiagnostics,
  },
  {
    path: ['debug', 'process-memory-history'],
    flags: [],
    usage: 'openforge debug process-memory-history',
    handler: showProcessMemoryHistory,
  },
];
