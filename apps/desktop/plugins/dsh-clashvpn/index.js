/**
 * dsh-clashvpn — the bundled mihomo core, started with the app and reported by the Host.
 *
 * The core is a plain proxy engine: it reads a Clash configuration from the data directory and
 * exposes `external-controller` on loopback, on by default, so the settings page talks to it over
 * HTTP. A build without the core binary reports `installed: false` and the rest of the Host is
 * unaffected. Nodes whose names refer to Hong Kong, Macau, or Taiwan are omitted from the list the
 * settings page reads.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureConfig, coreVersion, killCore, listProxies, pidAlive, resolveBinary, startCore } from './lib/mihomo.js'

export const name = 'dsh-clashvpn'

/** Names the settings page must not offer. */
const EXCLUDED_REGION = /香港|澳门|澳門|台湾|台灣|hong\s?kong|macao|macau|taiwan|🇹🇼|🇭🇰|🇲🇴|(?:^|[^a-z])(?:hk|tw|mo)(?![a-z])/iu

/** Proxy types that are groups or built-in policies, not a reachable computer. */
const GROUP_TYPES = new Set(['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay', 'Compatible', 'Direct', 'Reject', 'RejectDrop', 'Pass'])

/** Built-in policy names the controller always reports. */
const BUILTIN = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL', 'COMPATIBLE'])

/** Host of a subscription URL, for status without echoing its token. */
function hostOf(url) {
  try { return new URL(url).host } catch (cause) {
    void cause
    return ''
  }
}

/**
 * The node a selector group currently uses.
 * @param controllerPort - controller port on loopback.
 * @param group - group name.
 * @returns the node name, or an empty string when the controller cannot say.
 */
async function selectedNode(controllerPort, group) {
  try {
    const response = await fetch(`http://127.0.0.1:${String(controllerPort)}/proxies/${encodeURIComponent(group)}`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return ''
    const body = await response.json()
    return typeof body?.now === 'string' ? body.now : ''
  } catch (cause) {
    void cause
    return ''
  }
}

/**
 * Product data directory this plugin keeps its configuration under.
 *
 * The Host runs under the runtime node the installer staged, so `<install>/data` is two levels
 * above that interpreter; `DSH_HOME` overrides it when the launcher sets one.
 * @returns the absolute data directory.
 */
function resolveHome() {
  if (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== '') return process.env.DSH_HOME
  return join(dirname(process.execPath), '..', '..', '..', 'data')
}

/**
 * Subscription address saved from the settings page.
 * @param dataDir - plugin data directory.
 * @returns the saved URL, or an empty string when none was saved.
 */
function readSubscription(dataDir) {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, 'subscription.json'), 'utf8'))
    return typeof raw?.url === 'string' ? raw.url : ''
  } catch (cause) {
    void cause
    return ''
  }
}

/**
 * Normalise the row config.
 * @param raw - configured values, all optional.
 * @param home - product home directory.
 * @returns the settings this plugin runs with.
 */
function resolveConfig(raw, home) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const dataDir = typeof source.dataDir === 'string' && source.dataDir.trim() !== '' ? source.dataDir : home + '/clashvpn'
  const configuredUrl = typeof source.subscription?.url === 'string' ? source.subscription.url : ''
  return {
    enabled: source.enabled !== false,
    binary: typeof source.binary === 'string' ? source.binary : '',
    dataDir,
    mixedPort: Number.isInteger(source.mixedPort) ? source.mixedPort : 7898,
    controllerPort: Number.isInteger(source.controllerPort) ? source.controllerPort : 9098,
    autostart: source.autostart !== false,
    subscription: {
      url: configuredUrl !== '' ? configuredUrl : readSubscription(dataDir),
      intervalSeconds: Number.isInteger(source.subscription?.intervalSeconds) ? source.subscription.intervalSeconds : 3600,
      groupName: typeof source.subscription?.groupName === 'string' && source.subscription.groupName.trim() !== '' ? source.subscription.groupName : 'AUTO',
    },
  }
}

/**
 * Whether one proxy name names a region this product does not list.
 * @param name - proxy name from the controller.
 * @returns true when the name should be omitted.
 */
function excludedName(name) {
  return EXCLUDED_REGION.test(name)
}

/**
 * Reachable proxies, without groups, built-in policies, or excluded regions.
 * @param proxies - controller proxy map.
 * @returns node rows, delay taken from the last health check when one exists.
 */
function nodeEntries(proxies) {
  const nodes = []
  for (const [name, proxy] of Object.entries(proxies ?? {})) {
    if (BUILTIN.has(name) || excludedName(name)) continue
    const type = proxy?.type
    if (typeof type !== 'string' || GROUP_TYPES.has(type)) continue
    const history = Array.isArray(proxy.history) ? proxy.history : []
    const last = history.length === 0 ? undefined : history[history.length - 1]
    const delay = typeof last?.delay === 'number' && last.delay > 0 ? last.delay : undefined
    nodes.push({ name, delay })
  }
  return nodes
}

/**
 * Measure one node through the controller.
 * @param controllerPort - controller port on loopback.
 * @param name - proxy name.
 * @returns the measured delay in milliseconds, or undefined when the probe failed.
 */
async function probeDelay(controllerPort, name) {
  try {
    const target = `http://127.0.0.1:${String(controllerPort)}/proxies/${encodeURIComponent(name)}/delay?timeout=3000&url=${encodeURIComponent('https://www.gstatic.com/generate_204')}`
    const response = await fetch(target, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) return undefined
    const body = await response.json()
    return typeof body?.delay === 'number' ? body.delay : undefined
  } catch (cause) {
    void cause
    return undefined
  }
}

/**
 * Fill measured delays, a few nodes at a time.
 * @param nodes - rows to measure.
 * @param controllerPort - controller port on loopback.
 * @returns the same rows with delays replaced where the probe answered.
 */
async function measure(nodes, controllerPort) {
  const next = nodes.map(node => ({ ...node }))
  let cursor = 0
  const worker = async () => {
    while (cursor < next.length) {
      const index = cursor
      cursor += 1
      const delay = await probeDelay(controllerPort, next[index].name)
      if (delay !== undefined) next[index].delay = delay
    }
  }
  const workers = Math.min(6, next.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return next
}

/**
 * Read a JSON request body.
 * @param request - the incoming request.
 * @returns the parsed object, or an empty object when the body is empty or not JSON.
 */
function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => { chunks.push(chunk) })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch (cause) {
        void cause
        resolve({})
      }
    })
    request.on('error', (cause) => {
      void cause
      resolve({})
    })
  })
}

/**
 * Mount the core and its routes.
 * @param ctx - plugin context.
 * @param rawConfig - row configuration.
 */
export function apply(ctx, rawConfig) {
  const home = resolveHome()
  const config = resolveConfig(rawConfig, home)
  if (!config.enabled) return
  const state = { pid: 0, lastError: '', forcedWrite: false }

  /** Resolve the core and its configuration, or explain why not. */
  function prepared() {
    const binary = resolveBinary(config.binary)
    if (binary === undefined) return { error: 'mihomo core not found next to the application' }
    try {
      const configPath = ensureConfig({
        dataDir: config.dataDir,
        mixedPort: config.mixedPort,
        controllerPort: config.controllerPort,
        subscription: config.subscription,
        overwrite: state.forcedWrite === true || config.subscription.url !== '',
      })
      return { binary, configPath }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function reload() {
    stop()
    state.forcedWrite = true
    const result = await start()
    state.forcedWrite = false
    return result
  }

  async function start() {
    if (state.pid !== 0 && pidAlive(state.pid)) return 'already running'
    const ready = prepared()
    if (ready.error !== undefined) { state.lastError = ready.error; return ready.error }
    const started = startCore({ binary: ready.binary, dataDir: config.dataDir, configPath: ready.configPath })
    if (started.error !== undefined) { state.lastError = started.error; return started.error }
    state.pid = started.child.pid ?? 0
    state.lastError = ''
    return 'started'
  }

  /** Stop the core. @returns a short status line. */
  function stop() {
    if (state.pid === 0) return 'not running'
    killCore(state.pid)
    state.pid = 0
    return 'stopped'
  }

  /** One observation for the status route. */
  async function observation() {
    const binary = resolveBinary(config.binary)
    const version = await coreVersion(config.controllerPort)
    const proxies = version === undefined ? undefined : await listProxies(config.controllerPort)
    return {
      installed: binary !== undefined,
      binary: binary ?? '',
      running: version !== undefined || (state.pid !== 0 && pidAlive(state.pid)),
      pid: state.pid,
      version: version ?? '',
      mixedPort: config.mixedPort,
      controller: 'http://127.0.0.1:' + String(config.controllerPort),
      proxies: proxies === undefined ? 0 : Object.keys(proxies).length,
      configPath: config.dataDir + '/config.yaml',
      subscription: config.subscription.url === '' ? { configured: false } : {
        configured: true,
        host: hostOf(config.subscription.url),
        group: config.subscription.groupName,
        node: await selectedNode(config.controllerPort, config.subscription.groupName),
      },
      lastError: state.lastError,
    }
  }

  /** Answer JSON and stop. */
  function sendJson(response, request, body) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body))
  }

  /** Register the loopback routes; a Host without a web server keeps the plugin idle. */
  function registerRoutes() {
    ctx.inject(['webServer'], (web) => {
      web.effect(() => web.webServer.register({
        kind: 'exact',
        path: '/dsh-clashvpn/status',
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { allow: 'GET, HEAD' }).end()
            return
          }
          sendJson(response, request, await observation())
        },
      }), 'dsh-clashvpn: status route')
      web.effect(() => web.webServer.register({
        kind: 'exact',
        path: '/dsh-clashvpn/nodes',
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { allow: 'GET, HEAD' }).end()
            return
          }
          const proxies = await listProxies(config.controllerPort)
          let nodes = nodeEntries(proxies)
          const url = new URL(request.url ?? '/', 'http://clashvpn.invalid')
          if (url.searchParams.get('probe') === '1') nodes = await measure(nodes, config.controllerPort)
          sendJson(response, request, { nodes })
        },
      }), 'dsh-clashvpn: nodes route')
      web.effect(() => web.webServer.register({
        kind: 'exact',
        path: '/dsh-clashvpn/config',
        handler: async (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' }).end()
            return
          }
          const body = await readBody(request)
          const url = typeof body.subscriptionUrl === 'string' ? body.subscriptionUrl.trim() : ''
          writeFileSync(join(config.dataDir, 'subscription.json'), JSON.stringify({ url }) + '\n')
          config.subscription.url = url
          const result = await reload()
          sendJson(response, request, { result, status: await observation() })
        },
      }), 'dsh-clashvpn: config route')
      web.effect(() => web.webServer.register({
        kind: 'exact',
        path: '/dsh-clashvpn/select',
        handler: async (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' }).end()
            return
          }
          const url = new URL(request.url ?? '/', 'http://clashvpn.invalid')
          const name = url.searchParams.get('name') ?? ''
          let result = 'missing name'
          if (name !== '' && !excludedName(name)) {
            try {
              const switched = await fetch(
                `http://127.0.0.1:${String(config.controllerPort)}/proxies/${encodeURIComponent(config.subscription.groupName)}`,
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ name }),
                  signal: AbortSignal.timeout(1500),
                },
              )
              result = switched.ok ? name : 'switch failed'
            } catch (cause) {
              result = cause instanceof Error ? cause.message : 'switch failed'
            }
          }
          sendJson(response, request, { result, status: await observation() })
        },
      }), 'dsh-clashvpn: select route')
      web.effect(() => web.webServer.register({
        kind: 'exact',
        path: '/dsh-clashvpn/control',
        handler: async (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' }).end()
            return
          }
          const url = new URL(request.url ?? '/', 'http://clashvpn.invalid')
          const action = url.searchParams.get('action')
          const result = action === 'start' ? await start() : action === 'reload' ? await reload() : action === 'stop' ? stop() : 'unknown action'
          sendJson(response, request, { result, status: await observation() })
        },
      }), 'dsh-clashvpn: control route')
    })
  }

  registerRoutes()
  // Starting the core fetches a subscription and spawns mihomo. The handshake does not wait for
  // either; a failure stays on the status route.
  if (config.autostart) void start()
}
