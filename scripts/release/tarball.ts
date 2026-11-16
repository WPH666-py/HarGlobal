/**
 * Reading packed npm tarballs and the order file that accompanies them.
 *
 * The release steps after pack treat a directory of tarballs as the unit of
 * work, so they read what a tarball declares rather than what the checkout
 * currently says.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { capture } from './process.ts'

/**
 * The tar executable every release step reads archives with.
 *
 * Windows ships bsdtar as `tar.exe` beside the system files, and it reads a
 * drive-letter path as a local file. A tar earlier on PATH (the GNU tar inside
 * Git for Windows, for one) reads `D:\...` as a remote host and fails with
 * `Cannot connect to D: resolve failed`, so the system binary is preferred by
 * absolute path and the PATH lookup is only the fallback.
 */
const WINDOWS_TAR = process.platform === 'win32'
  ? join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe')
  : undefined

/** Resolved tar executable for this platform. */
export const TAR = WINDOWS_TAR !== undefined && existsSync(WINDOWS_TAR) ? WINDOWS_TAR : 'tar'

/** Name of the file recording the order in which a packed family uploads. */
export const PUBLISH_ORDER_FILE = 'publish-order.txt'

/** What a packed tarball calls itself. */
export interface PackedIdentity {
  /** Package name from the packed manifest. */
  readonly name: string
  /** Package version from the packed manifest. */
  readonly version: string
}

/**
 * List a tarball's members.
 * @param tarball - absolute tarball path.
 * @returns Every path inside the archive.
 */
export function tarballFiles(tarball: string): string[] {
  // GNU tar reads the colon in a Windows drive path as a remote-host separator, so tar runs beside the tarball.
  return capture(TAR, ['-tzf', basename(tarball)], { cwd: dirname(tarball) }).split(/\r?\n/u).filter(line => line !== '')
}

/**
 * Read the manifest contained in a packed tarball, without consulting the checkout.
 * @param tarball - Absolute tarball path.
 * @returns The packed package.json object.
 */
export function packedManifest(tarball: string): Record<string, unknown> {
  const manifest: unknown = JSON.parse(capture(TAR, ['-xOzf', basename(tarball), 'package/package.json'], { cwd: dirname(tarball) }))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error(`${tarball} has no manifest`)
  return manifest as Record<string, unknown>
}

/**
 * Read a packed tarball's own identity.
 * @param tarball - Absolute tarball path.
 * @returns The name and version the tarball declares.
 */
export function packedIdentity(tarball: string): PackedIdentity {
  const { name, version } = packedManifest(tarball)
  if (typeof name !== 'string' || typeof version !== 'string') throw new Error(`${tarball} manifest lacks name/version`)
  return { name, version }
}

/**
 * Read a packed directory's upload order.
 * @param directory - absolute path of a pack output directory.
 * @returns Tarball filenames in upload order.
 */
export function readPublishOrder(directory: string): string[] {
  return readFileSync(join(directory, PUBLISH_ORDER_FILE), 'utf8').split('\n').filter(line => line !== '')
}
