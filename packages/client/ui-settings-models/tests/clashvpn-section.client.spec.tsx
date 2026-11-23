// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClashVpnSection, excludedProxyName } from '../src/client/ClashVpnSection.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh) => zh[key]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('excludedProxyName', () => {
  it('hides Hong Kong, Macau, and Taiwan and keeps other regions', () => {
    expect(excludedProxyName('香港-01')).toBe(true)
    expect(excludedProxyName('台湾 家宽')).toBe(true)
    expect(excludedProxyName('台灣-02')).toBe(true)
    expect(excludedProxyName('澳门')).toBe(true)
    expect(excludedProxyName('澳門')).toBe(true)
    expect(excludedProxyName('Hong Kong 01')).toBe(true)
    expect(excludedProxyName('HongKong')).toBe(true)
    expect(excludedProxyName('Taiwan-1')).toBe(true)
    expect(excludedProxyName('Macau')).toBe(true)
    expect(excludedProxyName('HK-03')).toBe(true)
    expect(excludedProxyName('TW2')).toBe(true)
    expect(excludedProxyName('MO')).toBe(true)
    expect(excludedProxyName('🇯🇵 东京')).toBe(false)
    expect(excludedProxyName('日本-东京')).toBe(false)
    expect(excludedProxyName('Singapore')).toBe(false)
    expect(excludedProxyName('United States')).toBe(false)
  })
})

describe('ClashVpnSection', () => {
  it('renders nothing before the shell injects copy', () => {
    const view = render(<ClashVpnSection />)
    expect(view.container.innerHTML).toBe('')
  })

  it('says the core is absent when the route does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'missing' }, 404)))
    render(<ClashVpnSection t={t} />)
    expect(await screen.findByText(zh['clash.absent'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['clash.refresh'] })).toBeNull()
  })

  it('starts an idle core, lists measured nodes, and drops excluded regions', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/status')) {
        return json({ installed: true, running: calls.some(call => call.startsWith('POST')) , subscription: { node: '日本-东京' } })
      }
      if (url.includes('action=start')) return json({ result: 'started', status: { installed: true, running: true, subscription: { node: '日本-东京' } } })
      if (url.includes('/nodes')) {
        return json({ nodes: [
          { name: '日本-东京', delay: 120 },
          { name: '新加坡', delay: 400 },
          { name: '美国-洛杉矶', delay: 900 },
          { name: '未测速' },
          { name: '香港-01', delay: 30 },
          { name: '台湾-01', delay: 40 },
        ] })
      }
      return json({ result: 'saved' })
    }))
    render(<ClashVpnSection t={t} />)
    expect(await screen.findByText('日本-东京')).toBeTruthy()
    expect(screen.getByText('新加坡')).toBeTruthy()
    expect(screen.getByText('美国-洛杉矶')).toBeTruthy()
    expect(screen.getByText('120 ms')).toBeTruthy()
    expect(screen.getByText('400 ms')).toBeTruthy()
    expect(screen.getByText('900 ms')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText(zh['clash.current'])).toBeTruthy()
    expect(screen.queryByText('香港-01')).toBeNull()
    expect(screen.queryByText('台湾-01')).toBeNull()
    expect(calls.some(call => call.startsWith('POST') && call.includes('action=start'))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /新加坡/ }))
    await waitFor(() => {
      expect(calls.some(call => call.includes('/select?name='))).toBe(true)
    })

    fireEvent.change(screen.getByLabelText(zh['clash.subscription']), { target: { value: 'https://example.test/sub' } })
    fireEvent.click(screen.getByRole('button', { name: zh['clash.save'] }))
    await waitFor(() => {
      expect(calls.some(call => call.startsWith('POST') && call.includes('/config'))).toBe(true)
    })
  })

  it('reports a start failure and a missing subscription save', async () => {
    let statusReads = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/status')) {
        statusReads += 1
        return json({ installed: true, running: false, lastError: 'core missing' })
      }
      if (url.includes('action=start')) return json({ result: 'mihomo core not found next to the application' })
      if (init?.method === 'POST' && url.includes('/config')) return json({ error: 'no' }, 500)
      return json({})
    }))
    render(<ClashVpnSection t={t} />)
    expect(await screen.findByText('mihomo core not found next to the application')).toBeTruthy()
    expect(screen.getByText('core missing')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['clash.save'] }))
    expect(await screen.findByText(zh['clash.saveFailed'])).toBeTruthy()
    expect(statusReads).toBeGreaterThan(0)
  })

  it('treats a refused socket as a missing core and ignores a late reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('refused') }))
    render(<ClashVpnSection t={t} />)
    expect(await screen.findByText(zh['clash.absent'])).toBeTruthy()
    cleanup()

    let release: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve })))
    const view = render(<ClashVpnSection t={t} />)
    view.unmount()
    release?.(json({ installed: true, running: true }))
    await Promise.resolve()
  })

  it('says the core is absent when the binary is not installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ installed: false })))
    render(<ClashVpnSection t={t} />)
    expect(await screen.findByText(zh['clash.absent'])).toBeTruthy()
  })

  it('keeps a quiet already-running start and shows a saved subscription', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/status')) return json({ installed: true, running: false, lastError: '' })
      if (url.includes('action=start')) return json({ result: 'already running' })
      if (url.includes('/nodes')) return json({})
      if (url.includes('/config')) return json({ result: 'saved' })
      return json({})
    }))
    render(<ClashVpnSection t={t} />)
    expect(await screen.findByText(zh['clash.stopped'])).toBeTruthy()
    expect(screen.queryByText('already running')).toBeNull()
    fireEvent.change(screen.getByLabelText(zh['clash.subscription']), { target: { value: 'https://example.test/sub' } })
    fireEvent.click(screen.getByRole('button', { name: zh['clash.save'] }))
    expect(await screen.findByText('saved')).toBeTruthy()
  })

  it('ignores a select that names nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/status')) return json({ installed: true, running: true, subscription: {} })
      if (url.includes('/nodes')) return json({ nodes: [{ name: '新加坡' }] })
      return json({})
    }))
    render(<ClashVpnSection t={t} />)
    fireEvent.click(await screen.findByRole('button', { name: /新加坡/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: zh['clash.refresh'] })).toBeTruthy()
    })
    expect(screen.queryByText('saved')).toBeNull()
  })

  it('leaves a running core alone', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/status')) return json({ installed: true, running: true, subscription: {} })
      if (url.includes('/nodes')) {
        return calls.filter(call => call.includes('/nodes')).length === 1 ? json({}) : json({ error: 'down' }, 404)
      }
      return json({})
    }))
    render(<ClashVpnSection t={t} />)
    expect(await screen.findByText(zh['clash.noNodes'])).toBeTruthy()
    expect(calls.some(url => url.includes('action=start'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: zh['clash.refresh'] }))
    await waitFor(() => {
      expect(calls.filter(url => url.includes('/nodes')).length).toBeGreaterThan(1)
    })
  })
})
