import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { patchGitPanelTabDot, verifyGitPanelTabDot } from '../scripts/patch-git-panel-tab-dot.mjs'

/** The bundle text the shipped package carries around the tab status. */
const SHIPPED =
  'function Hr({sessionId:e,t}){let n=ft(e),r=ei(),[a,i]=(0,te.useState)(null),' +
  'o=ti(a),s=(0,te.useRef)(Symbol("gp-tab-dot")),' +
  'l=n.state==="ready"&&n.snapshot.showInputPill===!1?n.snapshot.dirty?"dirty":"synced":null,' +
  'c=t("panel.tab");return null}'

const BUNDLE = join('@xbzbing', 'dsh-git-panel', 'lib', 'client.js')

describe('git panel tab dot patch', () => {
  const roots: string[] = []

  function tree(bundle: string | null = SHIPPED): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-git-panel-tab-dot-'))
    roots.push(root)
    if (bundle !== null) {
      const target = join(root, BUNDLE)
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, bundle, 'utf8')
    }
    return root
  }

  afterEach(() => {
    for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('removes the tab status and leaves the rest of the bundle alone', () => {
    const root = tree()
    expect(patchGitPanelTabDot(root)).toContain('patched')
    const patched = readFileSync(join(root, BUNDLE), 'utf8')
    expect(patched).toContain('l=null/* tab dot removed')
    expect(patched).not.toContain('"synced":null')
    // The tab label the component still renders comes through untouched.
    expect(patched).toContain('t("panel.tab")')
    expect(() => verifyGitPanelTabDot(root)).not.toThrow()
  })

  it('reports an already patched tree instead of rewriting it', () => {
    const root = tree()
    patchGitPanelTabDot(root)
    const once = readFileSync(join(root, BUNDLE), 'utf8')
    expect(patchGitPanelTabDot(root)).toContain('already carries the patch')
    expect(readFileSync(join(root, BUNDLE), 'utf8')).toBe(once)
  })

  it('ignores a seed that does not ship the Git panel', () => {
    const root = tree(null)
    expect(patchGitPanelTabDot(root)).toContain('is not installed')
  })

  it('fails loudly when the bundle no longer matches the anchor', () => {
    const root = tree('function Hr(){return null}')
    expect(() => patchGitPanelTabDot(root)).toThrow(/no longer derives the tab dot/)
  })
})
