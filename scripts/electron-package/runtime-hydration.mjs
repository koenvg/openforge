import { join } from 'node:path'
import { runBuildCommand } from './commands.mjs'
import { assertExists, pathExists } from './file-system.mjs'

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

export async function hydrateElectronTemplate({
  electronPackageRoot,
  electronTemplatePath,
  runCommand = runBuildCommand,
  maxAttempts = 3,
  retryDelayMs = 1_000,
  sleep: wait = sleep,
} = {}) {
  if (await pathExists(electronTemplatePath)) {
    return { hydrated: false }
  }

  const installScriptPath = join(electronPackageRoot, 'install.js')
  await assertExists(installScriptPath, 'Electron install script')
  console.log(`Electron app template missing; hydrating Electron runtime via ${installScriptPath}`)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runCommand(process.execPath, ['install.js'], { cwd: electronPackageRoot })
      break
    } catch (error) {
      if (attempt === maxAttempts) throw error
      const delayMs = retryDelayMs * attempt
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Electron runtime hydration attempt ${attempt}/${maxAttempts} failed: ${message}. Retrying in ${delayMs}ms.`)
      await wait(delayMs)
    }
  }

  if (!(await pathExists(electronTemplatePath))) {
    throw new Error(`Electron app template not found at ${electronTemplatePath} after running ${installScriptPath}. Run pnpm rebuild electron or reinstall dependencies with Electron binary downloads enabled.`)
  }

  return { hydrated: true }
}
