/** ClashVPN card: the bundled proxy core, its subscription and the nodes it can reach. */
import { useCallback, useEffect, useState } from 'react'
import css from './ClashVpnCard.module.css'

/** Copy this card reads from the models dictionary. */
export type ClashCopyKey = (key:
  | 'clash.title' | 'clash.running' | 'clash.stopped'
  | 'clash.subscription' | 'clash.subscriptionHint' | 'clash.save'
  | 'clash.nodes' | 'clash.noNodes' | 'clash.refresh' | 'clash.stableProxy') => string

/** One node as the Host measured it. */
interface ClashNode {
  readonly name: string
  readonly delay?: number
}

/** Regions whose nodes are hidden from this list. */
const EXCLUDED = /香港|澳门|澳門|台湾|台灣|hong ?kong|macao|macau|taiwan|tw\d|hk\d|mo\d/iu

/** Read one JSON route, or undefined when the plugin is absent. */
async function readJson<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  try {
    const response = await fetch(path, init)
    if (!response.ok) return undefined
    return await response.json() as T
  } catch {
    return undefined
  }
}

/**
 * Draw the proxy core: subscription, node list and measured latency.
 *
 * Nodes whose name names a restricted region are dropped from the list: the point of the core here
 * is an exit those models accept, and offering the others would only mislead.
 * @param props - localized copy.
 * @returns the card, or null when no core plugin answers.
 */
export function ClashVpnCard({ t }: { t: ClashCopyKey }) {
  const [status, setStatus] = useState<{ installed?: boolean; running?: boolean } | undefined>(undefined)
  const [nodes, setNodes] = useState<readonly ClashNode[]>([])
  const [draft, setDraft] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    const observed = await readJson<{ installed?: boolean; running?: boolean }>('/dsh-clashvpn/status')
    setStatus(observed)
    setLoaded(true)
    if (observed?.running === true) {
      const listed = await readJson<{ nodes: readonly ClashNode[] }>('/dsh-clashvpn/nodes')
      setNodes((listed?.nodes ?? []).filter(node => !EXCLUDED.test(node.name)))
    } else {
      setNodes([])
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  if (!loaded || status === undefined) return null

  const save = async (): Promise<void> => {
    const saved = await readJson<{ result?: string }>('/dsh-clashvpn/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscriptionUrl: draft.trim() }),
    })
    setMessage(saved?.result ?? 'failed')
    await readJson('/dsh-clashvpn/control?action=reload', { method: 'POST' })
    await refresh()
  }

  const select = async (name: string): Promise<void> => {
    await readJson(`/dsh-clashvpn/select?name=${encodeURIComponent(name)}`, { method: 'POST' })
    setMessage(name)
  }

  return (
    <div className={css.card} data-clashvpn>
      <div className={css.head}>
        <span>{t('clash.title')}</span>
        <span className={status.running === true ? `${css.badge} ${css.badgeOn}` : css.badge}>
          {status.running === true ? t('clash.running') : t('clash.stopped')}
        </span>
        <button type="button" onClick={() => { void refresh() }}>{t('clash.refresh')}</button>
      </div>
      <div className={css.row}>
        <span className={css.hint}>{t('clash.subscription')}</span>
        <input
          className={css.input}
          value={draft}
          placeholder="https://"
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <button type="button" onClick={() => { void save() }}>{t('clash.save')}</button>
      </div>
      <div className={css.hint}>
        {t('clash.subscriptionHint')}
        {' '}
        <a href="https://www.stableproxy.net" target="_blank" rel="noreferrer">{t('clash.stableProxy')}</a>
      </div>
      {status.running !== true ? null : (
        <ul className={css.nodes}>
          {nodes.length === 0 ? <li className={css.hint}>{t('clash.noNodes')}</li> : null}
          {nodes.map(node => (
            <li key={node.name}>
              <button type="button" className={css.node} onClick={() => { void select(node.name) }}>
                <span>{node.name}</span>
                <span className={node.delay === undefined ? css.latency : `${css.latency} ${css.latencyGood}`}>
                  {node.delay === undefined ? '—' : `${String(node.delay)} ms`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message === '' ? null : <div className={css.hint}>{message}</div>}
    </div>
  )
}
