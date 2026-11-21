/** Cursor readiness card: what the bundled Cursor plugin needs before it can answer a turn. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CursorAccessCard.module.css'

/** One step of the Host's readiness probe. */
interface CursorStep {
  readonly id: string
  readonly ok: boolean
  readonly detail: string
  readonly fix: string
}

/** The Host's answer from `GET /dsh-cursor/status`. */
interface CursorStatus {
  readonly ok: boolean
  readonly distro: string
  readonly binary: string
  readonly steps: readonly CursorStep[]
}

/** Route the bundled plugin registers; a profile without the plugin answers 404. */
const STATUS_ROUTE = '/dsh-cursor/status'

/** Read one status snapshot, or null when the plugin is absent or unreachable. */
async function loadStatus(signal: AbortSignal): Promise<CursorStatus | null> {
  try {
    const response = await fetch(STATUS_ROUTE, { signal, headers: { accept: 'application/json' } })
    if (!response.ok) return null
    return await response.json() as CursorStatus
  } catch {
    return null
  }
}

/**
 * Draw the Cursor readiness of this machine, with the fix command for each unmet step.
 *
 * The card draws nothing when no Cursor plugin serves the route, so a profile that never installed
 * the plugin keeps the General page exactly as it was.
 * @param props - localized copy.
 * @returns the card, or null when the status route is absent.
 */
export function CursorAccessCard({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>) {
  const [status, setStatus] = useState<CursorStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void loadStatus(controller.signal).then((next) => {
      if (controller.signal.aborted) return
      setStatus(next)
      setLoaded(true)
    })
    return () => { controller.abort() }
  }, [])
  if (!loaded || status === null) return null
  const copy = (command: string): void => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(command)
      setTimeout(() => { setCopied(current => (current === command ? null : current)) }, 2000)
    }).catch(() => { /* a refused clipboard leaves the command selectable in place */ })
  }
  return (
    <div className={css.card} data-cursor-access>
      <div className={css.head}>
        <span>{t('general.cursor.title')}</span>
        <span className={status.ok ? `${css.badge} ${css.badgeOk}` : `${css.badge} ${css.badgeWarn}`}>
          {status.ok ? t('general.cursor.ready') : t('general.cursor.notReady')}
        </span>
      </div>
      <ul className={css.steps}>
        {status.steps.map(step => (
          <li key={step.id} className={css.step} data-cursor-step={step.id} data-cursor-step-ok={step.ok ? '1' : '0'}>
            <div className={css.stepHead}>
              <span className={css.name}>{step.id}</span>
              <span className={css.detail}>{step.detail}</span>
            </div>
            {step.ok ? null : (
              <div className={css.fix}>
                <code className={css.command}>{step.fix}</code>
                <button type="button" onClick={() => { copy(step.fix) }}>
                  {copied === step.fix ? t('general.cursor.copied') : t('general.cursor.copy')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
