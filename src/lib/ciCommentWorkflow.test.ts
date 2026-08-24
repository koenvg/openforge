import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CI comment workflow', () => {
  const readWorkflow = () => readFileSync(resolve(process.cwd(), '.github/workflows/ci-comment.yml'), 'utf8');

  function getStep(workflow: string, stepName: string): string {
    const match = workflow.match(new RegExp(`\\n      - name: ${stepName}[\\s\\S]*?(?=\\n      - name: |$)`));
    expect(match, `Expected to find step named ${stepName}`).not.toBeNull();
    return match?.[0] ?? '';
  }

  it('does not hide GitHub Script failures with empty catch blocks', () => {
    const workflow = readWorkflow();

    expect(workflow).not.toMatch(/catch\s*(?:\([^)]*\)\s*)?\{\s*\}/);
  });

  it('does not list workflow artifacts while resolving the PR number', () => {
    const workflow = readWorkflow();
    const getPrNumberStep = getStep(workflow, 'Get PR number');

    expect(getPrNumberStep).not.toContain('listWorkflowRunArtifacts');
  });

  it('reports Clippy failures in the Rust CI comment', () => {
    const workflow = readWorkflow();
    const rustCommentStep = getStep(workflow, 'Post or clean rust comment');

    expect(rustCommentStep).toContain('/tmp/rust-results/clippy-exit-code');
    expect(rustCommentStep).toContain('/tmp/rust-logs/rust-clippy.log');
    expect(rustCommentStep).toContain('### Clippy');
  });

  it('reports formatting failures in the Rust CI comment', () => {
    const workflow = readWorkflow();
    const rustCommentStep = getStep(workflow, 'Post or clean rust comment');

    expect(rustCommentStep).toContain('/tmp/rust-results/format-exit-code');
    expect(rustCommentStep).toContain('/tmp/rust-logs/rust-format.log');
    expect(rustCommentStep).toContain('### Formatting');
    expect(rustCommentStep).toContain('!formatFailed && !clippyFailed && !testsFailed');
    expect(rustCommentStep).toContain("(marker + '\\n' + body).slice(0, 65000)");
  });

  it('renders simple Rust log sections through a shared helper', () => {
    const workflow = readWorkflow();
    const rustCommentStep = getStep(workflow, 'Post or clean rust comment');

    expect(rustCommentStep).toContain('function renderLogSection');
    expect(rustCommentStep.match(/log\.slice\(-30000\)/g)).toHaveLength(1);
    expect(rustCommentStep).toContain(
      'core.warning(`Unable to read ${warningLabel} log: ${describeError(error)}`)',
    );
    expect(rustCommentStep).toContain(
      "renderLogSection('### Formatting', '/tmp/rust-logs/rust-format.log', 'Rust formatting')",
    );
    expect(rustCommentStep).toContain(
      "renderLogSection('### Clippy', '/tmp/rust-logs/rust-clippy.log', 'Rust Clippy')",
    );
  });
});
