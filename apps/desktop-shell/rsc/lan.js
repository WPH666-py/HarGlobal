/**
 * 移动访问窗口：微信扫码登录，外加最常用的三个动作。
 *
 * 页面由 shell 提供，`/wechat/*` 属于 Host，经同源的 Host 代理转发过去，所以这里用相对路径请求，
 * 不受跨域限制。插件没装时 Host 返回 404，这里换成一条可操作的提示，而不是留一张错误页。
 */
const main = document.querySelector('main')
const box = document.getElementById('frame-box')
const frame = document.getElementById('frame')
const missing = document.getElementById('missing')
const controls = document.getElementById('controls')
const message = document.getElementById('message')
const cwd = document.getElementById('cwd')
const timeout = document.getElementById('timeout')

/** 报告一次动作的结果。 */
function say(text, failed) {
  message.textContent = text
  message.dataset.tone = failed === true ? 'error' : 'ok'
}

/** 重新载入扫码页，让二维码和状态重新拉一遍。 */
function reloadFrame() {
  frame.src = `/wechat/qr?t=${String(Date.now())}`
}

/** 调用插件的一个动作接口。 */
async function call(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${String(response.status)}`)
  if (payload.ok === false) throw new Error(payload.message ?? '操作失败')
  return payload
}

async function probe() {
  try {
    const response = await fetch('/wechat/qr', { method: 'GET', cache: 'no-store' })
    const type = response.headers.get('content-type') ?? ''
    return response.ok && type.includes('text/html')
  } catch (error) {
    // 代理还没准备好（Host 刚启动）时按未就绪处理，重试会自愈。
    void error
    return false
  }
}

async function present() {
  if (await probe()) {
    box.hidden = false
    controls.hidden = false
    missing.hidden = true
    main.dataset.state = 'ready'
    return
  }
  box.hidden = true
  controls.hidden = true
  missing.hidden = false
  main.dataset.state = 'missing'
  window.setTimeout(present, 3000)
}

document.getElementById('save').addEventListener('click', async () => {
  const patch = {}
  if (cwd.value.trim() !== '') patch.cwd = cwd.value.trim()
  const ms = Number(timeout.value)
  if (timeout.value.trim() !== '' && Number.isFinite(ms) && ms > 0) patch.cardTimeoutMs = ms
  if (Object.keys(patch).length === 0) {
    say('没有要保存的内容：留空表示不修改', true)
    return
  }
  try {
    await call('/wechat/api/config', patch)
    say('配置已保存')
  } catch (error) {
    say(`保存失败：${error instanceof Error ? error.message : String(error)}`, true)
  }
})

document.getElementById('relogin').addEventListener('click', async () => {
  try {
    const result = await call('/wechat/api/relogin')
    say(result.message ?? '已重新生成二维码')
    reloadFrame()
  } catch (error) {
    say(`重新扫码失败：${error instanceof Error ? error.message : String(error)}`, true)
  }
})

document.getElementById('logout').addEventListener('click', async () => {
  try {
    const result = await call('/wechat/api/logout')
    say(result.message ?? '已退出登录')
    reloadFrame()
  } catch (error) {
    say(`退出失败：${error instanceof Error ? error.message : String(error)}`, true)
  }
})

void present()
