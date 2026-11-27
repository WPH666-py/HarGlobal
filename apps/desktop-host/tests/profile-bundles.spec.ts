/**
 * The installed launcher runs only the bundles the profile itself owns.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface StubLayer {
  packageName: string
  packageDir: string
  patches: { id: string }[]
}

const loaded = vi.hoisted(() => ({ layers: [] as StubLayer[] }))

vi.mock('@deepseek-ai/dsh-app-boot', () => ({
  boot: () => { throw new Error('boot is not part of this test') },
  composeEntries: (groups: { id: string }[][]) => groups.flat(),
  loadLayeredEnv: () => ({}),
  loadOverlayPatches: () => [],
  loadProfileDirectory: () => ({ layers: loaded.layers, patches: [], skippedBundles: [] }),
}))

const { desktopPatches } = await import('../src/index.ts')

const roots: string[] = []

/** A profile directory holding the dsh manifest the launcher resolves its bundles against. */
function profileDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-profile-'))
  roots.push(root)
  mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
  writeFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), '{"name":"@deepseek-ai/dsh","version":"0.0.0"}')
  return root
}

afterEach(() => {
  loaded.layers = []
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop profile bundles outside the profile', () => {
  it('skips a linked bundle and reports it instead of failing the launch', () => {
    const profile = profileDir()
    const outside = mkdtempSync(join(tmpdir(), 'desktop-linked-'))
    roots.push(outside)
    loaded.layers = [
      { packageName: 'inside', packageDir: profile, patches: [{ id: 'inside' }] },
      { packageName: 'linked', packageDir: outside, patches: [{ id: 'linked' }] },
    ]
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const plan = desktopPatches(profile, false)

    // The owned bundle still composes; the linked one contributes no rows, so nothing loads it.
    expect(plan.core).toEqual([{ id: 'inside' }])
    expect(plan.core.some(row => row.id === 'linked')).toBe(false)
    expect(reported.mock.calls[0]?.[0]).toContain('profile bundle skipped: linked')
    expect(reported.mock.calls[0]?.[0]).toContain(outside)
    expect(logged.mock.calls[0]?.[0]).toContain('2 bundles, 1 skipped')
    reported.mockRestore()
    logged.mockRestore()
  })

  it('runs a linked bundle for a development launch', () => {
    const profile = profileDir()
    const outside = mkdtempSync(join(tmpdir(), 'desktop-linked-'))
    roots.push(outside)
    loaded.layers = [{ packageName: 'linked', packageDir: outside, patches: [{ id: 'linked' }] }]
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    const plan = desktopPatches(profile, true)

    expect(plan.core.some(row => row.id === 'linked')).toBe(true)
    expect(reported.mock.calls.some(call => String(call[0]).includes('profile bundle skipped'))).toBe(false)
    reported.mockRestore()
    logged.mockRestore()
  })
})
