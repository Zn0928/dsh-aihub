import { createDecipheriv, createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Self-implemented Trae credential discovery.
 *
 * Trae keeps its login in the desktop app's `storage.json`; the token is sealed
 * with AES-128-CBC under a SHA-512 derivation from a per-install random plus a
 * fixed salt. This module finds every installed edition, decrypts the token,
 * and exposes the identity. Usage/chat endpoints are later phases.
 */

const SALT = {
  A: Buffer.from('Uglq1TA2pTi/QKOegfPX+3zjOYKbL/+HNI5DRMTe6ctUe5QypsIjPe5MlQtC+sNOCC6hZijZJLJ2W6JJbYvRJQ==', 'base64'),
  B: Buffer.from('H92oM4gHxzGxEhBZJ4DsX2BRf6kZtUoNLeV6n5PJnO+g4DtNrir1sMjruzyDU5lhFysEfrp31ibhaRRjVSEMfQ==', 'base64'),
  C: Buffer.from('v8DY+nr23GEf/mIbCEhHsIdjYBJ/Zcto02a/fSVIlpwz5XkjEZmNsW6DloCs//4GEow3Puz5h0CHDHUEWZWo0Q==', 'base64'),
  D: Buffer.from('9swa6OhGgW3fkqnyF/FpkTLEpSr+eAM29M/RVTUGimqvlB/MurqltleOMQonbhqaVjitfRJAxuFjY1NSv4ZMqg==', 'base64'),
}

const STORAGE_KEY = 'iCubeAuthInfo://icube.cloudide'
const APP_NAMES = {
  cn: ['Trae CN', 'trae-cn'],
  sg: ['Trae'],
  solo: ['TRAE SOLO CN', 'trae-solo-cn'],
  'solo-sg': ['TRAE SOLO'],
}

function xor(a, b) {
  return Buffer.from(a.map((value, index) => value ^ (b[index] ?? 0)))
}

function encryptionType(buffer) {
  const header = buffer.subarray(0, 6)
  if (header.equals(Buffer.from([18, 57, 32, 32, 2, 3]))) return 'aes-private'
  return 'aes'
}

export function decryptTraeValue(encoded) {
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length <= 102) throw new Error('Trae auth ciphertext is too short')
  const type = encryptionType(buffer)
  const random = buffer.subarray(6, 38)
  const encrypted = buffer.subarray(38)
  const salt = type === 'aes-private' ? xor(SALT.C, SALT.D) : xor(SALT.A, SALT.B)
  const first = createHash('sha512').update(random).digest()
  const derived = createHash('sha512').update(Buffer.concat([first, salt])).digest()
  const decipher = createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32))
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  if (decrypted.length < 64) throw new Error('Trae auth plaintext is too short')
  const expected = decrypted.subarray(0, 64)
  const plaintext = decrypted.subarray(64)
  const actual = createHash('sha512').update(plaintext).digest()
  if (!expected.equals(actual)) throw new Error('Trae auth integrity check failed')
  return plaintext.toString('utf8')
}

function parseAuthValue(value) {
  const trimmed = value.trim()
  return JSON.parse(trimmed.startsWith('{') ? trimmed : decryptTraeValue(trimmed))
}

/** Every installed edition's storage path, in probe order. */
export function storageCandidates(env = process.env, home = homedir()) {
  const roots = [env.APPDATA, join(home, 'AppData', 'Roaming')]
    .filter((value, index, all) => typeof value === 'string' && value.length > 0 && all.indexOf(value) === index)
  const out = []
  for (const edition of ['cn', 'sg', 'solo', 'solo-sg']) {
    for (const root of roots) {
      for (const name of APP_NAMES[edition]) {
        out.push({ edition, path: join(root, name, 'User', 'globalStorage', 'storage.json') })
      }
    }
  }
  return out
}

/**
 * Read every readable Trae login. A missing or unreadable edition is skipped;
 * malformed ciphertext is reported so a version bump is visible.
 */
export function readTraeAuth(env = process.env, home = homedir()) {
  const accounts = []
  const errors = []
  for (const candidate of storageCandidates(env, home)) {
    if (!existsSync(candidate.path)) continue
    try {
      const document = JSON.parse(readFileSync(candidate.path, 'utf8'))
      const raw = document[STORAGE_KEY]
      if (typeof raw !== 'string' || raw.length === 0) throw new Error('no auth entry')
      const info = parseAuthValue(raw)
      if (typeof info.token !== 'string' || info.token.length === 0) throw new Error('no token')
      accounts.push({
        edition: candidate.edition,
        path: candidate.path,
        token: info.token,
        refreshToken: typeof info.refreshToken === 'string' ? info.refreshToken : undefined,
        host: typeof info.host === 'string' ? info.host : (candidate.edition === 'cn' || candidate.edition === 'solo' ? 'https://api.trae.cn' : 'https://api.trae.ai'),
        userId: String(info.userId ?? ''),
        name: String(info.account?.username ?? info.account?.email ?? ''),
        email: String(info.account?.email ?? ''),
        region: String(info.userRegion?.region ?? info.userRegion?._aiRegion ?? ''),
        expiresAt: typeof info.expiredAt === 'string' ? Date.parse(info.expiredAt) : undefined,
      })
    } catch (error) {
      errors.push({ path: candidate.path, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { accounts, errors }
}

function originOf(account) {
  return account.region === 'SG' ? 'https://www.trae.ai' : 'https://www.trae.cn'
}

function payBaseOf(account) {
  if (typeof account.host === 'string' && account.host.length > 0) return account.host.replace(/\/+$/, '')
  return account.region === 'SG' ? 'https://api.trae.ai' : 'https://api.trae.cn'
}

function authHeaders(account) {
  const origin = originOf(account)
  return {
    authorization: `Cloud-IDE-JWT ${account.token}`,
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0',
    origin,
    referer: `${origin}/`,
  }
}

async function postJson(url, headers, body, signal) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    signal,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Trae ${url} HTTP ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

const DETAIL_FUNCTIONS = [
  'ui_builder_v2', 'solo_coder', 'chat_v3', 'solo_builder', 'builder_v3', 'builder',
  'chat', 'inline_chat', 'git_ai', 'custom_agent_generation', 'utils', 'code_reviewer',
  'code_review_summary', 'solo_agent', 'solo_agent_remote', 'solo_work_remote',
  'solo_agent_lite', 'solo_work_lite', 'solo_design_lite', 'solo_design_remote',
  'multimodal', 'system_diagnosis',
]

function chatBaseOf(account) {
  return account.region === 'SG' ? 'https://coresg-normal.trae.ai' : 'https://trae-api-cn.mchost.guru'
}

/** Real identity Trae itself sends: storage device ids plus the build version. */
function traeIdentity(account) {
  const storage = JSON.parse(readFileSync(account.path, 'utf8'))
  const machineId = typeof storage['telemetry.machineId'] === 'string' ? storage['telemetry.machineId'] : ''
  const dcKey = Object.keys(storage).find((key) => key.startsWith('iCubeAuthInfo://icube-dc:'))
  const deviceId = dcKey !== undefined ? dcKey.split(':').pop() : (storage['telemetry.devDeviceId'] ?? machineId)
  const buildVersion = typeof storage['iCubeLastVersion'] === 'string' ? storage['iCubeLastVersion'] : ''
  const versionCode = /^\d+$/u.test(buildVersion) ? buildVersion : '20260716'
  return { machineId, deviceId, buildVersion, versionCode, appVersion: buildVersion }
}

/** Identity headers Trae gates its APIs on; derived from the client's own storage. */
function ideHeaders(account, accept = 'application/json', requestId = randomUUID()) {
  const identity = traeIdentity(account)
  const trace = requestId.replace(/-/gu, '').slice(0, 32)
  return {
    authorization: `Cloud-IDE-JWT ${account.token}`,
    'x-ide-token': account.token,
    'x-plugin-channel': 'icube-ai',
    'user-agent': `Trae/${identity.appVersion || 'unknown'}`,
    'x-app-id': '6eefa01c-1036-4c7e-9ca5-d891f63bfcd8',
    'x-machine-id': identity.machineId,
    'x-device-id': identity.deviceId,
    'x-device-type': 'windows',
    'x-app-version': identity.appVersion,
    'x-ide-version': identity.appVersion,
    'x-app-version-code': identity.versionCode,
    'x-ide-version-code': identity.versionCode,
    'x-ide-version-type': 'stable',
    'x-custom-trace-id': trace,
    'x-flow-traceparent': `04-${trace}-${trace.slice(0, 16)}-01`,
    'request-traffic-type': 'prod',
    'content-type': 'application/json',
    accept,
  }
}

/** Chat adds the cloudide/uid/request-id headers the consumer gateway requires. */
function chatHeaders(account, requestId) {
  return {
    ...ideHeaders(account, 'text/event-stream', requestId),
    'X-Cloudide-Token': account.token,
    'x-uid': account.userId,
    'x-request-id': requestId,
    'x-trae-request-id': requestId,
  }
}

/** Model roster merged across the chat-capable functions. */
export async function fetchTraeModels(account, signal) {
  const payload = await postJson(
    `${chatBaseOf(account)}/api/ide/v1/batch_get_detail_param`,
    ideHeaders(account),
    {
      functions: DETAIL_FUNCTIONS,
      agent_type: '',
      current_config_info: { config_name: '', is_custom_model: false },
      mode_type: 0,
      access_type: 0,
      ab_force_vids: '',
      ab_autotest_advanced_mode: 0,
    },
    signal,
  )
  const byId = new Map()
  for (const fn of payload.function_configs ?? []) {
    for (const entry of fn.config_info_list ?? []) {
      const id = typeof entry.config_name === 'string' ? entry.config_name : ''
      const displayName = entry.display_config?.display_name ?? entry.display_config?.name
      if (id.length === 0 || typeof displayName !== 'string' || displayName.length === 0) continue
      let priceFactor
      try {
        const contact = typeof entry.display_contact_config === 'string' ? JSON.parse(entry.display_contact_config) : entry.display_contact_config
        const rate = contact?.consumption_rate
        if (rate?.enable === true && typeof rate.data?.rate === 'number' && rate.data.rate > 0) priceFactor = rate.data.rate
      } catch {}
      const known = byId.get(id)
      if (known !== undefined) {
        // The same model appears once per function; only some rows carry a rate.
        if (known.priceFactor === undefined && priceFactor !== undefined) {
          known.priceFactor = priceFactor
          // Prefer the display name of the row that actually carries the rate.
          if (typeof displayName === 'string' && displayName.length > 0) known.name = displayName
        }
        continue
      }
      const detail = Array.isArray(entry.model_detail_list) ? entry.model_detail_list[0] : undefined
      const promptMax = Number(detail?.prompt_max_tokens ?? 0) || 0
      const windowTokens = entry.context_window_tokens && typeof entry.context_window_tokens === 'object'
        ? Object.values(entry.context_window_tokens).map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
        : []
      const maxWindow = Math.max(promptMax, ...windowTokens, 0) || undefined
      const defaultWindow = Number(entry.context_window_tokens?.dev ?? 0) || promptMax || maxWindow
      byId.set(id, {
        id,
        name: displayName,
        contextWindow: maxWindow,
        defaultContextWindow: defaultWindow,
        maxContextWindow: maxWindow,
        function: String(fn.function ?? ''),
        priceFactor,
      })
    }
  }
  return [...byId.values()]
}

/** Credits (CN Work pool) or subscription state (international). */
export async function fetchTraeCredits(account, signal) {
  if (account.region === 'SG') {
    const pay = await postJson(`${payBaseOf(account)}/trae/api/v1/pay/ide_user_pay_status`, authHeaders(account), {}, signal)
    return {
      kind: 'subscription',
      plan: typeof pay.user_pay_identity_str === 'string' ? pay.user_pay_identity_str : undefined,
      trial: pay.trial_status?.is_in_trial === true,
      hasPackage: pay.has_package === true,
    }
  }
  const usage = await postJson(`${payBaseOf(account)}/trae/api/v2/pay/web_user_ent_usage`, authHeaders(account), { require_usage: true }, signal)
  const summary = usage.usage_summary ?? {}
  const total = Number(summary.total_amount ?? 0)
  const consumed = Number(summary.consumed_amount ?? 0)
  return {
    kind: 'credits',
    total,
    consumed,
    available: Math.max(0, total - consumed),
    creditsBilling: usage.is_credits_billing === true,
    packs: (usage.user_entitlement_pack_list ?? []).map((pack) => ({
      label: String(pack.display_desc ?? ''),
      total: Number(pack.entitlement_base_info?.charge_amount ?? 0),
      consumed: Number(pack.entitlement_base_info?.used_amount ?? 0),
    })).filter((pack) => pack.total > 0),
  }
}

function messageText(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
}

function traeMessages(options) {
  const messages = []
  if (typeof options.system === 'string' && options.system.length > 0) {
    messages.push({ role: 'system', content: [{ type: 'text', text: options.system }] })
  }
  for (const message of options.messages ?? []) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = messageText(message.content)
      if (text.length > 0) messages.push({ role: 'system', content: [{ type: 'text', text }] })
      continue
    }
    if (message.role === 'user') {
      messages.push({ role: 'user', content: [{ type: 'text', text: messageText(message.content) }] })
      continue
    }
    if (message.role === 'assistant') {
      const text = messageText(message.content)
      const calls = (message.content ?? []).filter((block) => block?.type === 'tool-call')
      const entry = { role: 'assistant', content: [{ type: 'text', text }] }
      if (calls.length > 0) {
        entry.tool_calls = calls.map((call) => ({
          id: call.id,
          type: 'function',
          // Trae's SOLO envelope spells the payload `function_call`, not `function`.
          function_call: { name: call.name, arguments: call.arguments },
        }))
      }
      messages.push(entry)
      continue
    }
    if (message.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: String(message.source?.callId ?? message.toolCallId ?? ''), content: [{ type: 'text', text: messageText(message.content) }] })
    }
  }
  return messages
}

function traeTools(options) {
  if (!Array.isArray(options.tools) || options.tools.length === 0) return undefined
  return options.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      // Trae's SOLO envelope carries parameters as a JSON string, not an object.
      parameters: typeof tool.parameters === 'object' ? JSON.stringify(tool.parameters) : String(tool.parameters ?? '{}'),
    },
  }))
}

/** Stream one Trae chat turn from the `llm_utils_chat` SSE endpoint. */
export async function* chatTrae(account, modelId, options, signal) {
  const tools = traeTools(options)
  const requestId = randomUUID()
  const body = {
    model: modelId,
    config_name: modelId,
    messages: traeMessages(options),
    function: 'solo_work_lite',
    stream: true,
    tools: tools ?? [],
  }
  const response = await fetch(`${chatBaseOf(account)}/api/agent/v3/llm_utils_chat`, {
    method: 'POST',
    headers: chatHeaders(account, requestId),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const code = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : `HTTP_${response.status}`
    throw Object.assign(new Error(`trae chat: HTTP ${response.status} ${detail.slice(0, 300)}`), { code, status: response.status })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let nextIndex = 0
  let textBlock
  let reasoningBlock
  const toolBlocks = new Map()
  let usage
  let finishReason
  let done = false
  let upstreamError

  try {
    while (!done) {
      const { value, done: end } = await reader.read()
      if (end) break
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue }
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (raw === '' || raw === '[DONE]') continue
        let payload
        try { payload = JSON.parse(raw) } catch { continue }
        if (eventName === 'error') {
          upstreamError = `trae chat upstream ${payload.code ?? ''}: ${payload.message ?? ''}`
          done = true
          break
        }
        if (eventName === 'done') {
          if (typeof payload.finish_reason === 'string') finishReason = payload.finish_reason
          if (payload.usage !== undefined) usage = payload.usage
          done = true
          break
        }
        if (eventName !== 'output') continue
        const reasoning = payload.reasoning_content
        if (typeof reasoning === 'string' && reasoning.length > 0) {
          if (reasoningBlock === undefined) {
            reasoningBlock = { index: nextIndex++, text: '' }
            yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
          }
          reasoningBlock.text += reasoning
          yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
        }
        const text = payload.response
        if (typeof text === 'string' && text.length > 0) {
          if (textBlock === undefined) {
            textBlock = { index: nextIndex++, text: '' }
            yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
          }
          textBlock.text += text
          yield { type: 'text-delta', index: textBlock.index, text }
        }
        for (const rawCall of payload.tool_calls ?? []) {
          const key = rawCall.index ?? 0
          let call = toolBlocks.get(key)
          if (call === undefined) {
            call = { index: nextIndex++, id: rawCall.id ?? `call_${key}_${toolBlocks.size}`, name: '', args: '' }
            toolBlocks.set(key, call)
            yield { type: 'block-start', index: call.index, blockType: 'tool-call' }
          }
          if (typeof rawCall.id === 'string' && rawCall.id.length > 0) call.id = rawCall.id
          // Trae spells the payload `function_call`; OpenAI-style `function` is kept as a fallback.
          const fn = rawCall.function_call ?? rawCall.function
          if (typeof fn?.name === 'string' && fn.name.length > 0) call.name = fn.name
          if (typeof fn?.arguments === 'string' && fn.arguments.length > 0) {
            call.args += fn.arguments
            yield { type: 'tool-call-delta', index: call.index, id: call.id, ...(call.name ? { name: call.name } : {}), argumentsDelta: fn.arguments }
          }
        }
        if (typeof payload.usage === 'object' && payload.usage !== null) usage = payload.usage
      }
    }
  } finally {
    try { await reader.cancel() } catch {}
  }

  if (upstreamError !== undefined) throw new Error(upstreamError)
  if (reasoningBlock !== undefined) yield { type: 'block-end', index: reasoningBlock.index, block: { type: 'reasoning', text: reasoningBlock.text } }
  if (textBlock !== undefined) yield { type: 'block-end', index: textBlock.index, block: { type: 'text', text: textBlock.text } }
  for (const call of toolBlocks.values()) {
    yield { type: 'block-end', index: call.index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: call.args || '{}' } }
  }
  if (usage !== undefined) {
    yield {
      type: 'usage',
      usage: {
        inputTokens: Number(usage.prompt_tokens ?? 0),
        outputTokens: Number(usage.completion_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? 0) || undefined,
      },
    }
  }
  let kind = 'stop'
  if (toolBlocks.size > 0 || finishReason === 'tool_calls') kind = 'tool-calls'
  else if (finishReason === 'length') kind = 'max-tokens'
  yield { type: 'finish', reason: { kind } }
}

/**
 * Trae's own cached model table, read from `state.vscdb`.
 *
 * The IDE catalogue (`batch_get_detail_param`) only answers chat-mode models;
 * the desktop client also caches its complete agent roster here. Optional on
 * purpose: `node:sqlite` may be unavailable, and the caller only uses this as
 * a completeness check.
 */
export async function readTraeCachedRoster(account) {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const databases = storageCandidates()
      .map((candidate) => candidate.path.replace(/storage\.json$/u, 'state.vscdb'))
      .filter((value, index, all) => all.indexOf(value) === index)
    for (const database of databases) {
      if (!existsSync(database)) continue
      const db = new DatabaseSync(database, { readOnly: true })
      try {
        const labels = {}
        const unique = new Map()
        let found = false
        for (const key of [`${account.userId}_AI.agent.model.model_list_map`, `${account.userId}:AI.agent.model.model_list_map`]) {
          const row = db.prepare('select value from ItemTable where key = ?').get(key)
          if (row === undefined || typeof row.value !== 'string') continue
          const map = JSON.parse(row.value)
          for (const [label, list] of Object.entries(map)) {
            const names = (Array.isArray(list) ? list : []).map((item) => item?.name).filter((name) => typeof name === 'string' && name.length > 0)
            labels[label] = Math.max(labels[label] ?? 0, names.length)
            for (const name of names) unique.set(name, true)
            if (names.length > 0) found = true
          }
        }
        if (found) return { labels, modelCount: unique.size, models: [...unique.keys()] }
      } finally {
        db.close?.()
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Daily check-in status (CN only; the reward is per account and per device). */
export async function checkinStatus(account, signal) {
  if (account.region === 'SG') throw new Error('Trae 签到仅支持国内版')
  const identity = traeIdentity(account)
  const headers = { ...authHeaders(account), 'x-device-id': identity.deviceId }
  const payload = await postJson(`${payBaseOf(account)}/trae/api/v2/ug/checkin_credits/status`, headers, {}, signal)
  const extra = Number(payload.extra_credits ?? 0)
  return {
    checkedIn: payload.checked_in === true,
    didCheckedIn: payload.did_checked_in === true,
    credits: Number(payload.credits ?? 0) || 0,
    enabled: payload.enable !== false,
    ...(extra > 0 ? { extraCredits: extra } : {}),
  }
}

/** Claim today's reward. A business refusal is HTTP 200 with a non-zero code. */
export async function checkinClaim(account, signal) {
  if (account.region === 'SG') throw new Error('Trae 签到仅支持国内版')
  const identity = traeIdentity(account)
  const headers = { ...authHeaders(account), 'x-device-id': identity.deviceId }
  const payload = await postJson(`${payBaseOf(account)}/trae/api/v2/ug/checkin_credits/claim`, headers, {}, signal)
  const code = Number(payload.code ?? 0) || 0
  return {
    claimed: code === 0,
    code,
    message: typeof payload.message === 'string' ? payload.message.slice(0, 200) : '',
  }
}