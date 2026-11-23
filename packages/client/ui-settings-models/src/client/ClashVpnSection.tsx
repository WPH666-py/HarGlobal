/**
 * ClashVPN settings page: the bundled proxy core, its subscription, and the nodes it can reach.
 *
 * Hong Kong, Macau, and Taiwan stay off the list. The page starts the core when this install has
 * one and it is idle, so opening the section is enough on a profile whose bundle still has
 * autostart off.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import css from './ClashVpnSection.module.css'

/** Copy this page reads from the models dictionary. */
type Copy = (key: keyof typeof en) => string

/** One node as the Host measured it. */
interface ClashNode {
  readonly name: string
  readonly delay?: number
}

/** Status the Host reports for the bundled core. */
interface ClashStatus {
  readonly installed?: boolean
  readonly running?: boolean
  readonly lastError?: string
  readonly subscription?: { readonly configured?: boolean; readonly node?: string }
}

/** Regions whose nodes are hidden from this list. */
const EXCLUDED_REGION = /香港|澳门|澳門|台湾|台灣|hong\s?kong|macao|macau|taiwan|🇹🇼|🇭🇰|🇲🇴|(?:^|[^a-z])(?:hk|tw|mo)(?![a-z])/iu

/**
 * Whether a proxy name refers to Hong Kong, Macau, or Taiwan.
 * @param name - the name the core reported.
 * @returns true when the settings page must not list it.
 */
export function excludedProxyName(name: string): boolean {
  return EXCLUDED_REGION.test(name)
}

/** Read one JSON route, or undefined when the plugin is absent. */
async function readJson<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const response = await fetch(path, init)
    if (!response.ok) return undefined
    return await response.json() as T
  } catch (cause: unknown) {
    // A missing route or a refused socket means this install has no core to ask.
    void cause
    return undefined
  }
}

/**
 * Draw the ClashVPN settings page.
 * @param props - localized copy; absent until the settings shell injects it.
 * @returns the page, or null before injection.
 */
export function ClashVpnSection({ t }: { t?: Copy }): ReactNode {
  if (t === undefined) return null
  return <Loaded t={t} />
}

function Loaded({ t }: { t: Copy }): ReactNode {
  const [phase, setPhase] = useState<'loading' | 'absent' | 'ready'>('loading')
  const [status, setStatus] = useState<ClashStatus | undefined>(undefined)
  const [nodes, setNodes] = useState<readonly ClashNode[]>([])
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  /** Apply a paint only while this page is still mounted. */
  const paint = useCallback((update: () => void): void => {
    if (alive.current) update()
  }, [])

  const load = useCallback(async (probe: boolean): Promise<void> => {
    const observed = await readJson<ClashStatus>('/dsh-clashvpn/status')
    if (observed === undefined) {
      paint(() => {
        setPhase('absent')
        setStatus(undefined)
        setNodes([])
      })
      return
    }
    let current = observed
    if (observed.installed === true && observed.running !== true) {
      const started = await readJson<{ result?: string; status?: ClashStatus }>(
        '/dsh-clashvpn/control?action=start',
        { method: 'POST' },
      )
      if (started?.status !== undefined) current = started.status
      const result = started?.result
      if (result !== undefined && result !== 'started' && result !== 'already running') paint(() => { setMessage(result) })
    }
    paint(() => {
      setStatus(current)
      setPhase('ready')
    })
    if (current.running === true) {
      const listed = await readJson<{ nodes?: readonly ClashNode[] }>(
        `/dsh-clashvpn/nodes${probe ? '?probe=1' : ''}`,
      )
      paint(() => { setNodes((listed?.nodes ?? []).filter(node => !excludedProxyName(node.name))) })
    } else {
      paint(() => { setNodes([]) })
    }
  }, [paint])

  useEffect(() => {
    alive.current = true
    void load(true)
    return () => { alive.current = false }
  }, [load])

  const save = async (): Promise<void> => {
    setBusy(true)
    const saved = await readJson<{ result?: string }>('/dsh-clashvpn/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscriptionUrl: draft.trim() }),
    })
    paint(() => { setMessage(saved?.result ?? t('clash.saveFailed')) })
    await load(true)
    paint(() => { setBusy(false) })
  }

  const select = async (name: string): Promise<void> => {
    setBusy(true)
    const picked = await readJson<{ result?: string }>(
      `/dsh-clashvpn/select?name=${encodeURIComponent(name)}`,
      { method: 'POST' },
    )
    const pickedName = picked?.result
    if (pickedName !== undefined) paint(() => { setMessage(pickedName) })
    await load(false)
    paint(() => { setBusy(false) })
  }

  const missing = phase === 'absent' || (phase === 'ready' && status?.installed !== true)
  const current = status?.subscription?.node
  return (
    <section className={css.section} data-clashvpn data-clashvpn-state={phase}>
      <h2 className={css.title}>{t('clash.nav')}</h2>
      <p className={css.intro}>{t('clash.intro')}</p>
      {phase === 'loading' ? null : missing ? <p className={css.notice}>{t('clash.absent')}</p> : (
        <>
          <div className={css.head}>
            <span className={status?.running === true ? `${css.badge} ${css.badgeOn}` : css.badge}>
              {status?.running === true ? t('clash.running') : t('clash.stopped')}
            </span>
            <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void load(true) }}>
              {t('clash.refresh')}
            </button>
          </div>
          <div className={css.row}>
            <span className={css.hint}>{t('clash.subscription')}</span>
            <input
              className={css.input}
              value={draft}
              placeholder="https://"
              aria-label={t('clash.subscription')}
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => { void save() }}>
              {t('clash.save')}
            </button>
          </div>
          <p className={css.hint}>
            {t('clash.subscriptionHint')}
            {' '}
            <a href="https://www.stableproxy.net" target="_blank" rel="noreferrer">{t('clash.stableProxy')}</a>
          </p>
          <h3 className={css.nodesTitle}>{t('clash.nodes')}</h3>
          <ul className={css.nodes}>
            {status?.running === true && nodes.length === 0 ? <li className={css.hint}>{t('clash.noNodes')}</li> : null}
            {nodes.map(node => (
              <li key={node.name}>
                <button
                  type="button"
                  className={node.name === current ? `${css.node} ${css.nodeCurrent}` : css.node}
                  disabled={busy}
                  onClick={() => { void select(node.name) }}
                >
                  <span>{node.name}</span>
                  <span className={css.nodeMeta}>
                    {node.name === current ? <span className={css.current}>{t('clash.current')}</span> : null}
                    <span className={latencyClass(node.delay)}>
                      {node.delay === undefined ? '—' : `${String(node.delay)} ms`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {message === '' ? null : <p className={css.notice}>{message}</p>}
      {status?.lastError !== undefined && status.lastError !== '' ? <p className={css.error}>{status.lastError}</p> : null}
    </section>
  )
}

/** Latency ink: fast, usable, or slow. An unmeasured node stays in the secondary ink. */
function latencyClass(delay: number | undefined): string {
  if (delay === undefined) return css.latency ?? ''
  if (delay < 200) return `${css.latency} ${css.latencyFast}`
  if (delay < 800) return `${css.latency} ${css.latencyMid}`
  return `${css.latency} ${css.latencySlow}`
}
