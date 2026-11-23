# HarGlobal 移动端接入方案（Kuikly）

状态：**方案稿**，未实现。

## 1. 现状

桌面端目前提供的是**可选局域网访问**（`apps/desktop-shell/src/lan-access.ts`）：

1. 用户打开开关，shell 把监听绑到 LAN，并生成一个 32 字节共享密钥
2. 手机上二维码里是 `http://<lan-ip>:<port>/__lan?<secret>`
3. 手机打开一次，用密钥换一个一年期的 `hcn_lan` cookie
4. 之后手机就是用浏览器访问同一套 Web GUI（`dsh-web-mobile` 提供移动布局）

限制：必须在同一网段；cookie 一年不过期；只能跑网页版。

## 2. 目标

用腾讯 Kuikly（Kotlin Multiplatform）做原生客户端，一套 Kotlin 代码覆盖
Android / iOS / 鸿蒙，取代扫码局域网方案。

Kuikly 现状（2026-02 核对官方文档与仓库 `tencent-tds/kuiklyui`）：
- Kotlin Multiplatform + 自研 UI 渲染，已有 Compose DSL（**Beta**，2026 计划正式发布）
- 平台：Android、iOS、鸿蒙（2025 开源）、H5、小程序；2026 计划补 Web/macOS
- 提供 KuiklyBase 兼容 KMP 生态，可扩展原生模块复用 Android/iOS 存量能力

## 3. 分层设计

```
┌───────────────────────────────────────────────┐
│ shared/  (KMP, 约 80% 代码)                    │
│  ui/       Compose DSL 页面(会话/对话/设置)     │
│  state/    单向数据流 + 持久化                  │
│  protocol/ Ktor + WebSocket + JSON 编解码       │
│  crypto/   配对(Curve25519) + 设备密钥          │
└───────────────┬───────────────────────────────┘
        ┌───────┴────────┬──────────────┐
   androidApp        iosApp         ohosApp
   (Activity)     (UIViewController) (ArkTS 入口)
```

## 4. 连接与配对（取代扫码）

### 4.1 第一阶段：配对码替代 cookie 链接

- 桌面生成**设备配对载荷**：`{host, port, pairingId, publicKey, expiresAt}`，二维码编码它
- 手机扫码后用 Curve25519 与桌面交换密钥，提交设备公钥与设备名
- 桌面在「移动设备」页列出已配对设备，可随时撤销
- 之后手机用**每设备令牌**鉴权（不再是一年共享 cookie）

新增桌面接口（App 静态检查点，需与现有 Host 路由风格一致）：

| 方法与路径 | 用途 |
|---|---|
| `POST /__pair/start` | 桌面侧开启一次配对会话，返回 `pairingId` + `publicKey` + 过期时间 |
| `POST /__pair/complete` | 手机提交设备公钥/名称，换长期设备令牌 |
| `GET /__pair/devices` | 列出已配对设备（仅桌面） |
| `POST /__pair/devices/:id/revoke` | 撤销某设备 |

### 4.2 第二阶段：跨网络（可选）

局域网直连仍然最快，跨网络需要一条出站通道：

- 桌面用 WebSocket **主动出站**连到中继（自建或 HarGlobal 云），注册设备公钥
- 手机连中继，用设备令牌鉴权；中继按 `deviceId` 双向转发
- 中继只见密文（端到端：手机↔桌面各持一对会话密钥）

好处：不开放入站端口、NAT 友好、可跨运营商。
代价：中继要运维；必须端到端加密，否则等于把账号交给中继。

## 5. 协议层（关键工作量）

Host 现有传输：
- `/.dsh/stream-mux`：WebSocket 复用通道
- `/.dsh/remote-stream`：Remote 流
- 其余为 HTTP 路由

要做的第一件事是**把移动端需要的 API 面固化成文档 + 版本号**，只暴露：

| 能力 | 说明 |
|---|---|
| `sessions.list` / `sessions.get` | 会话列表与单会话消息 |
| `sessions.send` | 发消息（流式返回） |
| `sessions.events` | 增量事件（订阅式） |
| `files.upload` | 附件（第二阶段） |
| `auth.device` | 设备令牌校验 |

做法：从 `packages/api/remotes` 与 Typert 现有定义里提取这 5 个域，写一份
`docs/mobile-api.md`，加 `apiVersion` 字段；Kotlin 侧用 kotlinx.serialization 建模型。

**这是整个方案的前置条件**：协议不稳，UI 白写。

## 6. 里程碑

| 阶段 | 内容 | 估时 |
|---|---|---|
| M0 | 协议固化（`mobile-api.md` + `apiVersion`） | 1–2 天 |
| M1 | Kuikly 工程骨架 + 配对 + 设备令牌 + 会话列表（只读） | 3–5 天 |
| M2 | 对话页 + 流式输出 + 断线重连 | 5–7 天 |
| M3 | 桌面「移动设备」设置页（配对码、设备列表、撤销） | 2–3 天 |
| M4 | 鸿蒙壳 + 三端打包脚本 | 4–5 天 |
| M5 | 推送（APNs/FCM/鸿蒙 Push）与后台保活 | 4–5 天 |
| M6 | 跨网络中继（可选） | 5–7 天 |

合计约 **4–6 周**（一名熟悉 KMP 的工程师）；M0+M1 是可行性验证点。

## 7. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| Kuikly Compose DSL 仍 Beta | API 变动 | 锁版本；UI 层与协议层解耦 |
| 鸿蒙端构建链（Kotlin 产物 + ArkTS 桥） | 排期不确定 | M4 单独排期，先出 Android/iOS |
| Host 协议为内部 API，无公开 schema | 客户端易碎 | M0 先固化 + 版本号 + 兼容窗口 |
| 应用商店审核 / 企业分发 | 上线受阻 | 先内测分发（TestFlight / 企业证书 / 鸿蒙开发者签名） |
| 中继运维与合规 | 成本 | 默认关闭，允许自建 |

## 8. 建议的落地顺序

1. **M0**：先把 `mobile-api.md` 写死，确定 5 个域的消息格式
2. **M1**：一个只能看会话列表的 Kuikly App，跑通配对与鉴权
3. 验证通过后并行推进 M2（对话）与 M3（桌面设置页）
4. 鸿蒙与推送放到最后，避免早期被构建链拖住

短期替代：**在 M0 完成前，保留扫码局域网方案**，只是把链接里的 cookie 换成一次性配对码。
