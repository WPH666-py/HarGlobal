/**
 * Product identity for this build.
 *
 * This repository ships one product: HarGlobal, the science- and engineering-oriented build of
 * the DeepSeek Harness desktop shell. The office product HarGlobal lives in its own repository, so
 * the name is a constant here rather than a value the release driver bakes in through the
 * environment.
 * @module
 */
import type { DesktopLocale, DesktopMessages } from './locale.ts'

/** Name this product carries in every user-facing surface the shell itself renders. */
export const PRODUCT_NAME = 'HarGlobal'

/**
 * Rewrites the startup copy to name this product.
 *
 * The startup page and the splash window take their text from the shell's locale endpoint, so a
 * build only has to replace the strings that name the product; every other line stays as the
 * locale dictionary wrote it.
 *
 * @param messages - locale dictionary resolved for this launch.
 * @param localeId - locale the dictionary was chosen for.
 * @returns the same dictionary with the product-naming entries replaced.
 */
export function productMessages(
  messages: DesktopMessages,
  localeId: DesktopLocale['id'],
): DesktopMessages {
  const chinese = localeId === 'zh-CN'
  return {
    ...messages,
    startupTitle: PRODUCT_NAME,
    startupWindowTitle: chinese ? `${PRODUCT_NAME} — 正在启动` : `${PRODUCT_NAME} — Starting`,
    startupFailed: chinese ? `${PRODUCT_NAME} 无法启动` : `${PRODUCT_NAME} could not start`,
    updateTitle: chinese ? `${PRODUCT_NAME} 更新` : `${PRODUCT_NAME} update`,
    pluginWindowTitle: chinese ? `${PRODUCT_NAME} — 内置插件` : `${PRODUCT_NAME} — Bundled plugins`,
  }
}
