#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const familyNames = ['packagedRuntime', 'mobileIos', 'ghosttyMac', 'whisperMac']

const isSharedRustInput = (path) => path === 'src-tauri/Cargo.toml'
  || path === 'src-tauri/Cargo.lock'
  || path.startsWith('.cargo/')
const isClassifierInput = (path) => path.startsWith('scripts/native-impact.') || path.startsWith('.github/actions/native-impact/')
const isWorkflow = (name) => (path) => path === `.github/workflows/${name}`
const isElectronPackagingInput = (path) => path.startsWith('scripts/electron-package')
  || path.startsWith('scripts/electron-build')
  || path === 'scripts/electron-process.mjs'
  || path.startsWith('scripts/desktop-test/daemon-')
  || path.startsWith('scripts/build-plugin-sdk-runtime.')
  || path.startsWith('scripts/build-terminal-runtime.')
  || path.startsWith('scripts/data-identity.')
  || path.startsWith('scripts/generate-desktop-ipc-registry.')
  || path.startsWith('scripts/rust-sidecar-layout.')
  || path === 'src-tauri/build.rs'
  || path === 'src-tauri/entitlements.plist'
  || path === 'builtin-plugins.json'
  || path === 'openforge-data-identity.json'
  || path === 'openforge-backend-layout.json'
  || path === 'package.json'
  || path === 'pnpm-lock.yaml'
  || path === 'pnpm-workspace.yaml'
  || path === 'tsconfig.json'
  || path === 'tsconfig.electron.json'
  || path.startsWith('vite.config.')
const isMobileInput = (path) => path.startsWith('apps/mobile_companion/')
  || path === 'scripts/mobile-companion'
  || path.startsWith('scripts/check-companion-dart-contract.')
  || path.startsWith('scripts/generate-companion-dart-client.')
  || path === 'docs/contracts/companion-v1.openapi.json'
const isGhosttyPreparationInput = (path) => path.startsWith('scripts/prepare-ghostty-vt.')
  || path.startsWith('.github/actions/prepare-ghostty/')
const isGhosttyInput = (path) => path.startsWith('src-tauri/ghostty-compat/')
  || path === 'src-tauri/src/terminal_model.rs'
  || path.startsWith('src-tauri/src/terminal_model/')
  || path.startsWith('src-tauri/crates/session-host/')
  || isGhosttyPreparationInput(path)
const isWhisperInput = (path) => path === 'config/whisper-portable-cpu.cmake'
  || path.startsWith('src-tauri/src/whisper_manager/')
  || path === 'src-tauri/src/app_invoke/whisper.rs'
  || (path.startsWith('src-tauri/src/app_invoke/') && path.toLowerCase().includes('whisper'))
  || path === 'src-tauri/tests/whisper_native.rs'
  || (path.startsWith('scripts/') && path.toLowerCase().includes('whisper'))

function allAffectedDecision(reason, { fullRun = false } = {}) {
  return {
    fullRun,
    uncertain: !fullRun,
    ...Object.fromEntries(familyNames.map((family) => [family, true])),
    reasons: Object.fromEntries(familyNames.map((family) => [family, [reason]])),
  }
}

function isValidChangedPath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.startsWith('/')
    && !path.includes('\0')
    && !path.split('/').includes('..')
}

const familyMatchers = {
  packagedRuntime: [
    (path) => path.startsWith('src-tauri/crates/session-'),
    isSharedRustInput,
    isClassifierInput,
    isWorkflow('packaged-session-runtime.yml'),
    isElectronPackagingInput,
    isGhosttyPreparationInput,
  ],
  mobileIos: [
    isMobileInput,
    isClassifierInput,
    isWorkflow('native-compatibility.yml'),
  ],
  ghosttyMac: [
    isGhosttyInput,
    isSharedRustInput,
    isClassifierInput,
    isWorkflow('native-compatibility.yml'),
  ],
  whisperMac: [
    isWhisperInput,
    isSharedRustInput,
    isClassifierInput,
    isWorkflow('whisper-macos.yml'),
    isElectronPackagingInput,
    isGhosttyPreparationInput,
  ],
}

export function classifyNativeImpact({ changedPaths = [], fullRunEvent, uncertainty } = {}) {
  const reasons = Object.fromEntries(familyNames.map((family) => [family, []]))

  if (fullRunEvent === 'schedule' || fullRunEvent === 'workflow_dispatch') {
    return allAffectedDecision(`full-run:${fullRunEvent}`, { fullRun: true })
  }

  if (uncertainty) {
    return allAffectedDecision(`uncertain:${uncertainty}`)
  }

  if (!Array.isArray(changedPaths) || changedPaths.some((path) => !isValidChangedPath(path))) {
    return allAffectedDecision('uncertain:malformed-input')
  }

  for (const path of [...new Set(changedPaths)].sort()) {
    for (const family of familyNames) {
      if (familyMatchers[family].some((matches) => matches(path))) {
        reasons[family].push(path)
      }
    }
  }

  return {
    fullRun: false,
    uncertain: false,
    ...Object.fromEntries(familyNames.map((family) => [family, reasons[family].length > 0])),
    reasons,
  }
}

function revisionRequest(base, head) {
  if (typeof base !== 'string' || base.length === 0 || typeof head !== 'string' || head.length === 0) {
    return { uncertainty: 'missing-revision' }
  }
  if (/^0+$/.test(base)) {
    return { uncertainty: 'unavailable-base-revision' }
  }
  return { base, head }
}

export function nativeImpactRequestForEvent(eventName, event) {
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    return { fullRunEvent: eventName }
  }

  if (eventName === 'pull_request') {
    return revisionRequest(event?.pull_request?.base?.sha, event?.pull_request?.head?.sha)
  }

  if (eventName === 'push') {
    return revisionRequest(event?.before, event?.after)
  }

  return { uncertainty: `unsupported-event:${eventName}` }
}

function argumentValue(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index === args.length - 1) {
    throw new Error(`Missing required ${name} argument`)
  }
  return args[index + 1]
}

function appendDecisionOutputs(decision, outputPath) {
  if (!outputPath) return
  const outputNames = [...familyNames, 'fullRun', 'uncertain']
  appendFileSync(outputPath, `${outputNames.map((name) => `${name}=${decision[name]}`).join('\n')}\n`)
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '\\n')
}

function appendDecisionSummary(decision, summaryPath) {
  if (!summaryPath) return
  const rows = familyNames.map((family) => {
    const disposition = decision[family] ? 'run' : 'skip'
    const reasons = decision.reasons[family].map(markdownCell).join(', ') || 'No matched paths'
    return `| ${family} | ${disposition} | ${reasons} |`
  })
  appendFileSync(summaryPath, [
    '## Native impact',
    '',
    '| Family | Decision | Reasons |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n'))
}

function parseNulDelimitedPaths(bytes) {
  if (bytes.length === 0) return []
  if (bytes.at(-1) !== 0) {
    throw new Error('Changed-path input must end with a NUL delimiter')
  }

  const decoder = new TextDecoder('utf-8', { fatal: true })
  return bytes.subarray(0, -1).toString('binary').split('\0').map((value) => {
    return decoder.decode(Buffer.from(value, 'binary'))
  })
}

function readNulDelimitedPaths(path) {
  return parseNulDelimitedPaths(readFileSync(path))
}

export function collectChangedPaths({ repository, base, head }) {
  const output = execFileSync('git', [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    base,
    head,
  ], {
    cwd: repository,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parseNulDelimitedPaths(output)
}

export function evaluateNativeImpact({ eventName, event, repository }) {
  const request = nativeImpactRequestForEvent(eventName, event)
  if (request.uncertainty) {
    return {
      eventName,
      request,
      changedPaths: [],
      decision: classifyNativeImpact({ uncertainty: request.uncertainty }),
    }
  }
  if (request.fullRunEvent) {
    return {
      eventName,
      request,
      changedPaths: [],
      decision: classifyNativeImpact({ fullRunEvent: request.fullRunEvent }),
    }
  }

  let changedPaths
  try {
    changedPaths = collectChangedPaths({ repository, ...request })
  } catch {
    return {
      eventName,
      request,
      changedPaths: [],
      collectionError: 'git diff failed',
      decision: classifyNativeImpact({ uncertainty: 'git-diff-failed' }),
    }
  }
  return {
    eventName,
    request,
    changedPaths,
    decision: classifyNativeImpact({ changedPaths }),
  }
}

function runCli(args) {
  const [command, ...options] = args
  if (command === 'classify') {
    const decision = classifyNativeImpact({
      changedPaths: readNulDelimitedPaths(argumentValue(options, '--paths-file')),
    })
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`)
    return
  }

  if (command === 'collect') {
    const eventName = argumentValue(options, '--event-name')
    const event = JSON.parse(readFileSync(argumentValue(options, '--event-path'), 'utf8'))
    const evidence = evaluateNativeImpact({
      eventName,
      event,
      repository: argumentValue(options, '--repository'),
    })
    writeFileSync(argumentValue(options, '--output'), `${JSON.stringify(evidence, null, 2)}\n`)
    appendDecisionOutputs(evidence.decision, process.env.GITHUB_OUTPUT)
    appendDecisionSummary(evidence.decision, process.env.GITHUB_STEP_SUMMARY)
    return
  }

  throw new Error('Usage: native-impact.mjs <classify|collect> [options]')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
