/**
 * Whether a `dsh-git-panel` client bundle already carries the tab-dot removal.
 * @param source - Contents of `@xbzbing/dsh-git-panel/lib/client.js`.
 * @returns true when the tab computes no status and therefore paints no dot.
 */
export function hasTabDotPatch(source: string): boolean

/**
 * Patch the Git panel client bundle under one tree.
 * @param root - A `node_modules` directory of an installed profile or seed.
 * @returns A line describing what happened.
 * @throws When the tree holds the plugin but the tab-status anchor is missing.
 */
export function patchGitPanelTabDot(root: string): string

/**
 * Require the tab-dot removal in a tree the seed produced.
 * @param root - A profile directory holding `node_modules`.
 * @throws When the installed bundle still paints a status dot on the Git tab.
 */
export function verifyGitPanelTabDot(root: string): void
