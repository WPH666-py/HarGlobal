/** Normalization of the Git configuration shipped inside the bundled Bash runtime. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The system-wide Git configuration inside the bundled Bash package, relative to a profile root.
 *
 * The package carries its own Git for Windows, and only that Git reads this file, so the value
 * written here decides what a command run through the shell does when it has to authenticate.
 */
export const BUNDLED_GIT_CONFIG = join('node_modules', '@dsh-ops', 'bash-win32-x64', 'etc', 'gitconfig')

/** The setting that makes Git ask which credential helper to use instead of using one. */
const HELPER_PROMPT = 'helper = helper-selector'

/** The helper the same package ships, named rather than prompted for. */
const HELPER_ANSWER = 'helper = manager'

/**
 * Name the bundled credential helper instead of letting the bundle ask which one to use.
 *
 * Git for Windows ships this prompt so a new installation can choose: the first command that
 * authenticates opens a dialog listing `<no helper>`, `wincred` and `manager`. Inside the app that
 * dialog has no window to belong to, so it holds the command until someone finds it — a transfer
 * that simply never finishes. `manager` is the Git Credential Manager the package already carries
 * and resolves through the bundled `PATH`, so the replacement names no install-specific path and
 * behaves the same on every machine.
 *
 * Called on every Host start rather than once per install: a profile update reinstalls the package
 * and restores the shipped file, so the correction has to outlive the tree it corrects.
 * @param profile - profile root that owns the bundled package.
 * @param note - shell log sink.
 * @returns whether this call rewrote the file.
 */
export function normalizeBundledGitConfig(profile: string, note: (text: string) => void): boolean {
  const path = join(profile, BUNDLED_GIT_CONFIG)
  // A staged tree or a profile that is still being assembled has no package yet; the start that
  // follows the install corrects it.
  if (!existsSync(path)) return false
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    note(`bundled git config not read: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  if (!text.includes(HELPER_PROMPT)) return false
  try {
    writeFileSync(path, text.replace(HELPER_PROMPT, HELPER_ANSWER))
    note('bundled git: credential helper set to manager')
    return true
  } catch (error) {
    // The command still runs; it only asks the question again on the next authentication, which is
    // the behavior this call exists to end rather than a failure that blocks the launch.
    note(`bundled git config not updated: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
