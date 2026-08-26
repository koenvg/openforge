#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function runCommand(command, args, cwd, description) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    throw new Error(`Failed to run ${description}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${description} failed with exit code ${result.status ?? 1}.`);
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

const smokeRoot = mkdtempSync(join(tmpdir(), 'openforge-npm-pack-smoke-'));

try {
  for (const { packageDir, manifest } of candidates) {
    const packageSlug = manifest.name.replace(/^@/, '').replaceAll('/', '-');
    const packDir = join(smokeRoot, `${packageSlug}-pack`);
    const installDir = join(smokeRoot, `${packageSlug}-install`);
    mkdirSync(packDir);
    mkdirSync(installDir);

    console.log(`\n==> pnpm pack ${manifest.name}@${manifest.version}`);
    runCommand('pnpm', ['pack', '--pack-destination', packDir], packageDir, `pnpm pack for ${manifest.name}`);

    const tarballs = readdirSync(packDir).filter((entry) => entry.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new Error(`Expected one tarball for ${manifest.name}, found ${tarballs.length}.`);
    }

    writeFileSync(
      join(installDir, 'package.json'),
      `${JSON.stringify({ name: 'npm-install-smoke', private: true }, null, 2)}\n`,
    );

    console.log(`==> npm install ${manifest.name}@${manifest.version} packed tarball`);
    runCommand(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        join(packDir, tarballs[0]),
      ],
      installDir,
      `npm install for ${manifest.name}`,
    );
  }

  console.log(`\nPacked and npm-installed ${candidates.length} publishable package(s).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
