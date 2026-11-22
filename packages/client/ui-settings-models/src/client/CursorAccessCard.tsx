/** Cursor readiness card: what the bundled Cursor plugin needs before it can answer a turn. */
import { useEffect, useState } from 'react'
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
  /** Which address the CLI reaches Cursor from; absent on an older Host. */
  readonly egress?: CursorEgress
}

/** One egress observation from the Host. */
interface CursorEgress {
  readonly ok: boolean
  readonly ip?: string
  readonly country?: string
  readonly org?: string
  readonly denied?: boolean
  readonly ms?: number
  readonly reason?: string
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

/** Copy this card reads from the models dictionary. */
type CopyKey = (key: 'cursor.title' | 'cursor.ready' | 'cursor.notReady' | 'cursor.copy' | 'cursor.copied' | 'cursor.egress' | 'cursor.egressUnknown' | 'cursor.egressDenied') => string

/**
 * Draw the Cursor readiness of this machine, with the fix command for each unmet step.
 * @param props - localized copy.
 * @returns the card, or null when the status route is absent.
 */
export function CursorAccessCard({ t }: { t: CopyKey }) {
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
        <span>{t('cursor.title')}</span>
        <span className={status.ok ? `${css.badge} ${css.badgeOk}` : `${css.badge} ${css.badgeWarn}`}>
          {status.ok ? t('cursor.ready') : t('cursor.notReady')}
        </span>
      </div>
      <EgressRow egress={status.egress} t={t} />
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
                  {copied === step.fix ? t('cursor.copied') : t('cursor.copy')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The egress row: the address Cursor sees, or why it could not be read.
 *
 * A failed probe is not an error: a machine with the proxy closed still answers every turn, so the
 * row reports the missing observation without colouring the card as broken.
 * @param props - the Host observation and localized copy.
 * @returns the row.
 */
function EgressRow({ egress, t }: { egress?: CursorEgress | undefined; t: CopyKey }) {
  if (egress === undefined) return null
  const tone = egress.ok === false ? css.badgeWarn : egress.denied === true ? css.badgeDenied : css.badgeOk
  const detail = egress.ok === false
    ? t('cursor.egressUnknown')
    : [egress.country, egress.ip, egress.ms === undefined ? undefined : `${String(egress.ms)} ms`]
      .filter(part => part !== undefined && part !== '')
      .join(' · ')
  const label = egress.ok !== false && egress.denied === true ? t('cursor.egressDenied') : undefined
  return (
    <div className={css.egress} data-cursor-egress={egress.ok === false ? 'unknown' : egress.denied === true ? 'denied' : 'allowed'}>
      <span className={css.name}>{t('cursor.egress')}</span>
      <span className={tone}>{label ?? detail}</span>
      {label === undefined ? null : <span className={css.detail}>{detail}</span>}
    </div>
  )
}
