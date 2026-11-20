#!/usr/bin/env node
/**
 * HarGlobal / HarScience profile repair.
 *
 * The desktop launcher refuses a profile whose bundle resolves outside it, which is exactly what
 * pnpm records when a plugin is installed from a local directory ("link:"). This script replaces
 * every such dependency with a tarball packed into the profile, drops the leftover symlinks,
 * verifies the composition the launcher uses, and prunes old backup folders.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const NL = String.fromCharCode(10)
const SLASH = String.fromCharCode(47)
/** Install home this copy lives in: <home>/resources/tools/fix-link.mjs. */
const HERE = dirname(fileURLToPath(import.meta.url))
const SELF_HOME = resolve(HERE, String.fromCharCode(46,46), String.fromCharCode(46,46))
const HOMES = (process.env.FIXLINK_HOMES ?? SELF_HOME).split(',').filter(Boolean)
const NODE = process.env.FIXLINK_NODE ?? process.execPath
const KEEP_BACKUPS = 3

/** The pnpm this product ships, so the profile's own store settings apply. */
function pnpmFor(home) {
  const bundled = join(home, 'resources/runtime/pnpm/bin/pnpm.cjs')
  if (existsSync(bundled)) return bundled
  const fallback = process.env.FIXLINK_PNPM
  return fallback !== undefined && existsSync(fallback) ? fallback : undefined
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function labelOf(home) {
  const parts = home.split(SLASH)
  return parts[parts.length - 1]
}

function isAbsolute(dir) {
  return dir.startsWith(SLASH) || (dir.length > 1 && dir[1] === ':')
}

/** Pack the linked package into the profile's plugins directory and return the file name. */
function packTarball({ dir, name, version, profile, pnpm }) {
  const plugins = join(profile, 'plugins')
  mkdirSync(plugins, { recursive: true })
  const base = name.split('@').join('').split(SLASH).join('-') + '-' + version + '.tgz'
  const target = join(plugins, base)
  if (existsSync(target)) return base
  run(NODE, [pnpm, 'pack', '--pack-destination', plugins], dir)
  if (!existsSync(target)) throw new Error('pnpm pack produced no ' + base)
  return base
}

/** Recompute the launcher's containment check over the profile's bundles. */
async function verify(profile) {
  const appBoot = join(profile, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')
  if (!existsSync(appBoot)) return { ok: false, reason: 'app-boot is missing from the profile' }
  const { loadProfileDirectory } = await import(pathToFileURL(appBoot).href)
  const loaded = loadProfileDirectory('dsh desktop', profile, join(profile, 'node_modules/@deepseek-ai/dsh/package.json'))
  const root = realpathSync(profile)
  const outside = []
  for (const layer of loaded.layers) {
    let real
    try {
      real = realpathSync(layer.packageDir)
    } catch {
      outside.push(layer.packageName + ' -> missing')
      continue
    }
    if (real !== root && !real.startsWith(root + sep)) outside.push(layer.packageName + ' -> ' + real)
  }
  return { ok: outside.length === 0, layers: loaded.layers.length, outside }
}

function pruneBackups(home) {
  const dataDir = join(home, 'data')
  if (!existsSync(dataDir)) return
  const backups = readdirSync(dataDir).filter((entry) => entry.startsWith('_repair-backup-')).sort().reverse()
  const stale = backups.slice(KEEP_BACKUPS)
  for (const entry of stale) {
    try {
      rmSync(join(dataDir, entry), { recursive: true, force: true })
    } catch {
      /* a locked folder stays; the next run retries */
    }
  }
  if (stale.length > 0) console.log('  pruned ' + String(stale.length) + ' old backup folder(s), kept ' + String(KEEP_BACKUPS))
}

async function repair(home) {
  const profile = join(home, 'data/profiles/desktop')
  const manifestPath = join(profile, 'package.json')
  const label = labelOf(home)
  if (!existsSync(manifestPath)) {
    console.log('- ' + label + ': no desktop profile, skipped')
    return true
  }
  const pnpm = pnpmFor(home)
  if (pnpm === undefined) {
    console.log('- ' + label + ': no bundled pnpm, skipped')
    return false
  }

  const manifest = readJson(manifestPath)
  const linked = Object.entries(manifest.dependencies ?? {}).filter((entry) => entry[1].startsWith('link:'))
  console.log('- ' + label + ': ' + String(linked.length) + ' link: dependency entries')

  if (linked.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = join(home, 'data', '_repair-backup-' + stamp + '-link')
    mkdirSync(backup, { recursive: true })
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      const from = join(profile, file)
      if (existsSync(from)) copyFileSync(from, join(backup, file))
    }
    console.log('  backup: ' + backup)

    for (const entry of linked) {
      const name = entry[0]
      const dir = entry[1].slice(5)
      const source = isAbsolute(dir) ? dir : join(profile, dir)
      const pkgFile = join(source, 'package.json')
      if (!existsSync(pkgFile)) {
        console.log('  ! ' + name + ': linked directory is gone (' + source + ') — remove it in the plugin manager')
        continue
      }
      const pkg = readJson(pkgFile)
      const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0'
      let base
      try {
        base = packTarball({ dir: source, name, version, profile, pnpm })
      } catch (error) {
        console.log('  ! ' + name + ': packing failed — ' + String(error.message).split(NL)[0])
        continue
      }
      try {
        run(NODE, [pnpm, 'add', 'file:plugins/' + base, '--offline'], profile)
      } catch {
        run(NODE, [pnpm, 'add', 'file:plugins/' + base], profile)
      }
      const installed = join(profile, 'node_modules', ...name.split(SLASH))
      try {
        if (lstatSync(installed).isSymbolicLink()) rmSync(installed, { force: true })
      } catch {
        /* already a real directory */
      }
      console.log('  + ' + name + '@' + version + ' -> file:plugins/' + base)
    }
  }

  const result = await verify(profile)
  if (result.ok) console.log('  ok: ' + String(result.layers) + ' bundles, none outside the profile')
  else console.log('  FAILED: ' + (result.reason ?? result.outside.join('; ')))
  pruneBackups(home)
  return result.ok
}

let allOk = true
for (const home of HOMES) {
  if (!existsSync(home)) continue
  try {
    allOk = (await repair(home)) && allOk
  } catch (error) {
    allOk = false
    console.log('- ' + home + ': repair failed — ' + String(error.message))
  }
}
console.log(allOk ? 'DONE: profiles are bootable. Start HarGlobal again.' : 'DONE with problems: read the lines above.')
process.exitCode = allOk ? 0 : 1
