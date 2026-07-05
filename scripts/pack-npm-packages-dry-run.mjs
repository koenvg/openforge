#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const packagesDir = join(repoRoot, 'packages');

function readPackageJson(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json');
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const candidates = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const packageDir = join(packagesDir, entry.name);
    return { packageDir, manifest: readPackageJson(packageDir) };
  })
  .filter(({ manifest }) => manifest.private !== true && manifest.publishConfig);

if (candidates.length === 0) {
  console.error('No publishable packages found under packages/* (expected publishConfig and private !== true).');
  process.exit(1);
}

for (const { packageDir, manifest } of candidates) {
  console.log(`\n==> npm pack --dry-run ${manifest.name}@${manifest.version}`);
  const result = spawnSync('npm', ['pack', '--dry-run'], {
    cwd: packageDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`Failed to run npm pack for ${manifest.name}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`npm pack --dry-run failed for ${manifest.name} with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

console.log(`\nValidated npm pack dry-runs for ${candidates.length} publishable package(s).`);
