import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildInitialPrompt,
  buildOpenForgeCreateTaskCommand,
  extractFindingsFromJson,
  loadFindings,
  parseArgs,
  runCli,
  sortFindings
} from './export-clawpatch-findings-to-openforge.mjs';

function finding(overrides = {}) {
  return {
    schemaVersion: 1,
    findingId: 'fnd_1',
    featureId: 'feature_1',
    title: 'Unsafe external side effect',
    category: 'bug',
    severity: 'high',
    confidence: 'medium',
    evidence: [
      {
        path: 'scripts/example.mjs',
        startLine: 10,
        endLine: 12,
        symbol: 'run',
        quote: 'creates tasks without confirmation'
      }
    ],
    reasoning: 'The command mutates OpenForge state without explicit user intent.',
    reproduction: null,
    recommendation: 'Require --apply for task creation.',
    status: 'open',
    ...overrides
  };
}

function captureStream() {
  return {
    value: '',
    write(chunk) {
      this.value += String(chunk);
      return true;
    }
  };
}

describe('export clawpatch findings to OpenForge', () => {
  it('parses clawpatch report and state finding shapes', () => {
    const reportFindings = extractFindingsFromJson({ findings: [finding({ findingId: 'fnd_report' })] }, 'report.json');
    const stateFindings = extractFindingsFromJson(finding({ findingId: 'fnd_state' }), 'findings/fnd_state.json');

    expect(reportFindings).toHaveLength(1);
    expect(reportFindings[0]).toMatchObject({ findingId: 'fnd_report', source: 'report.json' });
    expect(stateFindings).toHaveLength(1);
    expect(stateFindings[0]).toMatchObject({ findingId: 'fnd_state', source: 'findings/fnd_state.json' });
  });

  it('loads directory inputs and sorts findings deterministically by priority then id', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawpatch-export-'));
    mkdirSync(join(root, 'findings'));
    writeFileSync(join(root, 'findings', 'medium.json'), JSON.stringify(finding({ findingId: 'fnd_b', severity: 'medium' })));
    writeFileSync(join(root, 'findings', 'critical.json'), JSON.stringify(finding({ findingId: 'fnd_c', severity: 'critical' })));
    writeFileSync(join(root, 'findings', 'high.json'), JSON.stringify(finding({ findingId: 'fnd_a', severity: 'high' })));

    expect(loadFindings(['findings'], root).map((item) => item.findingId)).toEqual(['fnd_c', 'fnd_a', 'fnd_b']);
    expect(sortFindings([
      finding({ findingId: 'fnd_b', severity: 'high' }),
      finding({ findingId: 'fnd_a', severity: 'high' })
    ]).map((item) => item.findingId)).toEqual(['fnd_a', 'fnd_b']);
  });

  it('defaults to dry-run, clawpatch label, and pi agent metadata', () => {
    const parsed = parseArgs([], '/repo');

    expect(parsed).toMatchObject({
      inputs: ['.clawpatch/findings'],
      worktree: '/repo',
      label: 'clawpatch',
      agent: 'pi',
      apply: false,
      dryRun: true
    });
  });

  it('builds prompts with finding details, evidence, source, label, and agent metadata', () => {
    const prompt = buildInitialPrompt(
      finding({ findingId: 'fnd_prompt', source: '.clawpatch/findings/fnd_prompt.json' }),
      { label: 'clawpatch', agent: 'pi' }
    );

    expect(prompt).toContain('OpenForge label: clawpatch');
    expect(prompt).toContain('Agent metadata: pi');
    expect(prompt).toContain('Source: .clawpatch/findings/fnd_prompt.json');
    expect(prompt).toContain('id: fnd_prompt');
    expect(prompt).toContain('severity: high');
    expect(prompt).toContain('confidence: medium');
    expect(prompt).toContain('category: bug');
    expect(prompt).toContain('scripts/example.mjs:10-12');
    expect(prompt).toContain('Require --apply for task creation.');
  });

  it('constructs the exact openforge create-task command', () => {
    const command = buildOpenForgeCreateTaskCommand(
      finding({ source: 'finding.json' }),
      { worktree: '/repo', label: 'clawpatch', agent: 'pi' }
    );

    expect(command.command).toBe('openforge');
    expect(command.args[0]).toBe('create-task');
    expect(command.args).toContain('--initial-prompt');
    expect(command.args).toContain('--worktree');
    expect(command.args).toContain('/repo');
    expect(command.args).toContain('--label');
    expect(command.args).toContain('clawpatch');
    expect(command.args).not.toContain('--depends-on');
  });

  it('does not spawn openforge in dry-run mode and emits JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawpatch-export-'));
    writeFileSync(join(root, 'finding.json'), JSON.stringify(finding({ findingId: 'fnd_dry' })));
    const stdout = captureStream();
    const spawnSyncImpl = vi.fn();

    const { exitCode, result } = await runCli(['--input', 'finding.json', '--json'], {
      cwd: root,
      stdout,
      stderr: captureStream(),
      spawnSyncImpl
    });

    expect(exitCode).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.taskCount).toBe(1);
    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.value)).toMatchObject({ dryRun: true, findingCount: 1, agent: 'pi', label: 'clawpatch' });
  });

  it('spawns openforge only when --apply is passed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawpatch-export-'));
    writeFileSync(join(root, 'finding.json'), JSON.stringify(finding({ findingId: 'fnd_apply' })));
    const spawnSyncImpl = vi.fn(() => ({ status: 0, stdout: '{"task_id":"KVG-new"}', stderr: '' }));

    const { exitCode, result } = await runCli([
      '--input', 'finding.json',
      '--worktree', '/repo',
      '--agent', 'pi',
      '--apply',
      '--json'
    ], {
      cwd: root,
      stdout: captureStream(),
      stderr: captureStream(),
      spawnSyncImpl
    });

    expect(exitCode).toBe(0);
    expect(result.dryRun).toBe(false);
    expect(spawnSyncImpl).toHaveBeenCalledTimes(1);
    expect(spawnSyncImpl.mock.calls[0][0]).toBe('openforge');
    expect(spawnSyncImpl.mock.calls[0][1]).toContain('create-task');
    expect(spawnSyncImpl.mock.calls[0][1]).toContain('/repo');
    expect(spawnSyncImpl.mock.calls[0][1]).toContain('--label');
    expect(spawnSyncImpl.mock.calls[0][1]).toContain('clawpatch');
    expect(spawnSyncImpl.mock.calls[0][1]).not.toContain('--depends-on');
  });
});
