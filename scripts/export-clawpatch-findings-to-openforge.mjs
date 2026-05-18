#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_LABEL = 'clawpatch';
const DEFAULT_AGENT = 'pi';
const DEFAULT_INPUTS = ['.clawpatch/findings'];
const SEVERITY_RANK = new Map([
  ['critical', 0],
  ['high', 1],
  ['medium', 2],
  ['low', 3]
]);

export function printHelp() {
  return `Export clawpatch findings into OpenForge tasks.

Usage:
  pnpm run clawpatch:export-openforge -- [options]

Options:
  --input <path>       Finding JSON file or directory. Repeatable. Defaults to .clawpatch/findings.
  --worktree <path>    Worktree path passed to openforge create-task. Defaults to current directory.
  --agent <name>       Agent metadata included in generated prompts. Defaults to ${DEFAULT_AGENT}.

Created tasks are labelled '${DEFAULT_LABEL}'.
  --apply              Create OpenForge tasks. Without this, the command is a dry run.
  --dry-run            Force dry-run mode (default).
  --json               Print machine-readable JSON.
  -h, --help           Show this help.
`;
}

export function parseArgs(argv, cwd = process.cwd()) {
  const options = {
    inputs: [],
    worktree: cwd,
    label: DEFAULT_LABEL,
    agent: DEFAULT_AGENT,
    apply: false,
    dryRun: true,
    json: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--':
        break;
      case '--input': {
        const value = argv[index + 1];
        if (!value) throw new Error('--input requires a path');
        options.inputs.push(value);
        index += 1;
        break;
      }
      case '--worktree': {
        const value = argv[index + 1];
        if (!value) throw new Error('--worktree requires a path');
        options.worktree = value;
        index += 1;
        break;
      }
      case '--agent': {
        const value = argv[index + 1];
        if (!value) throw new Error('--agent requires a name');
        options.agent = value;
        index += 1;
        break;
      }
      case '--apply':
        options.apply = true;
        options.dryRun = false;
        break;
      case '--dry-run':
        options.apply = false;
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.inputs.length === 0) {
    options.inputs = [...DEFAULT_INPUTS];
  }

  return options;
}

export function collectJsonFiles(inputPaths, cwd = process.cwd()) {
  const files = [];

  const visit = (inputPath) => {
    const absolutePath = resolve(cwd, inputPath);
    if (!existsSync(absolutePath)) {
      return;
    }

    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      const entries = readdirSync(absolutePath, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        visit(resolve(absolutePath, entry.name));
      }
      return;
    }

    if (stats.isFile() && absolutePath.endsWith('.json')) {
      files.push(absolutePath);
    }
  };

  for (const inputPath of inputPaths) {
    visit(inputPath);
  }

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function extractFindingsFromJson(value, source = 'inline') {
  const findings = [];

  const visit = (candidate, nestedSource) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, nestedSource);
      return;
    }

    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    const normalized = normalizeFinding(candidate, nestedSource);
    if (normalized) {
      findings.push(normalized);
      return;
    }

    for (const key of ['findings', 'items', 'results']) {
      if (Array.isArray(candidate[key])) {
        for (const item of candidate[key]) visit(item, nestedSource);
      }
    }
  };

  visit(value, source);
  return findings;
}

export function loadFindings(inputs, cwd = process.cwd()) {
  const files = collectJsonFiles(inputs, cwd);
  const byKey = new Map();

  for (const file of files) {
    const parsed = readJsonFile(file);
    for (const finding of extractFindingsFromJson(parsed, file)) {
      const key = finding.findingId || `${finding.source}:${finding.title}`;
      if (!byKey.has(key)) {
        byKey.set(key, finding);
      }
    }
  }

  return sortFindings([...byKey.values()]);
}

export function normalizeFinding(record, source = 'inline') {
  const findingId = stringOrNull(record.findingId ?? record.id);
  const title = stringOrNull(record.title ?? record.summary);
  const category = stringOrNull(record.category);
  const severity = normalizeEnum(record.severity, 'unknown');
  const confidence = normalizeEnum(record.confidence, 'unknown');
  const evidence = Array.isArray(record.evidence) ? record.evidence.map(normalizeEvidence) : [];
  const reasoning = stringOrNull(record.reasoning ?? record.description ?? record.body) ?? '';
  const recommendation = stringOrNull(record.recommendation ?? record.suggestedFix ?? record.suggestion) ?? '';

  if (!findingId || !title || (!category && evidence.length === 0 && !recommendation && !reasoning)) {
    return null;
  }

  return {
    findingId,
    featureId: stringOrNull(record.featureId),
    title,
    category: category ?? 'unknown',
    severity,
    confidence,
    status: stringOrNull(record.status) ?? 'unknown',
    evidence,
    reasoning,
    recommendation,
    reproduction: record.reproduction === null ? null : stringOrNull(record.reproduction),
    source
  };
}

function stringOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeEnum(value, fallback) {
  const normalized = stringOrNull(value)?.toLowerCase();
  return normalized ?? fallback;
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return { path: null, startLine: null, endLine: null, symbol: null, quote: String(evidence ?? '') };
  }

  return {
    path: stringOrNull(evidence.path),
    startLine: integerOrNull(evidence.startLine),
    endLine: integerOrNull(evidence.endLine),
    symbol: stringOrNull(evidence.symbol),
    quote: stringOrNull(evidence.quote)
  };
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

export function sortFindings(findings) {
  return [...findings].sort((left, right) => {
    const severityDelta = severityRank(left.severity) - severityRank(right.severity);
    if (severityDelta !== 0) return severityDelta;
    return compareStrings(left.findingId, right.findingId) ||
      compareStrings(left.title, right.title) ||
      compareStrings(left.source, right.source);
  });
}

function severityRank(severity) {
  return SEVERITY_RANK.get(String(severity).toLowerCase()) ?? 99;
}

function compareStrings(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''));
}

export function buildInitialPrompt(finding, options) {
  const evidence = finding.evidence.length > 0
    ? finding.evidence.map((item, index) => `${index + 1}. ${formatEvidence(item)}`).join('\n')
    : 'No evidence entries were provided by clawpatch.';

  return `Review and address this clawpatch finding in OpenForge.

OpenForge label: ${options.label}
Agent metadata: ${options.agent}
Source: ${finding.source}

Finding
- id: ${finding.findingId}
- feature: ${finding.featureId ?? 'unknown'}
- title: ${finding.title}
- severity: ${finding.severity}
- confidence: ${finding.confidence}
- category: ${finding.category}
- status: ${finding.status}

Evidence
${evidence}

Reasoning
${finding.reasoning || 'No reasoning provided.'}

Recommendation
${finding.recommendation || 'No recommendation provided.'}

Reproduction
${finding.reproduction || 'No reproduction provided.'}

Instructions
- First validate whether the finding is still accurate before editing code.
- Follow AGENTS.md and OpenForge conventions.
- Keep any fix narrow and include relevant verification.
- If the finding is invalid, document why and close/triage it rather than making speculative changes.
- The requested agent metadata is ${options.agent}; clawpatch itself should still use its supported provider configuration.`;
}

function formatEvidence(evidence) {
  const location = evidence.path
    ? `${evidence.path}${evidence.startLine ? `:${evidence.startLine}${evidence.endLine ? `-${evidence.endLine}` : ''}` : ''}`
    : 'unknown path';
  const symbol = evidence.symbol ? ` symbol=${evidence.symbol}` : '';
  const quote = evidence.quote ? ` quote=${JSON.stringify(evidence.quote)}` : '';
  return `${location}${symbol}${quote}`;
}

export function buildOpenForgeCreateTaskCommand(finding, options) {
  return {
    command: 'openforge',
    args: [
      'create-task',
      '--initial-prompt',
      buildInitialPrompt(finding, options),
      '--worktree',
      options.worktree,
      '--label',
      options.label
    ]
  };
}

export function buildPlan(findings, options) {
  return sortFindings(findings).map((finding) => ({
    finding,
    prompt: buildInitialPrompt(finding, options),
    command: buildOpenForgeCreateTaskCommand(finding, options)
  }));
}

export function applyPlan(plan, spawnSyncImpl = spawnSync) {
  return plan.map((item) => {
    const result = spawnSyncImpl(item.command.command, item.command.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return {
      findingId: item.finding.findingId,
      status: result.status ?? null,
      signal: result.signal ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error ? String(result.error.message ?? result.error) : null
    };
  });
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const cwd = dependencies.cwd ?? process.cwd();
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const spawnSyncImpl = dependencies.spawnSyncImpl ?? spawnSync;
  const options = parseArgs(argv, cwd);

  if (options.help) {
    stdout.write(printHelp());
    return { exitCode: 0, result: { help: true } };
  }

  const findings = loadFindings(options.inputs, cwd);
  const plan = buildPlan(findings, options);
  const created = options.apply ? applyPlan(plan, spawnSyncImpl) : [];
  const failures = created.filter((result) => result.status !== 0);
  const result = {
    dryRun: !options.apply,
    apply: options.apply,
    worktree: options.worktree,
    label: options.label,
    agent: options.agent,
    inputCount: options.inputs.length,
    findingCount: findings.length,
    taskCount: plan.length,
    tasks: plan.map((item) => ({
      findingId: item.finding.findingId,
      title: item.finding.title,
      severity: item.finding.severity,
      confidence: item.finding.confidence,
      category: item.finding.category,
      source: item.finding.source,
      prompt: item.prompt,
      command: item.command
    })),
    created
  };

  if (options.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    stdout.write(`${options.apply ? 'created' : 'dry-run'}: ${plan.length} OpenForge task${plan.length === 1 ? '' : 's'}\n`);
    for (const item of plan) {
      stdout.write(`- ${item.finding.findingId}: ${item.finding.title}\n`);
    }
  }

  if (failures.length > 0) {
    stderr.write(`openforge task creation failed for ${failures.length} finding(s)\n`);
    return { exitCode: 1, result };
  }

  return { exitCode: 0, result };
}

const entryUrl = pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (import.meta.url === entryUrl) {
  runCli().then(({ exitCode }) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
