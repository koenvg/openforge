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
    const ciCommentStep = getStep(workflow, 'Post or clean CI comments');

    expect(ciCommentStep).toContain('/tmp/rust-results/clippy-exit-code');
    expect(ciCommentStep).toContain('/tmp/rust-logs/rust-clippy.log');
    expect(ciCommentStep).toContain('### Clippy');
  });

  it('reports formatting failures in the Rust CI comment', () => {
    const workflow = readWorkflow();
    const ciCommentStep = getStep(workflow, 'Post or clean CI comments');

    expect(ciCommentStep).toContain('/tmp/rust-results/format-exit-code');
    expect(ciCommentStep).toContain('/tmp/rust-logs/rust-format.log');
    expect(ciCommentStep).toContain('### Formatting');
    expect(ciCommentStep).toContain('failed: rustFormatFailed || rustClippyFailed || rustTestsFailed');
    expect(ciCommentStep).toContain('maxLength: 65000');
  });

  it('renders simple Rust log sections through a shared helper', () => {
    const workflow = readWorkflow();
    const ciCommentStep = getStep(workflow, 'Post or clean CI comments');

    expect(ciCommentStep).toContain('function renderRustLogSection');
    expect(ciCommentStep.match(/log\.slice\(-30000\)/g)).toHaveLength(1);
    expect(ciCommentStep).toContain(
      'core.warning(`Unable to read ${warningLabel} log: ${describeError(error)}`)',
    );
    expect(ciCommentStep).toContain(
      "renderRustLogSection('### Formatting', '/tmp/rust-logs/rust-format.log', 'Rust formatting')",
    );
    expect(ciCommentStep).toContain(
      "renderRustLogSection('### Clippy', '/tmp/rust-logs/rust-clippy.log', 'Rust Clippy')",
    );
  });
});
