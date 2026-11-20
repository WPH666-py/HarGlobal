/**
 * Assemble everything the installer ships beside `HarGlobal.exe`, and build the offline package.
 *
 * Tauri reads `bundle.resources` from disk, so the runtime and the shell pages have to exist under
 * `src-tauri/resources` before `tauri build` runs. The runtime is produced by the Electron build
 * pipeline and is staged here by **hard link** rather than copy: it lives on the same volume, a link
 * costs no space and no time, and nothing here ever writes to it. A volume that refuses a link
 * falls back to a real copy.
 *
 * THE SEED IS NOT STAGED BY DEFAULT. Package it into the installer and the installer is ~93 MB
 * against Gitee's 100 MB attachment limit — headroom that one release of ordinary growth would
 * spend. Instead the seed becomes its own published attachment
 * (`dist-artifacts/<product>-seed-<version>.tar.gz`, ~87 MB) which the first launch fetches once
 * and keeps. Setting `HARGLOBAL_SEED_IN_INSTALLER=1` stages it as well, producing the larger
 * installer for offline distribution; the application prefers a seed beside the runtime over
 * fetching one, so that build works with no network at all.
 */

import { cpSync, createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createZstdCompress, constants as zlibConstants } from 'node:zlib'
import { create as createTar } from 'tar'

/** zstd's own id for "the compression level", which Node's zlib passes straight through. */
const ZSTD_COMPRESSION_LEVEL = zlibConstants.ZSTD_c_compressionLevel

/**
 * The zstd executable this build compresses the offline package with, when the machine has one.
 *
 * The Node binding compresses on one thread, and the seed is large enough that the single-threaded
 * level-22 pass costs more than the whole rest of the build. A standalone zstd compresses the same
 * archive at level 19 with every core, which is several times faster for a few percent more bytes.
 * `HARGLOBAL_ZSTD_BIN` names an exact executable; otherwise the PATH is searched, then the copy
 * this repository vendors under `tools/zstd`, and a machine with neither falls back to the Node
 * binding at the same level.
 * @returns the executable path, or undefined when the machine has none.
 */
function zstdExecutable() {
  const explicit = process.env.HARGLOBAL_ZSTD_BIN
  if (explicit !== undefined && explicit !== '') return existsSync(explicit) ? explicit : undefined
  const separator = process.platform === 'win32' ? ';' : ':'
  const names = process.platform === 'win32' ? ['zstd.exe', 'zstd.cmd'] : ['zstd']
  for (const entry of (process.env.PATH ?? '').split(separator)) {
    if (entry === '') continue
    for (const name of names) {
      const candidate = join(entry, name)
      if (existsSync(candidate)) return candidate
    }
  }
  const vendored = join(REPO_ROOT, 'tools', 'zstd', 'zstd.exe')
  return process.platform === 'win32' && existsSync(vendored) ? vendored : undefined
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..')
const BUILD_ROOT = join(REPO_ROOT, 'apps', 'desktop', '.desktop-build', 'targets', 'win-x64')
const RESOURCE_ROOT = join(PACKAGE_ROOT, 'src-tauri', 'resources')
const ARTIFACT_ROOT = join(PACKAGE_ROOT, 'dist-artifacts')
const SEED_SOURCE = join(BUILD_ROOT, 'seed')
const SEED_STAGED = join(RESOURCE_ROOT, 'seed')

/**
 * Product this build ships.
 *
 * It appears in the archive's file name because the first launch looks for
 * `<product>-seed-<version>.tar.zst`, so the archive a build produces has to carry the same product
 * name as the installer that fetches it.
 */
const PRODUCT_NAME = 'HarGlobal'

/**
 * The version the installer will report.
 *
 * Three files carry this release's version and nothing bumps them together: `tauri.conf.json`
 * names the installer and the offline package, `Cargo.toml` names the crate, `Cargo.lock` records
 * it. The package-manifest bump in `scripts/release/bump.ts` reads `package.json` globs only, so a
 * release that forgets these three builds an installer under the *previous* version's name and
 * publishes it over that release's asset. Disagreement therefore fails here, loudly.
 *
 * @returns the version `tauri.conf.json` declares, which is the one file that defines it.
 */
function applicationVersion() {
  const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  if (typeof config.version !== 'string' || config.version === '') {
    throw new Error('prepare-shell: tauri.conf.json carries no version')
  }
  const crate = /^version = "([^"]+)"/m.exec(readFileSync(join(PACKAGE_ROOT, 'src-tauri', 'Cargo.toml'), 'utf8'))
  if (crate?.[1] !== config.version) {
    throw new Error(`prepare-shell: Cargo.toml declares ${String(crate?.[1])} while tauri.conf.json declares ${config.version}`)
  }
  const locked = /\[\[package\]\]\nname = "harglobal"\nversion = "([^"]+)"/.exec(readFileSync(join(PACKAGE_ROOT, 'src-tauri', 'Cargo.lock'), 'utf8'))
  if (locked?.[1] !== config.version) {
    throw new Error(`prepare-shell: Cargo.lock declares ${String(locked?.[1])} while tauri.conf.json declares ${config.version}`)
  }
  return config.version
}

/** Directories the shared payload pipeline prepared, and where each one lands in the bundle. */
const LINKED_TREES = [{ from: join(BUILD_ROOT, 'runtime'), to: join(RESOURCE_ROOT, 'runtime') }]

/**
 * Stage one directory as hard links, falling back to a copy.
 * @param from - populated source tree.
 * @param to - destination that receives the same structure.
 * @returns how many files were staged.
 */
function linkTree(from, to) {
  const stack = [[from, to]]
  let files = 0
  while (stack.length > 0) {
    const [source, target] = stack.pop()
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      if (entry.isDirectory()) {
        stack.push([sourcePath, targetPath])
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`prepare-shell: unsupported entry ${relative(from, sourcePath)}`)
      }
      try {
        linkSync(sourcePath, targetPath)
      } catch {
        cpSync(sourcePath, targetPath)
      }
      files += 1
    }
  }
  return files
}

if (!existsSync(SEED_SOURCE)) {
  throw new Error(
    `prepare-shell: ${SEED_SOURCE} is missing. Run the shared payload pipeline first:`
    + ' `pnpm --filter @deepseek-ai/dsh-desktop run prepare:package`.',
  )
}

for (const tree of LINKED_TREES) {
  if (!existsSync(tree.from)) {
    throw new Error(`prepare-shell: ${tree.from} is missing; run the shared payload pipeline first.`)
  }
  rmSync(tree.to, { recursive: true, force: true })
  const files = linkTree(tree.from, tree.to)
  process.stdout.write(`prepare-shell: staged ${String(files)} files into ${tree.to}\n`)
}

// The shell's own pages are small and are authored here, so they are copied rather than linked.
rmSync(join(RESOURCE_ROOT, 'shell'), { recursive: true, force: true })
cpSync(join(PACKAGE_ROOT, 'rsc'), join(RESOURCE_ROOT, 'shell'), { recursive: true })
process.stdout.write(`prepare-shell: copied the shell pages into ${join(RESOURCE_ROOT, 'shell')}\n`)

// Repair tools ship beside the app so a broken profile is fixable without the repository.
rmSync(join(RESOURCE_ROOT, 'tools'), { recursive: true, force: true })
cpSync(join(PACKAGE_ROOT, 'tools'), join(RESOURCE_ROOT, 'tools'), { recursive: true })
process.stdout.write(`prepare-shell: copied the tools into ${join(RESOURCE_ROOT, 'tools')}` + String.fromCharCode(10))

const version = applicationVersion()
const withSeed = process.env.HARGLOBAL_SEED_IN_INSTALLER === '1'
rmSync(SEED_STAGED, { recursive: true, force: true })
if (withSeed) {
  const files = linkTree(SEED_SOURCE, SEED_STAGED)
  process.stdout.write(`prepare-shell: staged ${String(files)} seed files into ${SEED_STAGED}\n`)
  process.stdout.write('prepare-shell: this installer carries the offline package and needs no network\n')
} else {
  process.stdout.write('prepare-shell: the seed is published separately; not staged into the installer\n')
}

// The offline package itself: one archive of the whole seed, so the first launch fetches one file,
// named after the release it belongs to. zstd rather than gzip because the download is the user's
// wall-clock and zstd is roughly a fifth smaller on this content at a level it still compresses at
// build speed; the app accepts either extension, so older releases stay fetchable.
//
// Level 19 is the default. Level 22 held a seed under Gitee's 100 MB attachment cap on rc.24
// (124.1 MiB at 19 against 97.0 MiB at 22), and that cap no longer binds: today's seed is far past
// it at either level, so every release splits the archive into parts regardless (see below). The
// remaining seconds of the level-22 pass bought nothing, and the standalone zstd offsets even the
// level-19 size by compressing with every core.
mkdirSync(ARTIFACT_ROOT, { recursive: true })
const level = Number(process.env.HARGLOBAL_ZSTD_LEVEL ?? '19')
const tarPath = join(ARTIFACT_ROOT, `${PRODUCT_NAME}-seed-${version}.tar`)
const archive = join(ARTIFACT_ROOT, `${PRODUCT_NAME}-seed-${version}.tar.zst`)
rmSync(tarPath, { force: true })
rmSync(archive, { force: true })
createTar({
  cwd: SEED_SOURCE,
  file: tarPath,
  // Timestamps and ownership would only make two builds of the same seed differ; nothing reads
  // either out of the extracted tree, and the inventory check does not cover them.
  noMtime: true,
  portable: true,
  sync: true,
}, readdirSync(SEED_SOURCE))
const zstd = zstdExecutable()
if (zstd !== undefined) {
  // -T0 threads the pass across every core; the standalone CLI offers it, the Node binding does not.
  const result = spawnSync(zstd, [`-${String(level)}`, '-T0', '--no-progress', '-q', '-f', '-o', archive, tarPath], {
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`prepare-shell: zstd exited with ${String(result.status)} while writing ${archive}`)
  }
} else {
  await pipeline(
    createReadStream(tarPath),
    createZstdCompress({ params: { [ZSTD_COMPRESSION_LEVEL]: level } }),
    createWriteStream(archive),
  )
}
rmSync(tarPath, { force: true })
const archiveBytes = statSync(archive).size
const megabytes = (archiveBytes / 1024 / 1024).toFixed(1)
const via = zstd === undefined ? 'node' : 'cli -T0'
process.stdout.write(`prepare-shell: offline package ${archive} (${megabytes} MB, zstd -${String(level)}, ${via})\n`)

// Gitee refuses an attachment over 100 MB, so an offline package past that cap is published in
// fixed-size parts (`scripts/release/split-offline-package.mjs`) while GitHub keeps the whole
// archive; the release is downloadable from both hosts either way.
//
// The size check is therefore opt-in: `HARGLOBAL_SEED_LIMIT_MB` is the largest attachment this
// release's hosts accept as one file, and 0 — the default — skips the check. Set it to a positive
// number for a release that has to stay publishable as a single attachment, and the build fails
// here instead of at the upload.
const limitMb = Number(process.env.HARGLOBAL_SEED_LIMIT_MB ?? '0')
const limitBytes = limitMb * 1024 * 1024
if (limitMb > 0 && archiveBytes > limitBytes) {
  throw new Error(
    `prepare-shell: the offline package is ${megabytes} MB and the configured attachment limit is ${String(limitMb)} MB; ` +
      `raise HARGLOBAL_ZSTD_LEVEL above ${String(level)}, raise or unset HARGLOBAL_SEED_LIMIT_MB, or drop a bundled plugin`,
  )
}

// Tauri needs the application icon inside `src-tauri`, and it takes it from the Electron shell's
// own build resources so both shells of this fork wear the same icon by construction.
const icon = join(PACKAGE_ROOT, 'src-tauri', 'icons', 'icon.ico')
const iconSource = join(REPO_ROOT, 'apps', 'desktop', 'build', 'icon.ico')
if (!existsSync(iconSource)) {
  throw new Error(`prepare-shell: the application icon is missing at ${iconSource}`)
}
mkdirSync(dirname(icon), { recursive: true })
cpSync(iconSource, icon)

const sidecar = join(RESOURCE_ROOT, 'sidecar', 'shell.mjs')
if (!existsSync(sidecar)) {
  throw new Error('prepare-shell: the sidecar bundle is missing. Run `pnpm run build:sidecar` first.')
}
process.stdout.write(
  `prepare-shell: sidecar ${sidecar} (${String(statSync(sidecar).size)} bytes); icon ${icon}\n`,
)
process.stdout.write(`prepare-shell: resource root ${RESOURCE_ROOT}\n`)
