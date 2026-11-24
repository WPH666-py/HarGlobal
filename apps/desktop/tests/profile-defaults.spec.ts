import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hideComposerGitPill, PROFILE_PATCH_FILE } from '../src/profile-defaults.ts'

/** Path the module looks for before it writes anything. */
const GIT_PANEL = join('node_modules', '@xbzbing', 'dsh-git-panel', 'package.json')

describe('profile defaults', () => {
  const roots: string[] = []

  function profile(options: { readonly packageInstalled?: boolean; readonly patch?: string } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-profile-defaults-'))
    roots.push(root)
    if (options.packageInstalled !== false) {
      mkdirSync(join(root, GIT_PANEL, '..'), { recursive: true })
      writeFileSync(join(root, GIT_PANEL), '{}\n', 'utf8')
    }
    if (options.patch !== undefined) writeFileSync(join(root, PROFILE_PATCH_FILE), options.patch, 'utf8')
    return root
  }

  afterEach(() => {
    for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('writes the row into a profile that has no patch layer yet', () => {
    const root = profile()
    const notes: string[] = []
    expect(hideComposerGitPill(root, text => notes.push(text))).toBe(true)
    expect(notes).toEqual(['profile: the composer Git pill is off; the Git panel keeps its tab'])
    const written = readFileSync(join(root, PROFILE_PATCH_FILE), 'utf8')
    expect(written).toContain('- id: git-panel')
    expect(written).toContain('showInputPill: false')
  })

  it('appends to a patch layer that already carries another row', () => {
    const root = profile({ patch: "- id: ui-settings-general\n  name: '@deepseek-ai/dsh-client-ui-settings-general'\n" })
    expect(hideComposerGitPill(root, () => undefined)).toBe(true)
    const written = readFileSync(join(root, PROFILE_PATCH_FILE), 'utf8')
    expect(written.startsWith('- id: ui-settings-general')).toBe(true)
    expect(written).toContain('showInputPill: false')
  })

  it('leaves a patch layer that already turns the pill off alone', () => {
    const root = profile({ patch: '- id: git-panel\n  config:\n    showInputPill: false\n' })
    const before = readFileSync(join(root, PROFILE_PATCH_FILE), 'utf8')
    const notes: string[] = []
    expect(hideComposerGitPill(root, text => notes.push(text))).toBe(false)
    expect(notes).toEqual([])
    expect(readFileSync(join(root, PROFILE_PATCH_FILE), 'utf8')).toBe(before)
  })

  it('writes nothing into a profile that does not carry the plugin', () => {
    const root = profile({ packageInstalled: false })
    expect(hideComposerGitPill(root, () => undefined)).toBe(false)
    // An unmatched row would name a plugin this profile never installed.
    expect(existsSync(join(root, PROFILE_PATCH_FILE))).toBe(false)
  })
})
