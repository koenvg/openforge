#!/usr/bin/env node

import { runCommandLine } from './command-line.js';
import { printCommandHelp, printHelp } from './help.js';
import { PLUGIN_COMMAND_SPECS } from './plugin-commands.js';
import { PLUGIN_MANAGEMENT_COMMAND_SPECS } from './plugin-management-commands.js';
import { DEBUG_COMMAND_SPECS } from './debug-commands.js';
import {
  PROJECT_LABELS_COMMAND_SPEC,
  PROJECT_LIST_COMMAND_SPEC,
} from './project-commands.js';
import { TASK_COMMAND_SPECS } from './task-commands.js';

const COMMAND_SPECS = [
  ...TASK_COMMAND_SPECS,
  PROJECT_LIST_COMMAND_SPEC,
  ...DEBUG_COMMAND_SPECS,
  PROJECT_LABELS_COMMAND_SPEC,
  ...PLUGIN_COMMAND_SPECS,
  ...PLUGIN_MANAGEMENT_COMMAND_SPECS,
];

runCommandLine(process.argv.slice(2), COMMAND_SPECS, { printHelp, printCommandHelp }).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
