/** File opening action in an unpreviewable document's empty state. */
import { useEffect, useRef, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { NS } from './locales.ts'
import { FileOpenTarget, type OpenPathInjected } from './OpenPathAction.tsx'

/** Full props of the unpreviewable empty-state contribution. */
export type OpenPathEmptyActionProps =
  PropsRuntime<'sidebar.right.tab.document.unpreviewable'>
  & PropsLocale<typeof NS>
  & InjectFace<OpenPathInjected>

/**
 * Extensions whose content is an Office document rather than text.
 *
 * The preview cannot render these, and the binary is unreadable in an editor, so the file opens in
 * the application the operating system associates with it — the reader's own Office, not a viewer
 * this client would have to ship.
 */
const OFFICE_DOCUMENT = /\.(?:docx?|xlsx?|pptx?|odt|ods|odp|rtf|wps|et|dps)$/iu

/**
 * Render the shared file opening menu with a larger labeled main button.
 *
 * An Office document opens in its associated application as soon as the tab shows it: the preview
 * has nothing to draw, and a second click to reach the same file would be the only alternative.
 * @param props - unpreviewable file and injected opening capabilities.
 * @returns the shared file opening action.
 */
export function OpenPathEmptyAction(props: OpenPathEmptyActionProps): ReactNode {
  const opened = useRef(false)
  const { absolutePath, openPath } = props
  useEffect(() => {
    if (opened.current || !OFFICE_DOCUMENT.test(absolutePath)) return
    opened.current = true
    void openPath(absolutePath, 'open')
  }, [absolutePath, openPath])
  return <FileOpenTarget {...props} empty />
}
