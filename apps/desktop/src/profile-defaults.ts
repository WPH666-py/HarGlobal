/** Product defaults this build writes into a profile's own patch layer. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The patch layer a profile owns.
 *
 * `project-manager` copies the seed's copy into every materialized profile, and the settings editor
 * writes rows back into the same file, so it is the one place a product default and a person's
 * choice share.
 */
export const PROFILE_PATCH_FILE = 'cordis.patch.yml'

/** Package whose composer pill this build turns off. */
const GIT_PANEL_PACKAGE = join('node_modules', '@xbzbing', 'dsh-git-panel', 'package.json')

/** The setting that decides whether the Git pill renders in the conversation input. */
const PILL_SETTING = 'showInputPill: false'

const PILL_ROW = [
  '# The Git panel keeps the branch and the diff; a second entry in the input box only repeats it.',
  '- id: git-panel',
  "  name: '@xbzbing/dsh-git-panel'",
  '  config:',
  `    ${PILL_SETTING}`,
  '',
].join('\n')

/**
 * Turn off the Git pill in the conversation input, keeping the panel.
 *
 * The plugin renders the pill from a host snapshot field it reads from its own configuration, so
 * this is a setting rather than a rewrite of shipped bytes. Its row comes from the package's own
 * composition patch, which carries no product-level default, so the value is added here: the pill
 * shows the branch for every session whether or not a person asked for it, and the panel already
 * answers the same question on demand.
 *
 * Written only when the package is installed: an unmatched row would carry this product's `name`
 * into a profile that never asked for the plugin.
 * @param profile - profile root that owns the patch layer.
 * @param note - shell log sink.
 * @returns whether this call added the row.
 */
export function hideComposerGitPill(profile: string, note: (text: string) => void): boolean {
  if (!existsSync(join(profile, GIT_PANEL_PACKAGE))) return false
  const path = join(profile, PROFILE_PATCH_FILE)
  let text = ''
  if (existsSync(path)) {
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      note(`profile patch layer not read: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }
  if (text.includes(PILL_SETTING)) return false
  const separator = text === '' || text.endsWith('\n') ? '' : '\n'
  try {
    writeFileSync(path, `${text}${separator}${PILL_ROW}`)
    note('profile: the composer Git pill is off; the Git panel keeps its tab')
    return true
  } catch (error) {
    // The pill is cosmetic: a profile this process cannot write is already failing somewhere that
    // reports itself, and the row lands on the next start that can write it.
    note(`profile patch layer not written: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
