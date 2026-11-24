import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUNDLED_GIT_CONFIG, normalizeBundledGitConfig } from '../src/bundled-git.ts'

/** The shipped file with the prompt that reaches every new installation. */
const SHIPPED = [
  '[core]',
  '\tautocrlf = true',
  '[credential]',
  '\thelper = helper-selector',
  '',
].join('\n')

describe('bundled git config', () => {
  const roots: string[] = []

  function profile(): string {
    const created = mkdtempSync(join(tmpdir(), 'dsh-bundled-git-'))
    roots.push(created)
    return created
  }

  function configPath(root: string): string {
    const path = join(root, BUNDLED_GIT_CONFIG)
    mkdirSync(join(path, '..'), { recursive: true })
    return path
  }

  afterEach(() => {
    for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('names the shipped helper instead of prompting for one', () => {
    const root = profile()
    const path = configPath(root)
    writeFileSync(path, SHIPPED, 'utf8')
    const notes: string[] = []
    expect(normalizeBundledGitConfig(root, text => notes.push(text))).toBe(true)
    expect(notes).toEqual(['bundled git: credential helper set to manager'])
    const written = readFileSync(path, 'utf8')
    expect(written).toContain('helper = manager')
    expect(written).not.toContain('helper-selector')
    // Everything else in the shipped file survives the rewrite.
    expect(written).toContain('\tautocrlf = true')
  })

  it('reports nothing and rewrites nothing when the config already names a helper', () => {
    const root = profile()
    const path = configPath(root)
    const named = SHIPPED.replace('helper = helper-selector', 'helper = manager')
    writeFileSync(path, named, 'utf8')
    const notes: string[] = []
    expect(normalizeBundledGitConfig(root, text => notes.push(text))).toBe(false)
    expect(notes).toEqual([])
    expect(readFileSync(path, 'utf8')).toBe(named)
  })

  it('ignores a profile that has not installed the bundled package yet', () => {
    const notes: string[] = []
    expect(normalizeBundledGitConfig(profile(), text => notes.push(text))).toBe(false)
    expect(notes).toEqual([])
  })

  it('reports an unreadable config without failing the launch', () => {
    const root = profile()
    const path = configPath(root)
    // A directory where a file belongs makes the read fail the same way a locked file does.
    mkdirSync(path)
    const notes: string[] = []
    expect(normalizeBundledGitConfig(root, text => notes.push(text))).toBe(false)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/^bundled git config not read: /)
  })
})
