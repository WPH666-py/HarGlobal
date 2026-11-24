/**
 * 移动访问窗口：把微信扫码登录页嵌进来。
 *
 * 页面由 shell 提供，`/wechat/qr` 属于 Host，经由同源的 Host 代理转发过去，所以这里用相对路径
 * 请求它，不受跨域限制。插件没装时 Host 返回 404，这里换成一条可操作的提示，而不是留一张 404。
 */
const main = document.querySelector('main')
const box = document.getElementById('frame-box')
const missing = document.getElementById('missing')
const hint = document.getElementById('hint')

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
  const ready = await probe()
  if (ready) {
    box.hidden = false
    hint.hidden = false
    main.dataset.state = 'ready'
    return
  }
  box.hidden = true
  hint.hidden = true
  missing.hidden = false
  main.dataset.state = 'missing'
  window.setTimeout(present, 3000)
}

void present()
