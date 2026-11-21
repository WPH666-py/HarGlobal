/**
 * Patch the installed `dsh-workbuddy-connect` host bundle so its models carry a Models-page row.
 *
 * WHY THIS IS NOT CONFIGURATION. The Models section lists *configurable* providers — the entries a
 * plugin declares through `llm.registerConfigurableProviders`. The WorkBuddy plugin registers an
 * adapter and a model catalogue but never that entry, so its models work while the Models page
 * shows no WorkBuddy row: the user sees a provider with no card. Trae and Qoder declare the entry;
 * this patch makes WorkBuddy declare the same one for each of its two variants.
 *
 *   node scripts/patch-workbuddy-providers.mjs <node_modules directory>
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs, report } from './lib/patch-check.mjs'

/** Package that owns the registration. */
const PACKAGE = 'dsh-workbuddy-connect'
/** Host bundle the plugin loads. */
const BUNDLE = join('lib', 'index.js')

const REGISTER = '\t\tconst releaseAdapter = ctx.llm.registerAdapter([variant.id], workbuddy.adapter);'
const DECLARE = [
  REGISTER,
  '\t\t// A configurable-provider entry is what gives the Models page a row; without it the models',
  '\t\t// resolve but the page lists the plugin nowhere.',
  '\t\tconst releaseDirectory = typeof ctx.llm.registerConfigurableProviders === "function"',
  '\t\t\t? ctx.llm.registerConfigurableProviders([{',
  '\t\t\t\tprovider: variant.id,',
  '\t\t\t\tdisplayName: variant.displayName,',
  '\t\t\t\tsettingsNs: variant.id,',
  '\t\t\t\tsettingsPath: []',
  '\t\t\t}])',
  '\t\t\t: undefined;',
].join('\n')

const CLEANUP_BEFORE = [
  '\t\t\tctx.effect(() => () => {',
  '\t\t\t\treleaseAdapter();',
  '\t\t\t\tshim.close();',
].join('\n')
const CLEANUP_AFTER = [
  '\t\t\tctx.effect(() => () => {',
  '\t\t\t\treleaseAdapter();',
  '\t\t\t\tif (releaseDirectory !== undefined) releaseDirectory();',
  '\t\t\t\tshim.close();',
].join('\n')

/**
 * Report whether the bundle already declares the entry.
 * @param source - bundle text.
 * @returns whether the patch is present.
 */
export function hasWorkbuddyProviders(source) {
  return source.includes('registerConfigurableProviders([{') && source.includes('releaseDirectory')
}

/**
 * Apply the patch to one installed tree.
 * @param root - node_modules directory holding the package.
 * @returns one line describing the outcome.
 */
export function patchWorkbuddyProviders(root) {
  const file = join(root, PACKAGE, BUNDLE)
  if (!existsSync(file)) return `no ${PACKAGE} at ${root}`
  const source = readFileSync(file, 'utf8')
  if (hasWorkbuddyProviders(source)) return `already declared in ${file}`
  if (!source.includes(REGISTER) || !source.includes(CLEANUP_BEFORE)) return `unexpected bundle in ${file}`
  writeFileSync(file, source.replace(REGISTER, DECLARE).replace(CLEANUP_BEFORE, CLEANUP_AFTER))
  return `declared WorkBuddy providers in ${file}`
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('patch-workbuddy-providers.mjs')) {
  const options = parseArgs(process.argv.slice(2))
  if (options.root === undefined) report('workbuddy-providers', '', 'drifted', 'usage: node scripts/patch-workbuddy-providers.mjs <node_modules>')
  else report('workbuddy-providers', options.root, 'patched', patchWorkbuddyProviders(options.root))
}
