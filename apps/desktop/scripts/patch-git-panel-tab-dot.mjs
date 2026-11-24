/**
 * Stop the installed `@xbzbing/dsh-git-panel` client from painting a status dot on its own tab.
 *
 * WHY THIS IS NOT CONFIGURATION. The plugin carries one display setting, `showInputPill`. Hiding the
 * pill does not remove the branch status from the page: the tab component then computes
 *
 *     l = showInputPill === false ? (dirty ? "dirty" : "synced") : null
 *
 * and hands the result to the tab painter, which appends `gp-tab-dot` in a success or warning colour
 * ("shown only when the input-bar marker is hidden", as its own stylesheet says). A product that
 * hides the pill therefore gets a dot under the tab instead, and no setting removes it — the plugin
 * has no other display option.
 *
 * This product wants neither marker, so the computation is replaced with `null`. The painter's own
 * null branch removes a dot an earlier load left behind, so a page that already rendered one clears
 * it on the next load. One exact replacement against the bundle's own text: a bundle that lost the
 * anchor fails loudly instead of shipping a tab that still carries the marker.
 *
 *   node scripts/patch-git-panel-tab-dot.mjs [--check] <node_modules directory>
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, report } from './lib/patch-check.mjs'

/** Package that paints the tab dot. */
const PACKAGE = join('@xbzbing', 'dsh-git-panel')
/** Client bundle the Web host loads for that package. */
const BUNDLE = join('lib', 'client.js')

/** The status the tab component derives when the input pill is hidden. */
const BEFORE = 'l=n.state==="ready"&&n.snapshot.showInputPill===!1?n.snapshot.dirty?"dirty":"synced":null'

/** The same binding, with no status for the painter to render. */
const AFTER = 'l=null/* tab dot removed: the tab carries no status marker */'

/**
 * Whether a bundle already carries the replacement.
 * @param source - bundle text.
 * @returns whether the tab no longer carries a status.
 */
export function hasTabDotPatch(source) {
  return source.includes(AFTER)
}

/**
 * Patch one installed tree.
 *
 * Reports rather than throws when the package is absent: a seed that does not ship the Git panel
 * has nothing to patch, and failing there would block every such profile.
 * @param root - directory that contains `node_modules`.
 * @returns one line describing what happened.
 */
export function patchGitPanelTabDot(root) {
  const target = join(root, PACKAGE, BUNDLE)
  if (!existsSync(target)) return `patch-git-panel-tab-dot: ${PACKAGE} is not installed in ${root}`
  const source = readFileSync(target, 'utf8')
  if (hasTabDotPatch(source)) return `patch-git-panel-tab-dot: ${target} already carries the patch`
  if (!source.includes(BEFORE)) {
    throw new Error(`desktop seed: ${PACKAGE} no longer derives the tab dot where this patch expects it (${target})`)
  }
  const patched = source.replace(BEFORE, AFTER)
  writeFileSync(target, patched)
  const digest = createHash('sha256').update(patched).digest('hex')
  return `patch-git-panel-tab-dot: patched ${target} (${String(patched.length)} bytes, sha256 ${digest})`
}

/**
 * Require the patch in a tree the seed produced.
 *
 * Runs against the materialized profile, not the seed store, so a store archive that missed the
 * patch fails here instead of in a person's browser.
 * @param root - materialized profile directory (contains `node_modules`).
 */
export function verifyGitPanelTabDot(root) {
  const target = join(root, PACKAGE, BUNDLE)
  if (!existsSync(target)) return
  if (!hasTabDotPatch(readFileSync(target, 'utf8'))) {
    throw new Error(`desktop seed: ${PACKAGE} still paints a status dot on its tab (${target})`)
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === join(process.argv[1])) {
  const { check, root } = parseArgs(process.argv.slice(2))
  if (root === undefined) throw new Error('usage: patch-git-panel-tab-dot.mjs [--check] <node_modules directory>')
  if (check) {
    const target = join(root, PACKAGE, BUNDLE)
    if (!existsSync(target)) report('git-panel-tab-dot', root, 'absent', target)
    const source = readFileSync(target, 'utf8')
    if (hasTabDotPatch(source)) report('git-panel-tab-dot', root, 'patched', target)
    if (source.includes(BEFORE)) report('git-panel-tab-dot', root, 'pristine', target)
    report('git-panel-tab-dot', root, 'drifted', `neither the patched nor the original tab status is in ${target}`)
  }
  console.log(patchGitPanelTabDot(root))
}
