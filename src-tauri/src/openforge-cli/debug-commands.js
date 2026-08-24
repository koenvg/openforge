import { printJson, requestJson } from './http-transport.js';

async function showProcessMemoryDiagnostics() {
  printJson(await requestJson('/debug/process-memory'));
}

export const DEBUG_COMMAND_SPECS = [
  {
    path: ['debug', 'process-memory'],
    flags: [],
    usage: 'openforge debug process-memory',
    handler: showProcessMemoryDiagnostics,
  },
];
