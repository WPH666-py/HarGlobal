const toggle = document.querySelector('#toggle')
const state = document.querySelector('#state')
const panel = document.querySelector('#panel')
const linkInput = document.querySelector('#link')
const qrImage = document.querySelector('#qr')
const hint = document.querySelector('#hint')
const foot = document.querySelector('#foot')

const call = async (path, method = 'GET') => {
  const response = await fetch(`/shell-api/lan${path}`, { method, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`shell-api ${path}: ${response.status}`)
  return await response.json()
}

let render = (status) => {
  toggle.checked = status.enabled === true
  state.textContent = status.enabled ? '已开启' : '已关闭'
  panel.hidden = status.enabled !== true
  if (status.enabled && status.link) {
    linkInput.value = status.link
    qrImage.src = `/shell-api/lan/qr?ts=${Date.now()}`
    hint.textContent = '用手机扫描上面的二维码，或把链接发到手机'
    foot.textContent = `局域网地址 ${status.address}:${status.port}（手机与电脑需在同一个 Wi-Fi）`
  } else {
    linkInput.value = ''
    qrImage.removeAttribute('src')
    foot.textContent = ''
  }
}

const fail = (error) => { foot.textContent = `操作失败：${error.message}` }

toggle.addEventListener('change', async () => {
  toggle.disabled = true
  try {
    render(await call(toggle.checked ? '/enable' : '/disable', 'POST'))
  } catch (error) {
    toggle.checked = !toggle.checked
    fail(error)
  } finally {
    toggle.disabled = false
  }
})

document.querySelector('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(linkInput.value)
    hint.textContent = '链接已复制'
  } catch {
    linkInput.select()
    hint.textContent = '请按 Ctrl+C 复制选中的链接'
  }
})

document.querySelector('#rotate').addEventListener('click', async () => {
  try {
    render(await call('/rotate', 'POST'))
    hint.textContent = '旧链接已失效，这是一条新链接'
  } catch (error) {
    fail(error)
  }
})

try {
  render(await call(''))
} catch (error) {
  fail(error)
}
// Pairing: a six-digit code the phone may type when the camera path is not available.
const pairButton = document.querySelector('#pair')
const pairCode = document.querySelector('#pairCode')
const pairHint = document.querySelector('#pairHint')
const deviceList = document.querySelector('#devices')
const diag = document.querySelector('#diag')
const copyFw = document.querySelector('#copyFw')

const renderDevices = (devices) => {
  deviceList.textContent = ''
  if (devices.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'empty'
    empty.textContent = '还没有设备配对。'
    deviceList.append(empty)
    return
  }
  for (const device of devices) {
    const row = document.createElement('li')
    const label = document.createElement('span')
    label.textContent = `${device.name} · ${device.createdAt.slice(0, 10)}`
    const revoke = document.createElement('button')
    revoke.type = 'button'
    revoke.textContent = '撤销'
    revoke.addEventListener('click', async () => {
      try {
        await fetch('/shell-api/lan/devices/revoke', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: device.id }),
        })
        renderDevices((await call('/devices')).devices)
      } catch (error) {
        fail(error)
      }
    })
    row.append(label, revoke)
    deviceList.append(row)
  }
}

pairButton?.addEventListener('click', async () => {
  try {
    const session = await call('/pair/start', 'POST')
    pairCode.hidden = false
    pairCode.textContent = session.code
    const expires = new Date(session.expiresAt)
    pairHint.textContent = `5 分钟内有效（到 ${expires.toLocaleTimeString()}）。手机上输入这 6 位码即可配对。`
  } catch (error) {
    fail(error)
  }
})

copyFw?.addEventListener('click', async () => {
  const command = 'netsh advfirewall firewall add rule name="HarGlobal LAN" dir=in action=allow protocol=TCP localport=' + (new URL(location.href).port || '32323')
  try {
    await navigator.clipboard.writeText(command)
    diag.textContent = '已复制：用管理员 PowerShell 运行即可放行端口。'
  } catch {
    diag.textContent = command
  }
})

// Load the device list whenever the door is open.
const originalRender = render
render = (status) => {
  originalRender(status)
  if (status.enabled) {
    diag.textContent = `当前监听 ${status.address}:${status.port}（端口每次启动都会变，重新生成链接可拿到最新的）`
    call('/devices').then((body) => { renderDevices(body.devices) }).catch(() => {})
  }
}