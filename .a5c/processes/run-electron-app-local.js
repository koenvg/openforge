/**
 * @process openforge/run-electron-app-local
 * @description Install dependencies, launch the OpenForge Electron dev app locally, and verify the CLI bridge responds.
 * @process specializations/desktop-development/cross-platform-app-init
 * @process specializations/desktop-development/desktop-build-pipeline
 * @inputs { install: boolean, logPath: string, pidPath: string }
 * @outputs { success: boolean, install: object | null, launch: object, readiness: object }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const installTask = defineTask('electron-dev-install', () => ({
  kind: 'shell',
  title: 'Install project dependencies',
  description: 'Install workspace dependencies before launching the Electron development app.',
  shell: {
    command: 'pnpm i',
    cwd: '.'
  },
  labels: ['shell', 'install', 'electron']
}));

export const launchTask = defineTask('electron-dev-launch', (args) => ({
  kind: 'shell',
  title: 'Launch Electron development app',
  description: 'Start pnpm electron:dev as a detached local process and record its PID/log path.',
  shell: {
    command: [
      `mkdir -p "${args.runDir}"`,
      `if [ -f "${args.pidPath}" ] && kill -0 "$(cat "${args.pidPath}")" 2>/dev/null; then echo "electron:dev already running with PID $(cat "${args.pidPath}")"; else rm -f "${args.logPath}" "${args.pidPath}"; nohup pnpm electron:dev > "${args.logPath}" 2>&1 & echo $! > "${args.pidPath}"; echo "started electron:dev with PID $(cat "${args.pidPath}")"; fi`,
      `echo "log=${args.logPath}"`,
      `echo "pid=$(cat "${args.pidPath}")"`
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'launch', 'electron']
}));

export const readinessTask = defineTask('electron-dev-readiness', (args) => ({
  kind: 'shell',
  title: 'Verify Electron app readiness',
  description: 'Wait for the launched dev app to expose the OpenForge CLI bridge.',
  shell: {
    command: [
      `test -f "${args.pidPath}"`,
      `pid="$(cat "${args.pidPath}")"`,
      `for i in $(seq 1 180); do if ! kill -0 "$pid" 2>/dev/null; then echo "electron:dev exited before readiness"; tail -80 "${args.logPath}" || true; exit 1; fi; if openforge list-projects > "${args.bridgeOutputPath}" 2> "${args.bridgeErrorPath}"; then cat "${args.bridgeOutputPath}"; exit 0; fi; sleep 1; done`,
      `echo "CLI bridge did not become ready within 180s"`,
      `cat "${args.bridgeErrorPath}" || true`,
      `tail -120 "${args.logPath}" || true`,
      'exit 1'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'readiness', 'electron', 'cli-bridge']
}));

export async function process(inputs = {}, ctx) {
  const runDir = inputs.runDir || '.openforge-dev';
  const logPath = inputs.logPath || `${runDir}/electron-dev.log`;
  const pidPath = inputs.pidPath || `${runDir}/electron-dev.pid`;
  const bridgeOutputPath = inputs.bridgeOutputPath || `${runDir}/openforge-list-projects.out`;
  const bridgeErrorPath = inputs.bridgeErrorPath || `${runDir}/openforge-list-projects.err`;
  const shouldInstall = inputs.install !== false;

  const install = shouldInstall ? await ctx.task(installTask, {}) : null;
  const launch = await ctx.task(launchTask, { runDir, logPath, pidPath });
  const readiness = await ctx.task(readinessTask, {
    logPath,
    pidPath,
    bridgeOutputPath,
    bridgeErrorPath
  });

  return {
    success: true,
    install,
    launch,
    readiness,
    logPath,
    pidPath,
    metadata: {
      processId: 'openforge/run-electron-app-local',
      timestamp: ctx.now()
    }
  };
}
