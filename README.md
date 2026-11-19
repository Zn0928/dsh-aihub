# dsh-aihub

**一个入口，花掉你所有订阅平台的额度。**

`dsh-aihub` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件。它注册一个名为 `aihub` 的提供商，把 Qoder、Trae、CodeArts 的订阅额度串成一条降级链，并可选地接入 OpenAI 兼容的付费 API 兜底。在模型选择器里选一次 **Dev**，之后哪家额度先用完、哪个平台报错，都会自动切到下一个，不需要来回切模型。

> English quick start: [jump](#english-quick-start).

## 功能

- **额度聚合 + 自动降级**：按顺序尝试各平台；429、余额不足、鉴权失败、连接失败、超时会自动换下一个。
- **三个平台自研适配，无第三方连接器依赖**
  - Qoder：PAT → job token → COSY 签名；模型目录、额度、SSE 对话（含推理块与工具调用）
  - Trae：解密本机 `storage.json` 登录；模型目录、积分、SOLO 通道对话与工具调用
  - CodeArts：本机 OAuth 凭证 + 华为云 `SDK-HMAC-SHA256` 签名；模型目录、积分、OpenAI 兼容对话
- **按模式配置**：`Dev`、`Dev Fast` 各自选模型、各自设置输出上限；上下文窗口按上游声明自动取链上最小值。
- **稳定性开关**：同会话粘性（一次成功尽量不再换平台）、单平台锁定（失败直接报错而不是换模型）。
- **设置页 + 侧栏额度卡**：DSH 设置里一页完成授权、模型选择、顺序调整；侧栏显示三平台剩余额度进度与行内签到。
- **签到**：Qoder / Trae / CodeArts 每日签到（幂等，重复领取按“已领”处理）。
- **诊断工具**：`aihub_status` 一次读出授权、模型数、额度、上次应答平台；`aihub_selftest` 可离线验证降级链路。

## 架构

```
浏览器（client.js）                      Host（index.js）
┌──────────────────────────┐   HTTP   ┌──────────────────────────────┐
│ 设置 → AI Hub 配置页      │ ───────▶ │ 7 个 /aihub/* JSON 路由       │
│ 侧栏额度卡 + 签到         │          │ FailoverAdapter（llm 适配器） │
└──────────────────────────┘          │  buildChains / 冷却 / 粘性    │
                                      └──────┬──────────┬────────────┘
                                             │          │
                                       qoder.js     trae.js     codearts.js
                                       （自研客户端，直连各家 API）
                                             │
                                      platform（OpenAI 兼容直连，可选）
```

- 客户端只认 `aihub` 这一个 provider，模型名是逻辑档位（`dev` / `dev-fast` / `selftest`）。
- 每条请求按链顺序尝试 target；在“出现可见内容”之前失败会静默换下一个，并缓存开头 chunk，避免半截 `block-start`。
- 已经出字后断流不重放，直接把错误抛给 agent。
- 切换时会给接手模型注入一段说明：先核对仓库状态（`git status`、`.ai/handoff.md`）再继续。

## 环境要求

- DeepSeek Harness 0.2.x（`llm`、`webServer`、`configEditor`、`tools` 服务）。已在 **0.2.2-rc.3** 实测：`webServer`/`tools` 可能晚于本插件激活，插件用 `ctx.inject([...])` 等待服务，不会静默跳过路由和工具注册。
- Node.js **>= 22.5**（Trae 本地模型表读取使用内置 `node:sqlite`；低版本会自动跳过，不影响主流程）
- 本机已登录对应官方客户端（推荐），或已配置相应 API Key

## 安装

在 DSH 中让 agent 执行，或使用 Plugin Manager：

```text
plugin_manager: install_bundle <本仓库绝对路径>
```

安装后刷新页面：

- 设置侧栏出现 **AI Hub** 页
- 模型选择器出现 **AI Hub → Dev / Dev Fast / Selftest**
- 左侧栏底部出现 **AI Hub 额度** 卡

> 本插件**零运行时依赖**：`index.js` 只使用 Node 内置模块，clone 后可直接安装，无需 `pnpm install`。

## 配置

全部配置都在 **设置 → AI Hub**，写回插件配置并自动重载。对应 `cordis.patch.yml` 字段：

| 字段 | 说明 |
| --- | --- |
| `provider` | 注册的 provider 名，默认 `aihub` |
| `displayName` | 模型选择器里的分组名 |
| `cooldownMs` | 失败 target 的冷却时间，默认 60s |
| `useMaxContextWindow` | `true` 用上游声明的最大窗口，`false` 用默认窗口 |
| `providers[]` | 平台列表：`id`（`qoder`/`trae`/`codearts`）、`label`、`model`、`defaultContextWindow`、`maxContextWindow` |
| `fallbacks[]` | 订阅额度耗尽后的 API 兜底，格式 `provider/model` |
| `modes[]` | 每个模式的链：`model`、`label`、`contextWindow`、`maxTokens`、`pinned`、`targets[]` |

`pinned: true` 表示该模式只尝试第一个可用平台，失败直接报错；默认关闭。

## 认证与安全

插件**不包含任何凭证**，也不会上报任何数据。凭证来源：

| 平台 | 来源 | 处理方式 |
| --- | --- | --- |
| Qoder | 设置页粘贴 Personal Access Token | 存本机 `DSH_HOME/.aihub/qoder.json`（0600），仅用于换取 job token；不会写日志 |
| Trae | 官方客户端 `%APPDATA%\{Trae CN, TRAE SOLO CN, TRAE SOLO}\User\globalStorage\storage.json` | 内存中 AES 解密，不落盘复制 |
| CodeArts | 官方登录写入 `DSH_HOME/.codearts-accounts.json` | 只读；自动刷新时会把轮换后的 `refresh_token` 原子写回，并保留 `.aihub-backup` 备份 |

- 所有请求都直接发往各厂商 API，插件自身无远端服务。
- 如果你在 Qoder 设置页“断开”，只删除本插件自己的 PAT 文件，不影响官方客户端。
- CodeArts 刷新会轮换 `refresh_token`，写回失败时可用备份恢复官方客户端登录。

### CodeArts 登录过期了怎么办

华为云的 `refresh_token` 每次刷新都会轮换，用过的旧值立即失效；一旦插件自己那份也过期，就只能换一条可用的登录。卡片上的 **重新登录** 按钮按顺序试两条路：

1. **复用官方客户端会话**：CodeArts Agent 客户端会把登录续在后台，插件从它的 `User/globalStorage/state.vscdb` 里读出这条会话（Windows 上用 DPAPI 解开 safeStorage 密钥，凭据只在内存中解密，不复制到别处），验证额度可用后写回 `.codearts-accounts.json`。这是最省事的一条——通常只要客户端登录着，点一下就恢复。
2. **用插件自己的 `refresh_token` 续期**：客户端没装或会话也失效时的兜底。

两条都失败时，按钮会提示你先在 CodeArts Agent 客户端登录一次，再回来点。账号不一致时不会盲目覆盖，会明确提示客户端登录的是另一个账号。

- 过期判定不只看 HTTP 401：华为云过期返回的是 `HTTP 400` + `APIG.0602`，插件用「`expiration` 是否已过」外加该错误码一起判断，过期时会先把卡片标黄再提示重新登录。
- 会话读取依赖 Node 内置的 `node:sqlite`（Node ≥ 22.5）。运行时不支持时该路径会自动跳过，只保留第 2 条，不会报错。

## 使用

1. **选模型**：模型选择器里选 `AI Hub → Dev`。之后不用再切平台。
2. **看额度/签到**：左侧栏底部 AI Hub 卡片，显示三家剩余额度与使用率；每行右侧可直接签到。
3. **诊断**：让 agent 调用
   - `aihub_status`：授权、模型数、额度、上次应答平台
   - `aihub_selftest {"model":"dev"}`：跑真实链，报告“谁答的”
   - `aihub_selftest {"model":"selftest"}`：离线 mock 链，验证降级逻辑且不花额度

### 离线自检

```bash
python scripts/mock-platform.py
```

然后在模型选择器选 `Selftest` 发一句话：链上第一个 target 指向死端口，能回答说明降级生效。

## 平台适配细节

| 平台 | 授权 | 模型/额度 | 对话 |
| --- | --- | --- | --- |
| Qoder | PAT → `/api/v1/jobToken/exchange` → COSY（RSA+AES+MD5）签名 | `/algo/api/v2/model/list`、`/api/v2/quota/usage` | `/algo/.../agent_chat_generation`，请求体需自定义 Base64 编码 |
| Trae | AES-128-CBC 解密本机登录（SHA-512 校验） | `batch_get_detail_param`、`/trae/api/v2/pay/web_user_ent_usage` | `/api/agent/v3/llm_utils_chat`，`solo_work_lite` + `function_call` |
| CodeArts | 本机 STS/AK/SK；刷新用 DPoP（ES256） | `/v1/model/builtin`、`/snap-manager/v1/statistics/plugin` | `/api/v2/chat/completions`（OpenAI 兼容），需 AK/SK 签名 |

## 已知限制

- **Trae 对话只对 SOLO 通道认可的模型可用**。目录会列出 IDE 的全部模型，但部分模型在该通道返回 `param is invalid`；失败会由降级链接管。
- **CodeArts 受账号并发会话数限制**（实测 3 个）。占满时返回 `TM.00001041`，请求会切到下一个平台。
- **纯文本模型**：`inputModalities: ['text']`，图片按占位符处理。
- **切换不是无损接力**：消息与工具结果会完整重放，但上一模型的推理过程不会传递；长时间跨平台任务建议配合仓库内的交接文档。
- **签到目前是手动触发**（按钮），不做后台自动签到。
- 各平台接口可能随客户端版本变化；协议实现以官方客户端行为为准，不保证永久有效。

## 免责声明

本项目通过逆向官方客户端与本机凭证实现接入，仅用于**个人在本机统一管理自己的订阅额度**。使用前请确认各平台服务条款允许第三方客户端访问；因违反条款、账号风控或凭证刷新导致的后果由使用者自行承担。

## 开发

```
index.js      降级适配器、配置 API、工具
qoder.js      Qoder 客户端
trae.js       Trae 客户端
codearts.js   CodeArts 客户端
client.js     设置页 + 侧栏卡
cordis.patch.yml
```

- 语法检查：`node --check index.js`（其余文件同理）
- 安装后在 DSH 里用 `aihub_selftest` / `aihub_status` 做端到端验证
- 仓库无运行时依赖、无 `node_modules`；插件配置页由自身页面提供，不依赖 DSH 原生表单 schema

## License

[MIT](./LICENSE)

---

## English quick start

`dsh-aihub` is a DeepSeek Harness plugin that registers a single `aihub` provider. Pick **Dev** once and it walks an ordered chain of Qoder, Trae and CodeArts subscriptions, falling back to the next platform on quota exhaustion or failure, then to optional paid OpenAI-compatible APIs.

- **Zero third-party connectors**: each platform client is implemented in this repository.
- **Settings page** for auth/model/order, **sidebar card** for live quota and daily check-in.
- **Reads local credentials only**; ships no secrets and sends nothing to a plugin-owned server.
- Requires Node >= 22.5 and a logged-in official client per platform (or API keys for fallbacks).

Install with DSH `plugin_manager: install_bundle <repo path>`, refresh the page, then choose `AI Hub → Dev`. Use `aihub_status` for a snapshot and `aihub_selftest` for an offline failover check.

MIT licensed. Use at your own risk and in line with each vendor's terms of service.