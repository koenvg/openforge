import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CI workflow', () => {
  const readWorkflow = () => readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

  function getJob(workflow: string, jobName: string): string {
    const match = workflow.match(new RegExp(`\\n  ${jobName}:[\\s\\S]*?(?=\\n  [a-z][a-z-]*:|$)`));
    expect(match, `Expected to find job named ${jobName}`).not.toBeNull();
    return match?.[0] ?? '';
  }

  it('fails the Rust job when Clippy emits warnings', () => {
    const rustJob = getJob(readWorkflow(), 'rust');

    expect(rustJob).toContain('components: rustfmt, clippy');
    expect(rustJob).toContain('cargo clippy --all-targets -- -D warnings');
    expect(rustJob).toContain('/tmp/rust-clippy.log');
    expect(rustJob).toContain('/tmp/ci-results/clippy-exit-code');
    expect(rustJob).toContain("steps.clippy.outputs.exit_code != '0'");
  });

  it('runs the cross-platform Ghostty gate through its isolated compatibility crate', () => {
    const ghosttyJob = getJob(readWorkflow(), 'ghostty-compatibility');

    expect(ghosttyJob).toContain(
      'cargo test --manifest-path ghostty-compat/Cargo.toml --locked --offline terminal_model::',
    );

    const mainManifest = readFileSync(resolve(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8');
    const compatibilityManifest = readFileSync(
      resolve(process.cwd(), 'src-tauri/ghostty-compat/Cargo.toml'),
      'utf8',
    );
    const ghosttyDependency = (manifest: string) =>
      manifest.match(/^libghostty-vt = .*$/m)?.[0];

    expect(ghosttyDependency(mainManifest)).toBeTruthy();
    expect(ghosttyDependency(compatibilityManifest)).toBe(ghosttyDependency(mainManifest));
  });
});
