import {
  constants as cryptoConstants,
  createCipheriv,
  createHash,
  publicEncrypt,
  randomUUID,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Self-implemented Qoder client: PAT -> job token -> signed COSY requests.
 * Covers authorisation, the model catalog, and the quota document only.
 * Chat transport is a later phase.
 */

const REGIONS = {
  china: {
    api: 'https://openapi.qoder.com.cn',
    gateway: 'https://gateway.qoder.com.cn/',
  },
  global: {
    api: 'https://openapi.qoder.sh',
    gateway: 'https://api3.qoder.sh/',
  },
}

const IDE_VERSION = '1.1.47'
const USER_AGENT = `qoder/${IDE_VERSION}`
const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`
const MACHINE_OS = process.platform === 'win32'
  ? (process.arch === 'arm64' ? 'aarch64_windows' : 'x86_64_windows')
  : (process.arch === 'arm64' ? 'aarch64_linux' : 'x86_64_linux')

function regionOf(name) {
  return REGIONS[name] ?? REGIONS.china
}

function baseHeaders() {
  return {
    accept: 'application/json',
    'accept-encoding': 'identity',
    'user-agent': USER_AGENT,
    'cosy-version': '1.0.1',
    'cosy-clienttype': '5',
  }
}

/** Stable per-installation machine id, seeded next to the plugin's own records. */
function machineId(home) {
  const file = join(home, '.aihub', 'machine-id')
  try {
    if (existsSync(file)) {
      const value = readFileSync(file, 'utf8').trim()
      if (value.length > 0) return value
    }
    mkdirSync(dirname(file), { recursive: true })
    const value = randomUUID()
    writeFileSync(file, value, { mode: 0o600 })
    return value
  } catch {
    return randomUUID()
  }
}

function aesCbcBase64(plaintext, key) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(key))
  return cipher.update(plaintext, 'utf8', 'base64') + cipher.final('base64')
}

function rsaBase64(value) {
  return publicEncrypt(
    { key: RSA_PUBLIC_KEY, padding: cryptoConstants.RSA_PKCS1_PADDING },
    Buffer.from(value),
  ).toString('base64')
}

function sigPathOf(url) {
  let path = new URL(url).pathname
  if (path.startsWith('/algo')) path = path.slice(5)
  return path
}

/** The COSY signature envelope Qoder's gateway requires on every backend call. */
function cosyHeaders(url, creds, body) {
  const aesKey = randomUUID().replace(/-/g, '').slice(0, 16)
  const info = {
    uid: creds.userId,
    security_oauth_token: creds.jobToken,
    name: creds.name ?? '',
    aid: '',
    email: creds.email ?? '',
  }
  const infoB64 = aesCbcBase64(JSON.stringify(info), aesKey)
  const cosyKey = rsaBase64(aesKey)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const payloadB64 = Buffer.from(JSON.stringify({
    version: 'v1',
    requestId: randomUUID(),
    info: infoB64,
    cosyVersion: IDE_VERSION,
    ideVersion: '',
  })).toString('base64')
  const bodyText = body ?? ''
  const sig = createHash('md5')
    .update(`${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyText}\n${sigPathOf(url)}`)
    .digest('hex')
  const bodyHash = createHash('md5').update(bodyText).digest('hex')
  return {
    authorization: `Bearer COSY.${payloadB64}.${sig}`,
    'cosy-key': cosyKey,
    'cosy-user': creds.userId,
    'cosy-date': timestamp,
    'cosy-version': IDE_VERSION,
    'cosy-machineid': creds.machineId,
    'cosy-machinetoken': creds.machineId,
    'cosy-machinetype': '5',
    'cosy-machineos': MACHINE_OS,
    'cosy-clienttype': '5',
    'cosy-clientip': '127.0.0.1',
    'cosy-bodyhash': bodyHash,
    'cosy-bodylength': String(bodyText ? Buffer.byteLength(bodyText) : 0),
    'cosy-sigpath': sigPathOf(url),
    'cosy-data-policy': 'disagree',
    'cosy-organization-id': '',
    'cosy-organization-tags': '',
    'login-version': 'v2',
    'x-request-id': randomUUID(),
  }
}

async function readJson(response, label) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label}: response is not JSON`)
  }
}

/** Exchange a Qoder Personal Access Token for a short-lived job token. */
export async function exchangePat(pat, regionName, home, signal) {
  const region = regionOf(regionName)
  const response = await fetch(`${region.api}/api/v1/jobToken/exchange`, {
    method: 'POST',
    headers: { ...baseHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ personal_token: pat }),
    signal,
  })
  const data = await readJson(response, 'qoder exchange')
  if (typeof data.token !== 'string' || data.token.length === 0) {
    throw new Error('qoder exchange returned no job token')
  }
  const creds = {
    jobToken: data.token,
    machineId: machineId(home),
    userId: '',
    name: '',
    email: '',
    expiresAt: typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : Date.now() + 86400000,
  }
  const infoResponse = await fetch(`${region.api}/api/v1/userinfo`, {
    headers: {
      ...baseHeaders(),
      authorization: `Bearer ${creds.jobToken}`,
      'cosy-machinetoken': creds.machineId,
      'cosy-machinetype': 'host',
    },
    signal,
  })
  const info = await readJson(infoResponse, 'qoder userinfo')
  creds.userId = String(info.id ?? info.userID ?? info.userId ?? info.uid ?? '')
  creds.name = String(info.name ?? info.nickname ?? '')
  creds.email = String(info.email ?? '')
  if (creds.userId.length === 0) throw new Error('qoder userinfo returned no user id')
  return creds
}

function modelsFrom(payload) {
  const rows = []
  const walk = (value, depth) => {
    if (depth > 4 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && (item.key || item.model_id || item.id)) {
          rows.push(item)
        } else {
          walk(item, depth + 1)
        }
      }
      return
    }
    for (const key of ['chat', 'models', 'data', 'result', 'list']) {
      if (value[key] !== undefined) walk(value[key], depth + 1)
    }
  }
  walk(payload, 0)

  const contextWindowOf = (raw) => {
    const direct = Number(raw.max_input_tokens ?? raw.maxInputTokens ?? raw.context_window ?? 0)
    if (Number.isFinite(direct) && direct > 0) return direct
    const config = raw.context_config
    if (config && typeof config === 'object') {
      let best = 0
      for (const entry of Object.values(config)) {
        const count = Number(entry?.token_count ?? 0)
        if (Number.isFinite(count) && count > best) best = count
      }
      if (best > 0) return best
    }
    return undefined
  }

  const seen = new Set()
  const out = []
  for (const raw of rows) {
    if (raw.enable === false) continue
    const id = String(raw.key ?? raw.model_id ?? raw.id ?? '')
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const direct = Number(raw.max_input_tokens ?? raw.maxInputTokens ?? raw.context_window ?? 0) || 0
    const entries = Object.values(raw.context_config ?? {})
    const values = entries.map((entry) => Number(entry?.token_count ?? 0)).filter((value) => value > 0)
    const maxWindow = Math.max(direct, ...values, 0) || undefined
    const defaultEntry = entries.find((entry) => entry?.is_default === true)
    const defaultWindow = Number(defaultEntry?.token_count ?? 0) || direct || maxWindow
    out.push({
      id,
      name: String(raw.display_name ?? raw.name ?? id),
      contextWindow: maxWindow,
      defaultContextWindow: defaultWindow,
      maxContextWindow: maxWindow,
      maxTokens: Number(raw.max_output_tokens ?? raw.maxTokens ?? 0) || undefined,
      supportsImages: raw.is_vl === true,
      source: typeof raw.source === 'string' ? raw.source : 'system',
      priceFactor: Number(raw.price_factor ?? raw.priceFactor ?? NaN),
      contextConfig: raw.context_config && typeof raw.context_config === 'object' ? raw.context_config : undefined,
    })
  }
  return out
}

export async function listModels(creds, regionName, signal) {
  const region = regionOf(regionName)
  const url = `${region.gateway}algo/api/v2/model/list?Encode=1`
  const response = await fetch(url, {
    headers: { ...baseHeaders(), ...cosyHeaders(url, creds, '') },
    signal,
  })
  return modelsFrom(await readJson(response, 'qoder models'))
}

function quotaRow(label, raw) {
  if (raw === undefined || raw === null) return undefined
  const total = Number(raw.total ?? 0)
  const remaining = Number(raw.remaining ?? 0)
  if (!Number.isFinite(total) && !Number.isFinite(remaining)) return undefined
  return { label, total: Number.isFinite(total) ? total : 0, remaining: Number.isFinite(remaining) ? remaining : 0, unit: String(raw.unit ?? 'credits') }
}

export async function fetchCredits(creds, regionName, signal) {
  const region = regionOf(regionName)
  const response = await fetch(`${region.api}/api/v2/quota/usage`, {
    headers: {
      ...baseHeaders(),
      authorization: `Bearer ${creds.jobToken}`,
      'cosy-machinetoken': creds.machineId,
      'cosy-machinetype': 'host',
    },
    signal,
  })
  const data = await readJson(response, 'qoder quota')
  const rows = [
    quotaRow('个人额度', data.userQuota),
    quotaRow('组织资源包', data.orgResourcePackage),
    quotaRow('赠送额度', data.addOnQuota),
  ].filter(Boolean)
  return {
    rows,
    exceeded: data.isQuotaExceeded === true,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
    totalRemaining: rows.reduce((sum, row) => sum + row.remaining, 0),
    totalSize: rows.reduce((sum, row) => sum + row.total, 0),
  }
}

/** Default on-disk location for our own credentials (never the connector's). */
export function aiHubHome() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return resolve(home)
}

const modelCache = new Map()

/** Cached catalog lookup (10 minutes) so one chat call is not two round trips. */
async function cachedModels(creds, region, signal) {
  const key = `${region}:${creds.userId}`
  const hit = modelCache.get(key)
  if (hit !== undefined && hit.expiresAt > Date.now()) return hit.models
  const models = await listModels(creds, region, signal)
  modelCache.set(key, { models, expiresAt: Date.now() + 600000 })
  return models
}

function qoderMessages(options) {
  const messages = []
  if (typeof options.system === 'string' && options.system.trim().length > 0) {
    messages.push({ role: 'system', content: options.system })
  }
  for (const message of options.messages ?? []) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(message.content)
      if (text.length > 0) messages.push({ role: 'system', content: text })
      continue
    }
    if (message.role === 'user') {
      messages.push({ role: 'user', content: textOf(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const text = textOf(message.content)
      const calls = (message.content ?? []).filter((block) => block?.type === 'tool-call')
      const entry = { role: 'assistant', content: text.length > 0 ? text : '' }
      if (calls.length > 0) {
        entry.tool_calls = calls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        }))
      }
      messages.push(entry)
      continue
    }
    if (message.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: String(message.source?.callId ?? message.toolCallId ?? ''),
        content: textOf(message.content),
      })
    }
  }
  return messages
}

function textOf(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
}

function qoderTools(options) {
  if (!Array.isArray(options.tools) || options.tools.length === 0) return []
  return options.tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: 'object', properties: {} } },
  }))
}

function lastUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && typeof messages[index].content === 'string') return messages[index].content
  }
  return ''
}

function stableRecordId(modelId, messages, tools, maxTokens) {
  return createHash('sha256')
    .update(`qoder-record\0${modelId}\0${JSON.stringify(messages)}\0${JSON.stringify(tools)}\0mt=${maxTokens}`)
    .digest('hex')
    .slice(0, 16)
}

function qoderBody(options, modelId, model) {
  const messages = qoderMessages(options)
  const maxTokens = Math.min(
    Number(options.maxTokens ?? model?.maxTokens ?? 32768) || 32768,
    Number(model?.maxTokens ?? 32768) || 32768,
  )
  const tools = qoderTools(options)
  const recordId = stableRecordId(modelId, messages, tools, maxTokens)
  const prompt = lastUserText(messages)
  const contextConfig = model?.contextConfig && Object.keys(model.contextConfig).length > 0
    ? Object.fromEntries(Object.entries(model.contextConfig).map(([key, value]) => [key, {
      ...(typeof value?.token_count === 'number' ? { token_count: value.token_count } : {}),
      ...(typeof value?.is_default === 'boolean' ? { is_default: value.is_default } : {}),
    }]))
    : undefined
  return {
    request_id: randomUUID(),
    request_set_id: recordId,
    chat_record_id: recordId,
    session_id: `${credsSessionPart(modelId)}-${String(options.sessionId ?? randomUUID())}`,
    stream: true,
    chat_task: 'FREE_INPUT',
    is_reply: true,
    is_retry: false,
    source: 1,
    version: '3',
    session_type: 'qodercli',
    agent_id: 'agent_common',
    task_id: 'common',
    code_language: '',
    chat_prompt: '',
    image_urls: null,
    aliyun_user_type: '',
    system: '',
    messages,
    tools: qoderTools(options),
    parameters: { max_tokens: maxTokens },
    chat_context: {
      chatPrompt: '',
      imageUrls: null,
      extra: {
        context: [],
        modelConfig: { key: modelId, is_reasoning: false },
        originalContent: prompt,
      },
      features: [],
      text: prompt,
    },
    model_config: {
      key: modelId,
      max_output_tokens: maxTokens,
      is_reasoning: false,
      source: 'system',
      ...(contextConfig === undefined ? {} : { context_config: contextConfig }),
    },
    business: {
      product: 'cli',
      version: '1.0.0',
      type: 'agent',
      stage: 'start',
      id: randomUUID(),
      name: prompt.slice(0, 30),
      begin_at: Date.now(),
    },
  }
}

function credsSessionPart(modelId) {
  return createHash('sha1').update(`aihub-qoder:${modelId}`).digest('hex').slice(0, 16)
}

const CUSTOM_ALPHABET = '_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!'
const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Qoder's wire encoding: Base64, rotate by a third, then remap the alphabet. */
function encodeBody(plaintext) {
  const std = Buffer.from(plaintext).toString('base64')
  const n = std.length
  const a = Math.floor(n / 3)
  const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a)
  const out = Buffer.allocUnsafe(n)
  for (let index = 0; index < n; index += 1) {
    const code = rearranged.charCodeAt(index)
    const stdIndex = STD_ALPHABET.indexOf(String.fromCharCode(code))
    out[index] = code === 61 ? 36 : stdIndex === -1 ? code : CUSTOM_ALPHABET.charCodeAt(stdIndex)
  }
  return out.toString('latin1')
}

/** Stream one Qoder chat turn as harness stream chunks. */
export async function* chat(creds, regionName, modelId, options, signal) {
  const region = regionOf(regionName)
  const models = await cachedModels(creds, regionName, signal)
  const model = models.find((entry) => entry.id === modelId) ?? models[0]
  if (model === undefined) throw new Error('qoder catalog is empty')

  const encoded = encodeBody(JSON.stringify(qoderBody(options, model.id, model)))
  const url = `${region.gateway}algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
      'accept-encoding': 'identity',
      'x-model-key': model.id,
      'x-model-source': model.source ?? 'system',
      ...cosyHeaders(url, creds, encoded),
    },
    body: encoded,
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const code = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : `HTTP_${response.status}`
    throw Object.assign(new Error(`qoder chat: HTTP ${response.status} ${detail.slice(0, 300)}`), { code, status: response.status })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let nextIndex = 0
  let textBlock
  let reasoningBlock
  const toolBlocks = new Map()
  let usage
  let finishReason

  const closeText = () => {
    if (textBlock === undefined) return undefined
    const block = { type: 'block-end', index: textBlock.index, block: { type: 'text', text: textBlock.text } }
    textBlock = undefined
    return block
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '').trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (raw === '' || raw === '[DONE]') continue
        let envelope
        try { envelope = JSON.parse(raw) } catch { continue }
        if (typeof envelope.statusCodeValue === 'number' && envelope.statusCodeValue !== 200) {
          throw Object.assign(new Error(`qoder chat upstream ${envelope.statusCodeValue}: ${String(envelope.body ?? '').slice(0, 300)}`), { code: envelope.statusCodeValue === 429 ? 'RATE_LIMIT' : 'PROVIDER_ERROR' })
        }
        if (typeof envelope.body !== 'string') continue
        let inner
        try { inner = JSON.parse(envelope.body) } catch { continue }
        if (inner.usage !== undefined) usage = inner.usage
        for (const choice of inner.choices ?? []) {
          if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) finishReason = choice.finish_reason
          const delta = choice.delta
          if (delta === undefined) continue
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
            if (reasoningBlock === undefined) {
              reasoningBlock = { index: nextIndex++, text: '' }
              yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
            }
            reasoningBlock.text += delta.reasoning_content
            yield { type: 'reasoning-delta', index: reasoningBlock.index, text: delta.reasoning_content }
          }
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            if (textBlock === undefined) {
              textBlock = { index: nextIndex++, text: '' }
              yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
            }
            textBlock.text += delta.content
            yield { type: 'text-delta', index: textBlock.index, text: delta.content }
          }
          for (const rawCall of delta.tool_calls ?? []) {
            const key = rawCall.index ?? 0
            let call = toolBlocks.get(key)
            if (call === undefined) {
              call = { index: nextIndex++, id: rawCall.id ?? `call_${key}_${toolBlocks.size}`, name: '', args: '' }
              toolBlocks.set(key, call)
              yield { type: 'block-start', index: call.index, blockType: 'tool-call' }
            }
            if (typeof rawCall.id === 'string' && rawCall.id.length > 0) call.id = rawCall.id
            if (typeof rawCall.function?.name === 'string' && rawCall.function.name.length > 0) call.name = rawCall.function.name
            if (typeof rawCall.function?.arguments === 'string' && rawCall.function.arguments.length > 0) {
              call.args += rawCall.function.arguments
              yield { type: 'tool-call-delta', index: call.index, id: call.id, ...(call.name ? { name: call.name } : {}), argumentsDelta: rawCall.function.arguments }
            }
          }
        }
      }
    }
  } finally {
    try { await reader.cancel() } catch {}
  }

  if (reasoningBlock !== undefined) {
    yield { type: 'block-end', index: reasoningBlock.index, block: { type: 'reasoning', text: reasoningBlock.text } }
  }
  const closed = closeText()
  if (closed !== undefined) yield closed
  for (const call of toolBlocks.values()) {
    yield { type: 'block-end', index: call.index, block: { type: 'tool-call', id: call.id, name: call.name, arguments: call.args || '{}' } }
  }
  if (usage !== undefined) {
    const promptTokens = Number(usage.prompt_tokens ?? 0)
    const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? 0)
    const output = Number(usage.completion_tokens ?? 0)
    yield {
      type: 'usage',
      usage: {
        inputTokens: Math.max(0, promptTokens - cached),
        outputTokens: output,
        totalTokens: promptTokens + output,
        ...(cached > 0 ? { cacheReadTokens: cached } : {}),
      },
    }
  }
  let kind = 'stop'
  if (toolBlocks.size > 0 || finishReason === 'tool_calls' || finishReason === 'toolUse') kind = 'tool-calls'
  else if (finishReason === 'length') kind = 'max-tokens'
  yield { type: 'finish', reason: { kind } }
}

function sashHeaders(creds) {
  return {
    ...baseHeaders(),
    'cosy-clienttype': '10',
    authorization: `Bearer ${creds.jobToken}`,
    'cosy-machinetoken': creds.machineId,
    'cosy-machinetype': 'host',
  }
}

async function benefitCampaign(creds, regionName, signal) {
  const region = regionOf(regionName)
  const response = await fetch(`${region.api}/sash/api/v1/me/campaigns`, { headers: sashHeaders(creds), signal })
  const body = await readJson(response, 'qoder campaigns')
  const campaigns = Array.isArray(body.campaigns) ? body.campaigns : []
  return campaigns.find((campaign) => campaign?.actionType === 'CLAIM_BENEFIT')
}

/** Today's daily benefit campaign: window, amount, and whether it was claimed. */
export async function checkinStatus(creds, regionName, signal) {
  const campaign = await benefitCampaign(creds, regionName, signal)
  if (campaign === undefined) return { available: false, status: 'no-campaign' }
  const now = Date.now()
  const startMs = Number(campaign.startAt) * 1000
  const endMs = Number(campaign.endAt) * 1000
  const open = Number.isFinite(startMs) && startMs <= now && (!Number.isFinite(endMs) || endMs >= now)
  return {
    available: true,
    status: campaign.claimStatus === 'CLAIMED' ? 'already-claimed' : (open ? 'claimable' : 'before-window'),
    claimed: campaign.claimStatus === 'CLAIMED',
    amount: Number(campaign.benefit?.amount ?? 0) || 0,
    campaignKey: String(campaign.campaignKey ?? ''),
    opensAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : undefined,
    closesAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : undefined,
  }
}

/** Claim the daily benefit campaign (idempotent upstream). */
export async function checkinClaim(creds, regionName, signal) {
  const region = regionOf(regionName)
  const campaign = await benefitCampaign(creds, regionName, signal)
  if (campaign === undefined) return { status: 'no-campaign', claimed: false }
  if (campaign.claimStatus === 'CLAIMED') {
    return { status: 'already-claimed', claimed: true, amount: Number(campaign.benefit?.amount ?? 0) || 0 }
  }
  const url = `${region.api}/sash/api/v1/me/campaigns/${encodeURIComponent(String(campaign.campaignId))}/claim`
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...sashHeaders(creds), origin: region.api, 'content-type': 'application/json' },
    body: '{}',
    signal,
  })
  const body = await readJson(response, 'qoder claim')
  const claimed = body.status === 'CLAIMED'
  return {
    status: claimed ? (body.replayed === true ? 'already-claimed' : 'claimed') : 'error',
    claimed,
    amount: Number(body.benefit?.amount ?? campaign.benefit?.amount ?? 0) || 0,
    campaignKey: String(campaign.campaignKey ?? ''),
  }
}