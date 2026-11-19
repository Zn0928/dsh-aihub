import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  aiHubHome,
  chat as qoderChat,
  checkinClaim as qoderCheckinClaim,
  checkinStatus as qoderCheckinStatus,
  exchangePat,
  fetchCredits as qoderCredits,
  listModels as qoderModels,
} from './qoder.js'
import {
  chatTrae,
  checkinClaim as traeCheckinClaim,
  checkinStatus as traeCheckinStatus,
  fetchTraeCredits,
  fetchTraeModels,
  readTraeAuth,
  readTraeCachedRoster,
} from './trae.js'
import {
  chatCodeArts,
  codeartsCheckinClaim,
  codeartsCheckinStatus,
  fetchCodeArtsCredits,
  fetchCodeArtsModels,
  importOfficialCodeArtsSession,
  persistCodeArtsAccount,
  readCodeArtsAccounts,
  refreshCodeArtsAccount,
} from './codearts.js'

/**
 * Self-contained failover provider for DeepSeek Harness.
 *
 * Registers one provider route (`aihub`) and speaks OpenAI Chat Completions to
 * the platforms declared in its own config — no dependency on `dsh-llm-pi-ai`
 * or on another connector plugin. A chain entry either names one of those
 * platforms (`glm/glm-4.6`, or `glm` for the platform's first model) or names
 * another registered provider (`qoder`, `trae`, `codearts`), which is delegated
 * through `ctx.llm.stream` so existing subscription connectors keep working.
 *
 * Failure policy: while a target has not produced visible output yet, its
 * failure (quota, auth, rate limit, transport, 5xx, timeout) is absorbed and
 * the next target is tried. The first target that answers owns the rest of the
 * stream; a mid-stream failure is surfaced instead of replayed.
 */

const name = 'llm-aihub'

const DEFAULT_PLATFORMS = [
  {
    id: 'glm',
    displayName: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    models: [{ id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 200000, maxTokens: 32000 }],
  },
  {
    id: 'kimi',
    displayName: 'Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    models: [{ id: 'kimi-k2-0905-preview', name: 'Kimi K2', contextWindow: 262144, maxTokens: 32000 }],
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    baseURL: 'https://api.minimaxi.com/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    models: [{ id: 'MiniMax-M2', name: 'MiniMax M2', contextWindow: 200000, maxTokens: 32000 }],
  },
  {
    id: 'deepseek-api',
    displayName: 'DeepSeek API',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 128000, maxTokens: 16000 }],
  },
  {
    id: 'qwen',
    displayName: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    models: [{ id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', contextWindow: 262144, maxTokens: 32000 }],
  },
  {
    id: 'mock-dead',
    displayName: 'Mock (dead port)',
    baseURL: 'http://127.0.0.1:9/v1',
    apiKey: 'mock',
    models: [{ id: 'mock', name: 'mock', contextWindow: 32000, maxTokens: 1024 }],
  },
  {
    id: 'mock-ok',
    displayName: 'Mock (local)',
    baseURL: 'http://127.0.0.1:4010/v1',
    apiKey: 'mock',
    models: [{ id: 'mock', name: 'mock', contextWindow: 32000, maxTokens: 1024 }],
  },
]

const DEFAULT_PROVIDERS = [
  { id: 'qoder', label: 'Qoder' },
  { id: 'trae', label: 'Trae' },
  { id: 'codearts', label: 'CodeArts' },
]

const DEFAULT_FALLBACKS = [
  'glm/glm-4.6',
  'kimi/kimi-k2-0905-preview',
  'minimax/MiniMax-M2',
  'deepseek-api/deepseek-chat',
  'qwen/qwen3-coder-plus',
]

/** Build the failover chain: selected subscription platforms first, then APIs. */
const SELFTEST_CHAIN = {
  model: 'selftest',
  name: 'Selftest · 离线验证切换',
  contextWindow: 32000,
  maxTokens: 1024,
  targets: ['mock-dead/mock', 'mock-ok/mock'],
}

/** A label that survived a broken client encoding must not reach the picker. */
function cleanModeLabel(label, model) {
  if (typeof label !== 'string' || label.length === 0) return model
  if (label.includes('\uFFFD') || label.includes('\u25C6') || /\?{3,}/u.test(label)) return model
  return label
}

/**
 * Build the failover chains. An explicit `modes` list wins; otherwise derive
 * `dev`/`dev-fast` from the selected platform models and the API fallbacks.
 */
function buildChains(providers, fallbacks, modes, useMaxContextWindow = true) {
  const built = []
  if (Array.isArray(modes) && modes.length > 0) {
    for (const mode of modes) {
      if (typeof mode?.model !== 'string' || !Array.isArray(mode?.targets)) continue
      const targets = mode.targets.filter((entry) => typeof entry === 'string' && entry.length > 0)
      // The window is a property of the models on the chain: the narrowest wins.
      const windows = targets
        .map((target) => {
          const providerId = target.split('/')[0]
          const provider = providers.find((candidate) => candidate.id === providerId)
          if (provider === undefined) return 0
          const declared = useMaxContextWindow
            ? Number(provider.maxContextWindow) || Number(provider.contextWindow) || 0
            : Number(provider.defaultContextWindow) || Number(provider.contextWindow) || 0
          return declared > 0 ? declared : 0
        })
        .filter((value) => value > 0)
      const fallbackWindow = Number(mode.contextWindow) > 0 ? Number(mode.contextWindow) : 200000
      built.push({
        model: mode.model,
        name: cleanModeLabel(mode.label, mode.model),
        contextWindow: windows.length > 0 ? Math.min(...windows) : fallbackWindow,
        maxTokens: Number(mode.maxTokens) > 0 ? Number(mode.maxTokens) : 32000,
        pinned: mode.pinned === true,
        targets,
      })
    }
  }
  if (built.length === 0) {
    const subscription = providers.map((provider) => (
      typeof provider.model === 'string' && provider.model.length > 0
        ? `${provider.id}/${provider.model}`
        : provider.id
    ))
    const fast = [subscription[0], 'deepseek-api/deepseek-chat', 'qwen/qwen3-coder-plus', 'glm/glm-4.6']
    built.push(
      {
        model: 'dev',
        name: 'Dev · 订阅优先，额度用完换 API',
        contextWindow: 200000,
        maxTokens: 32000,
        targets: [...subscription, ...fallbacks],
      },
      {
        model: 'dev-fast',
        name: 'Dev Fast · 便宜优先',
        contextWindow: 128000,
        maxTokens: 16000,
        targets: fast.filter((entry) => typeof entry === 'string' && entry.length > 0),
      },
    )
  }
  if (!built.some((chain) => chain.model === 'selftest')) built.push({ ...SELFTEST_CHAIN })
  return built
}

const REQUEST_TIMEOUT_MS = 600000

function visible(chunk) {
  switch (chunk?.type) {
    case 'text-delta':
    case 'reasoning-delta':
    case 'tool-call-delta':
    case 'block-end':
      return true
    default:
      return false
  }
}

function failureChunk(code, message, status) {
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: { message: message.length > 0 ? message : code, code, ...(status === undefined ? {} : { status }) },
    },
  }
}

function textOf(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text') parts.push(block.text)
    else if (block?.type === 'image') parts.push('[image]')
    else if (block?.type === 'file') parts.push(`[file: ${block.attachment?.name ?? 'attachment'}]`)
  }
  return parts.join('\n')
}

function toOpenAIMessages(options) {
  const messages = []
  if (typeof options.system === 'string' && options.system.length > 0) {
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
      const entry = { role: 'assistant', content: text.length > 0 ? text : null }
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
      const callId = message.source?.callId ?? message.toolCallId
      messages.push({ role: 'tool', tool_call_id: String(callId ?? ''), content: textOf(message.content) })
    }
  }
  return messages
}

function toOpenAITools(options) {
  if (!Array.isArray(options.tools) || options.tools.length === 0) return undefined
  return options.tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: 'object', properties: {} } },
  }))
}

/** Yield each SSE `data:` payload from a fetch body. */
async function* ssePayloads(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return
        if (payload.length > 0) yield payload
      }
    }
  } finally {
    try { await reader.cancel() } catch {}
  }
}

class FailoverAdapter {
  constructor(ctx, settings) {
    this.ctx = ctx
    this.llm = ctx.llm
    this.settings = settings
    this.platforms = new Map(settings.platforms.map((platform) => [platform.id, platform]))
    this.chains = new Map(settings.chains.map((chain) => [chain.model, chain]))
    this.cooldownUntil = new Map()
    this.lastTargets = new Map()
    this.sticky = new Map()
  }

  providerInfo(provider) {
    return { id: provider, name: this.settings.displayName }
  }

  providerRetryPolicy() {
    return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
  }

  imageRequestPricing() {
    return undefined
  }

  imageRequestTarget(_provider, _model, image) {
    return { width: image.width, height: image.height, maxBytes: image.bytes }
  }

  listModels(provider) {
    return Promise.resolve([...this.chains.values()].map((chain) => ({
      provider,
      id: chain.model,
      name: chain.name || chain.model,
      description: chain.targets.join('  →  '),
    })))
  }

  resolveModel(provider, model) {
    const chain = this.chains.get(model)
    if (chain === undefined) {
      return Promise.reject(new Error(`llm-aihub: model "${model}" is not declared; available: ${[...this.chains.keys()].join(', ')}`))
    }
    return Promise.resolve({
      provider,
      id: chain.model,
      name: chain.name || chain.model,
      description: chain.targets.join('  →  '),
      context: { contextWindow: chain.contextWindow ?? 200000 },
      defaultMaxTokens: chain.maxTokens ?? 32000,
      inputModalities: ['text'],
    })
  }

  async prepareCall(provider, model, signal) {
    const info = await this.resolveModel(provider, model, signal)
    return { model: info, stream: (options) => this.stream(options) }
  }

  lastTargetOf(model) {
    return this.lastTargets.get(model)
  }

  cooling(key) {
    const until = this.cooldownUntil.get(key)
    if (until === undefined) return false
    if (until <= Date.now()) {
      this.cooldownUntil.delete(key)
      return false
    }
    return true
  }

  cool(key) {
    const ms = Number(this.settings.cooldownMs)
    if (Number.isFinite(ms) && ms > 0) this.cooldownUntil.set(key, Date.now() + ms)
  }

  warn(message) {
    try { this.ctx.logger?.warn?.(`llm-aihub: ${message}`) } catch {}
  }

  /**
   * A handover note for the model that picks up after a failure. It does not
   * carry the previous model's thinking — it tells the new one to verify the
   * repository state before continuing, which is what actually prevents drift.
   */
  attemptOptions(options, errors) {
    if (errors.length === 0) return options
    const last = errors[errors.length - 1]
    const note = `\n\n[AI Hub] 上一个平台 ${last.target} 在同一次请求里失败了（${last.failure.code}）。你正在接手同一段对话：先核对仓库当前状态（git status、最近改动、.ai/handoff.md），不要假设未验证的修改已经完成，然后再继续。`
    return { ...options, system: `${typeof options.system === 'string' ? options.system : ''}${note}` }
  }

  /** Resolve a chain entry into either a local platform call or a delegated route. */
  async resolveTarget(raw) {
    if (typeof raw !== 'string' || raw.length === 0) return undefined
    const slash = raw.indexOf('/')
    const head = slash === -1 ? raw : raw.slice(0, slash)
    const pinned = slash === -1 ? undefined : raw.slice(slash + 1)
    const platform = this.platforms.get(head)
    if (platform !== undefined) {
      const model = pinned ?? platform.models?.[0]?.id
      if (typeof model !== 'string' || model.length === 0) return undefined
      return { key: `${platform.id}/${model}`, kind: 'platform', platform, model }
    }
    // Native Qoder transport owns the route once our own PAT is stored.
    if (head === 'qoder' && readQoderStore() !== undefined) {
      const model = pinned ?? 'auto'
      return { key: `qoder/${model}`, kind: 'qoder', model }
    }
    if (head === 'codearts' && readCodeArtsAccounts().accounts.length > 0) {
      const model = pinned ?? 'deepseek-v4.1-flash-1017'
      return { key: `codearts/${model}`, kind: 'codearts', model }
    }
    if (head === 'trae' && readTraeAuth().accounts.length > 0) {
      const model = pinned ?? 'glm-5.2'
      return { key: `trae/${model}`, kind: 'trae', model }
    }
    // Another registered provider: bare name resolves its first advertised model.
    const model = pinned ?? (await this.firstModelOf(head))
    if (typeof model !== 'string' || model.length === 0) return undefined
    return { key: `${head}/${model}`, kind: 'delegate', provider: head, model }
  }

  async firstModelOf(provider) {
    try {
      const models = await this.llm.listModels(provider)
      return models?.[0]?.id
    } catch (error) {
      this.warn(`cannot read the model catalog of "${provider}": ${error instanceof Error ? error.message : error}`)
      return undefined
    }
  }

  async *stream(options) {
    const chain = this.chains.get(options.model)
    if (chain === undefined) {
      yield failureChunk('UNKNOWN_MODEL', `llm-aihub: model "${options.model}" is not declared`)
      return
    }

    const resolved = []
    for (const raw of chain.targets) {
      const target = await this.resolveTarget(raw)
      if (target === undefined) {
        this.warn(`target "${raw}" has no usable model`)
        continue
      }
      if (target.kind === 'delegate' && target.provider === this.settings.provider) continue
      resolved.push(target)
    }
    if (resolved.length === 0) {
      yield failureChunk('NO_ADAPTER', `llm-aihub: model "${options.model}" has no usable targets`)
      return
    }

    const fresh = resolved.filter((target) => !this.cooling(target.key))
    let candidates = fresh.length > 0 ? fresh : resolved

    // A pinned mode never fails over: the first usable target is the whole chain.
    if (chain.pinned === true) {
      candidates = candidates.slice(0, 1)
    } else {
      // Sticky within a session: the platform that answered last time keeps the
      // next step, so one transient 429 does not swap the model mid-task.
      const stickyKey = `${String(options.sessionId ?? '')}:${options.model}`
      const remembered = this.sticky.get(stickyKey)
      if (remembered !== undefined && Date.now() - remembered.at < 15 * 60 * 1000) {
        const index = candidates.findIndex((target) => target.key === remembered.target)
        if (index > 0) candidates = [candidates[index], ...candidates.filter((_, position) => position !== index)]
      }
    }

    const errors = []
    for (const target of candidates) {
      if (options.signal?.aborted === true) {
        yield failureChunk('ABORTED', 'request aborted')
        return
      }

      const buffered = []
      let committed = false
      let terminal
      let thrown

      try {
        for await (const chunk of this.callTarget(target, this.attemptOptions(options, errors))) {
          if (!committed) {
            buffered.push(chunk)
            if (visible(chunk)) {
              committed = true
              for (const opening of buffered) yield opening
            } else if (chunk.type === 'finish') {
              terminal = chunk.reason
            }
            continue
          }
          yield chunk
        }
      } catch (error) {
        thrown = error
      }

      if (committed) {
        this.cooldownUntil.delete(target.key)
        this.lastTargets.set(options.model, target.key)
        this.sticky.set(`${String(options.sessionId ?? '')}:${options.model}`, { target: target.key, at: Date.now() })
        if (thrown !== undefined) throw thrown
        return
      }

      if (thrown !== undefined) {
        const message = thrown instanceof Error ? thrown.message : String(thrown)
        errors.push({ target: target.key, failure: { code: 'TRANSPORT', message } })
        this.cool(target.key)
        this.warn(`${target.key} failed: ${message}`)
        continue
      }

      if (terminal?.kind === 'aborted') {
        yield { type: 'finish', reason: terminal }
        return
      }

      const failure = terminal?.failure ?? { code: 'EMPTY_RESPONSE', message: 'target finished without visible output' }
      errors.push({ target: target.key, failure })
      this.cool(target.key)
      this.warn(`${target.key} failed (${failure.code}): ${failure.message}`)
    }

    const last = errors[errors.length - 1]?.failure
    const detail = errors.map((entry) => `${entry.target}: ${entry.failure.code} ${entry.failure.message}`).join(' | ')
    yield failureChunk(last?.code ?? 'ALL_TARGETS_FAILED', `llm-aihub: every target for "${options.model}" failed — ${detail}`, last?.status)
  }

  callTarget(target, options) {
    if (target.kind === 'delegate') {
      return this.llm.stream({ ...options, provider: target.provider, model: target.model })
    }
    if (target.kind === 'qoder') return this.qoderStream(target.model, options)
    if (target.kind === 'codearts') return this.codeartsStream(target.model, options)
    if (target.kind === 'trae') return this.traeStream(target.model, options)
    return this.chat(target.platform, target.model, options)
  }

  async *traeStream(model, options) {
    const { accounts } = readTraeAuth()
    const account = accounts.find((candidate) => candidate.edition === 'cn') ?? accounts[0]
    if (account === undefined) throw new Error('MISSING_CREDENTIAL: 本机没有 Trae 登录')
    yield* chatTrae(account, model, options, options.signal)
  }

  async *codeartsStream(model, options) {
    const { accounts } = readCodeArtsAccounts()
    if (accounts.length === 0) throw new Error('MISSING_CREDENTIAL: 本机没有 CodeArts 账号')
    yield* chatCodeArts(resolveCodeArtsAccount(accounts[0]), model, options, options.signal)
  }

  async *qoderStream(model, options) {
    const state = await ensureQoderCreds()
    if (state === undefined) throw new Error('MISSING_CREDENTIAL: 先在设置 → AI Hub 里授权 Qoder')
    yield* qoderChat(state.creds, state.region, model, options, options.signal)
  }

  /** One OpenAI Chat Completions exchange, translated into harness stream chunks. */
  async *chat(platform, modelId, options) {
    const apiKey = platform.apiKey ?? (platform.apiKeyEnv ? process.env?.[platform.apiKeyEnv] : undefined)
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new Error(`MISSING_CREDENTIAL: ${platform.id} needs ${platform.apiKeyEnv ?? 'apiKey'}`)
    }

    const model = platform.models?.find((entry) => entry.id === modelId) ?? { id: modelId }
    const body = {
      model: modelId,
      messages: toOpenAIMessages(options),
      stream: true,
    }
    if (platform.includeUsage !== false) body.stream_options = { include_usage: true }
    const tools = toOpenAITools(options)
    if (tools !== undefined) body.tools = tools

    const maxTokens = options.maxTokens ?? model.maxTokens
    if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens
    if (Number.isFinite(options.temperature)) body.temperature = options.temperature
    if (Array.isArray(options.stop) && options.stop.length > 0) body.stop = options.stop

    const base = String(platform.baseURL ?? '').replace(/\/+$/, '')
    const url = `${base}/chat/completions`
    const headers = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${apiKey}`,
      ...platform.headers,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS)
    const onAbort = () => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', onAbort, { once: true })

    let response
    try {
      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    } catch (error) {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      if (options.signal?.aborted === true) throw error
      throw new Error(`TRANSPORT ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      const code = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : response.status === 402 ? 'QUOTA' : `HTTP_${response.status}`
      throw Object.assign(new Error(`${platform.id}: HTTP ${response.status} ${detail.slice(0, 400)}`), { code, status: response.status })
    }

    try {
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        // Provider ignored `stream:true`: translate the whole JSON answer at once.
        const payload = await response.json()
        const choice = payload.choices?.[0]
        const text = choice?.message?.content ?? ''
        const calls = choice?.message?.tool_calls ?? []
        let index = 0
        if (typeof text === 'string' && text.length > 0) {
          yield { type: 'block-start', index, blockType: 'text' }
          yield { type: 'text-delta', index, text }
          yield { type: 'block-end', index, block: { type: 'text', text } }
          index += 1
        }
        for (const call of calls) {
          const args = call.function?.arguments ?? '{}'
          yield { type: 'block-start', index, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index, id: call.id, name: call.function?.name, argumentsDelta: args }
          yield { type: 'block-end', index, block: { type: 'tool-call', id: call.id, name: call.function?.name, arguments: args } }
          index += 1
        }
        if (payload.usage !== undefined) yield { type: 'usage', usage: usageOf(payload.usage) }
        yield { type: 'finish', reason: { kind: calls.length > 0 ? 'tool-calls' : 'stop' } }
        return
      }

      yield* this.translateSse(response.body, platform, modelId)
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  async *translateSse(body, platform, modelId) {
    let nextIndex = 0
    let reasoning
    let text
    const tools = new Map()
    let usage
    let finishReason

    for await (const payload of ssePayloads(body)) {
      let event
      try { event = JSON.parse(payload) } catch { continue }
      if (event.error !== undefined) {
        const message = typeof event.error === 'string' ? event.error : event.error?.message ?? JSON.stringify(event.error)
        throw new Error(`${platform.id}: upstream error: ${message}`)
      }
      const choice = event.choices?.[0]
      if (event.usage !== undefined) usage = event.usage
      if (choice === undefined) continue
      const delta = choice.delta ?? {}

      const thinking = delta.reasoning_content ?? delta.reasoning
      if (typeof thinking === 'string' && thinking.length > 0) {
        if (reasoning === undefined) {
          reasoning = { index: nextIndex++, parts: [] }
          yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' }
        }
        reasoning.parts.push(thinking)
        yield { type: 'reasoning-delta', index: reasoning.index, text: thinking }
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        if (text === undefined) {
          text = { index: nextIndex++, parts: [] }
          yield { type: 'block-start', index: text.index, blockType: 'text' }
        }
        text.parts.push(delta.content)
        yield { type: 'text-delta', index: text.index, text: delta.content }
      }

      for (const call of delta.tool_calls ?? []) {
        const key = call.index ?? 0
        let entry = tools.get(key)
        if (entry === undefined) {
          entry = { index: nextIndex++, id: call.id ?? `call_${key}_${tools.size}`, name: call.function?.name ?? '', args: [] }
          tools.set(key, entry)
          yield { type: 'block-start', index: entry.index, blockType: 'tool-call' }
        }
        if (typeof call.id === 'string' && call.id.length > 0) entry.id = call.id
        const nameDelta = call.function?.name
        if (typeof nameDelta === 'string' && nameDelta.length > 0 && entry.name.length === 0) entry.name = nameDelta
        const argsDelta = call.function?.arguments
        if (typeof argsDelta === 'string' && argsDelta.length > 0) {
          entry.args.push(argsDelta)
          yield { type: 'tool-call-delta', index: entry.index, id: entry.id, name: entry.name || undefined, argumentsDelta: argsDelta }
        }
      }

      if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) finishReason = choice.finish_reason
    }

    if (reasoning !== undefined) {
      yield { type: 'block-end', index: reasoning.index, block: { type: 'reasoning', text: reasoning.parts.join('') } }
    }
    if (text !== undefined) {
      yield { type: 'block-end', index: text.index, block: { type: 'text', text: text.parts.join('') } }
    }
    for (const entry of tools.values()) {
      yield { type: 'block-end', index: entry.index, block: { type: 'tool-call', id: entry.id, name: entry.name, arguments: entry.args.join('') } }
    }
    if (usage !== undefined) yield { type: 'usage', usage: usageOf(usage) }

    let kind = 'stop'
    if (tools.size > 0 || finishReason === 'tool_calls') kind = 'tool-calls'
    else if (finishReason === 'length') kind = 'max-tokens'
    yield { type: 'finish', reason: { kind } }
  }
}

function usageOf(raw) {
  const input = raw.prompt_tokens ?? raw.input_tokens ?? 0
  const output = raw.completion_tokens ?? raw.output_tokens ?? 0
  const cacheRead = raw.prompt_cache_hit_tokens ?? raw.cache_read_input_tokens
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: raw.total_tokens ?? input + output,
    ...(Number.isFinite(cacheRead) ? { cacheReadTokens: cacheRead } : {}),
  }
}

function apply(ctx, config = {}) {
  const providers = Array.isArray(config.providers) && config.providers.length > 0 ? config.providers : DEFAULT_PROVIDERS
  const fallbacks = Array.isArray(config.fallbacks) && config.fallbacks.length > 0 ? config.fallbacks : DEFAULT_FALLBACKS
  const modes = Array.isArray(config.modes) ? config.modes : []
  const useMaxContextWindow = config.useMaxContextWindow !== false
  const chains = buildChains(providers, fallbacks, modes, useMaxContextWindow)
  const settings = {
    provider: config.provider || 'aihub',
    displayName: config.displayName || 'AI Hub',
    cooldownMs: config.cooldownMs ?? 60000,
    useMaxContextWindow,
    platforms: DEFAULT_PLATFORMS,
    providers,
    fallbacks,
    modes,
    chains,
  }
  const adapter = new FailoverAdapter(ctx, settings)
  ctx.llm.registerAdapter([settings.provider], adapter)
  registerSelftestTool(ctx, adapter, settings)
  registerStatusTool(ctx, settings, adapter)
  registerConfigApi(ctx, settings)
}

/** One read-only overview: auth, model counts, credits, and the active chain. */
function registerStatusTool(ctx, settings, adapter) {
  // `tools` may be provided by a tool-executor row that activates later, so
  // wait for the service instead of reading it once while the plugin applies.
  ctx.inject(['tools'], (ctx) => {
    const tools = ctx.tools
    tools.register({
    name: 'aihub_status',
    description: 'Report AI Hub platform status: Qoder/Trae/CodeArts authorization, model counts and credits, plus the active failover chain.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          chain: { type: 'array', items: { type: 'string' } },
          qoder: { type: 'object' },
          trae: { type: 'object' },
          codearts: { type: 'object' },
          lastAnswered: { type: 'object' },
        },
        required: ['chain', 'qoder', 'trae', 'codearts', 'lastAnswered'],
        additionalProperties: false,
      },
      render(_args, value) {
        const lines = ['chain: ' + (value.chain || []).join(' → ')]
        const q = value.qoder || {}
        lines.push('Qoder: ' + (q.connected ? `${q.name} · 模型 ${(q.models || []).length} · 额度 ` + ((q.credits?.rows || []).map((row) => `${row.label} ${row.remaining}/${row.total}`).join(' / ') || '-') : '未授权'))
        const t = value.trae || {}
        lines.push('Trae: ' + ((t.accounts || []).map((account) => {
          const credits = account.credits
          if (credits && credits.kind === 'credits') return `${account.edition} ${credits.available}/${credits.total}`
          if (credits && credits.kind === 'subscription') return `${account.edition} 订阅 ${credits.plan || ''}`
          return `${account.edition} 需登录`
        }).join(' · ') || '未找到登录'))
        const c = value.codearts || {}
        lines.push('CodeArts: ' + ((c.accounts || []).map((account) => account.credits ? `${account.userName} ${account.credits.planName} ${account.credits.remain}/${account.credits.total}` : `${account.userName} 额度读取失败`).join(' · ') || '未登录'))
        const last = value.lastAnswered || {}
        const answered = Object.entries(last).filter(([, target]) => typeof target === 'string' && target.length > 0)
        if (answered.length > 0) lines.push('上次应答: ' + answered.map(([mode, target]) => `${mode} 由 ${target}`).join(' · '))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute() {
      const chain = settings.chains.find((entry) => entry.model === 'dev')?.targets ?? []
      const qoder = await qoderSnapshot().catch((error) => ({ connected: false, error: String(error) }))
      const trae = await traeSnapshot().catch((error) => ({ accounts: [], errors: [{ error: String(error) }] }))
      const codearts = await codeartsSnapshot().catch((error) => ({ accounts: [], errors: [{ error: String(error) }] }))
      const lastAnswered = Object.fromEntries(
        settings.chains.map((chain) => [chain.model, adapter.lastTargetOf(chain.model) || '']),
      )
      const result = { chain, qoder, trae, codearts, lastAnswered }
      // Strip undefined keys and non-finite numbers so the tool value is lossless JSON.
      return JSON.parse(JSON.stringify(result))
    },
    })
  })
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

async function readJsonBody(req, limit = 32768) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function qoderStorePath() {
  return join(aiHubHome(), '.aihub', 'qoder.json')
}

function readQoderStore() {
  try {
    const value = JSON.parse(readFileSync(qoderStorePath(), 'utf8'))
    return typeof value?.pat === 'string' && value.pat.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function writeQoderStore(value) {
  const path = qoderStorePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
}

let qoderCache

async function ensureQoderCreds() {
  const saved = readQoderStore()
  if (saved === undefined) return undefined
  if (
    qoderCache === undefined
    || qoderCache.pat !== saved.pat
    || qoderCache.region !== saved.region
    || !(qoderCache.expiresAt > Date.now() + 60000)
  ) {
    const creds = await exchangePat(saved.pat, saved.region, aiHubHome())
    qoderCache = { ...creds, pat: saved.pat, region: saved.region }
  }
  return { creds: qoderCache, region: saved.region }
}

async function qoderSnapshot() {
  const state = await ensureQoderCreds()
  if (state === undefined) return { connected: false }
  try {
    const [models, credits] = await Promise.all([
      qoderModels(state.creds, state.region),
      qoderCredits(state.creds, state.region),
    ])
    return { connected: true, name: state.creds.name, userId: state.creds.userId, region: state.region, models, credits }
  } catch (error) {
    return { connected: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Resolve the CodeArts account to use right now.
 *
 * The official CodeArts Agent client renews its Huawei Cloud session in the
 * background, so whenever it holds a valid session for the same account that
 * one wins: it is the only copy that survives an expired refresh token.
 */
function resolveCodeArtsAccount(account) {
  const official = importOfficialCodeArtsSession()
  if (official === undefined || official.id !== account.id) return account
  if (!isFutureTimestamp(official.expiration)) return account
  if (isFutureTimestamp(account.expiration) && official.expiration <= account.expiration) return account
  const merged = { ...account, ...official }
  try {
    persistCodeArtsAccount(merged)
  } catch {
    // A read-only store must not break the caller.
  }
  return merged
}

async function codeartsSnapshot() {
  const { accounts, errors } = readCodeArtsAccounts()
  const rows = []
  let models = []
  for (const account of accounts) {
    const active = resolveCodeArtsAccount(account)
    const base = {
      id: active.id,
      userName: active.userName,
      expiresAt: active.expiration,
    }
    try {
      rows.push({ ...base, credits: await fetchCodeArtsCredits(active) })
      if (models.length === 0) models = await fetchCodeArtsModels(active)
    } catch (error) {
      rows.push({
        ...base,
        stale: !isFutureTimestamp(active.expiration),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { accounts: rows, models, errors }
}

/** True when `value` is an ISO timestamp in the future. */
function isFutureTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const at = Date.parse(value)
  return Number.isFinite(at) && at > Date.now()
}

async function traeSnapshot() {
  const { accounts, errors } = readTraeAuth()
  const rows = []
  let roster
  for (const account of accounts) {
    const base = {
      edition: account.edition,
      region: account.region,
      name: account.name,
      userId: account.userId,
      expiresAt: account.expiresAt ? new Date(account.expiresAt).toISOString() : undefined,
    }
    try {
      rows.push({ ...base, credits: await fetchTraeCredits(account) })
    } catch (error) {
      rows.push({ ...base, error: error instanceof Error ? error.message : String(error) })
    }
    if (roster === undefined && account.edition === 'cn') {
      roster = await readTraeCachedRoster(account)
    }
  }
  return { accounts: rows, roster, errors }
}

/** JSON endpoints the settings card reads and writes; no user-facing page. */
function registerConfigApi(ctx, settings) {
  // The web server row activates separately; wait for the service so the
  // settings card never loads against a host that has no routes yet.
  ctx.inject(['webServer'], (ctx) => {
    const server = ctx.webServer
    ctx.effect(() => {
    const state = server.register({
      kind: 'exact',
      path: '/aihub/api/state',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const providers = []
          for (const entry of settings.providers) {
            let models = []
            try {
              if (entry.id === 'qoder') {
                const state = await ensureQoderCreds()
                if (state !== undefined) {
                  models = (await qoderModels(state.creds, state.region)).map((model) => ({ id: model.id, name: model.name, priceFactor: model.priceFactor, contextWindow: model.contextWindow, defaultContextWindow: model.defaultContextWindow, maxContextWindow: model.maxContextWindow }))
                }
              } else if (entry.id === 'trae') {
                const { accounts } = readTraeAuth()
                const account = accounts.find((candidate) => candidate.edition === 'cn') ?? accounts[0]
                if (account !== undefined) {
                  models = (await fetchTraeModels(account)).map((model) => ({ id: model.id, name: model.name, priceFactor: model.priceFactor, contextWindow: model.contextWindow, defaultContextWindow: model.defaultContextWindow, maxContextWindow: model.maxContextWindow }))
                }
              } else if (entry.id === 'codearts') {
                const { accounts } = readCodeArtsAccounts()
                if (accounts.length > 0) {
                  models = await fetchCodeArtsModels(accounts[0])
                }
              }
              if (models.length === 0) {
                models = (await ctx.llm.listModels(entry.id)).map((model) => ({ id: model.id, name: model.name || model.id }))
              }
            } catch (error) {
              ctx.logger?.warn?.(`llm-aihub: cannot list models of "${entry.id}": ${error instanceof Error ? error.message : error}`)
            }
            providers.push({
              id: entry.id,
              label: entry.label || entry.id,
              model: entry.model || '',
              contextWindow: 0,
              defaultContextWindow: Number(entry.defaultContextWindow) || 0,
              maxContextWindow: Number(entry.maxContextWindow) || 0,
              maxTokens: 0,
              models,
            })
          }
          sendJson(res, 200, { providers, fallbacks: settings.fallbacks, chains: settings.chains, useMaxContextWindow: settings.useMaxContextWindow })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const config = server.register({
      kind: 'exact',
      path: '/aihub/api/config',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const body = await readJsonBody(req)
          const incoming = Array.isArray(body.providers) ? body.providers : []
          const known = new Map([...DEFAULT_PROVIDERS, ...settings.providers].map((entry) => [entry.id, entry]))
          if (incoming.length !== settings.providers.length) throw new Error('platform count changed')
          const next = incoming.map((item) => {
            const base = known.get(String(item?.id ?? ''))
            if (base === undefined) throw new Error(`unknown platform "${item?.id}"`)
            return {
              ...base,
              model: typeof item.model === 'string' ? item.model : base.model,
              // Windows are declared by upstream; never accept a hand-typed number.
              contextWindow: 0,
              defaultContextWindow: Number(item.defaultContextWindow) > 0
                ? Number(item.defaultContextWindow)
                : (Number(base.defaultContextWindow) || 0),
              maxContextWindow: Number(item.maxContextWindow) > 0
                ? Number(item.maxContextWindow)
                : (Number(base.maxContextWindow) || 0),
              maxTokens: 0,
            }
          })
          const nextModes = Array.isArray(body.modes)
            ? body.modes.map((mode) => {
              if (typeof mode?.model !== 'string' || mode.model.length === 0) throw new Error('mode name is required')
              return {
                model: mode.model,
                label: typeof mode.label === 'string' ? mode.label : mode.model,
                contextWindow: Number(mode.contextWindow) > 0 ? Number(mode.contextWindow) : 200000,
                maxTokens: Number(mode.maxTokens) > 0 ? Number(mode.maxTokens) : 32000,
                pinned: mode.pinned === true,
                targets: Array.isArray(mode.targets)
                  ? mode.targets.filter((target) => typeof target === 'string' && target.length > 0)
                  : [],
              }
            })
            : undefined
          const entry = ctx.fiber?.entry
          const editor = ctx.get('configEditor')
          if (entry === undefined || editor === undefined) throw new Error('configEditor is unavailable in this profile')
          await editor.edit(entry, (current) => ({
            ...current,
            providers: next,
            ...(nextModes === undefined ? {} : { modes: nextModes }),
            ...(typeof body.useMaxContextWindow === 'boolean' ? { useMaxContextWindow: body.useMaxContextWindow } : {}),
          }))
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const qoderState = server.register({
      kind: 'exact',
      path: '/aihub/qoder/state',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        sendJson(res, 200, await qoderSnapshot())
      },
    })

    const qoderConnect = server.register({
      kind: 'exact',
      path: '/aihub/qoder/connect',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const body = await readJsonBody(req)
          const pat = typeof body.pat === 'string' ? body.pat.trim() : ''
          const region = body.region === 'global' ? 'global' : 'china'
          if (pat.length < 16) throw new Error('PAT 看起来不完整')
          const creds = await exchangePat(pat, region, aiHubHome())
          const [models, credits] = await Promise.all([
            qoderModels(creds, region),
            qoderCredits(creds, region),
          ])
          writeQoderStore({ pat, region, savedAt: new Date().toISOString() })
          qoderCache = { ...creds, pat, region }
          sendJson(res, 200, { connected: true, name: creds.name, userId: creds.userId, region, models, credits })
        } catch (error) {
          sendJson(res, 400, { connected: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const qoderDisconnect = server.register({
      kind: 'exact',
      path: '/aihub/qoder/disconnect',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        writeFileSync(qoderStorePath(), '{}', { mode: 0o600 })
        qoderCache = undefined
        sendJson(res, 200, { connected: false })
      },
    })

    const qoderCheckin = server.register({
      kind: 'exact',
      path: '/aihub/qoder/checkin',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const state = await ensureQoderCreds()
          if (state === undefined) return sendJson(res, 200, { available: false, status: 'unauthorized' })
          if (req.method === 'GET') return sendJson(res, 200, await qoderCheckinStatus(state.creds, state.region))
          sendJson(res, 200, await qoderCheckinClaim(state.creds, state.region))
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const traeCheckin = server.register({
      kind: 'exact',
      path: '/aihub/trae/checkin',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          const { accounts } = readTraeAuth()
          const account = accounts.find((candidate) => candidate.edition === 'cn')
          if (account === undefined) return sendJson(res, 200, { available: false, status: 'unauthorized' })
          if (req.method === 'GET') return sendJson(res, 200, { available: true, ...(await traeCheckinStatus(account)) })
          sendJson(res, 200, { available: true, ...(await traeCheckinClaim(account)) })
        } catch (error) {
          sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const codeartsCheckin = server.register({
      kind: 'exact',
      path: '/aihub/codearts/checkin',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        const { accounts } = readCodeArtsAccounts()
        const account = accounts[0]
        if (account === undefined) return sendJson(res, 200, { available: false, status: 'unauthorized' })
        const run = (target) => (req.method === 'GET' ? codeartsCheckinStatus(target) : codeartsCheckinClaim(target))
        try {
          sendJson(res, 200, { available: true, ...(await run(account)) })
        } catch (error) {
          if (error?.status === 401) {
            try {
              const fresh = await refreshCodeArtsAccount(account)
              persistCodeArtsAccount(fresh)
              return sendJson(res, 200, { available: true, ...(await run(fresh)) })
            } catch (refreshError) {
              return sendJson(res, 400, { error: refreshError instanceof Error ? refreshError.message : String(refreshError) })
            }
          }
          sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const traeState = server.register({
      kind: 'exact',
      path: '/aihub/trae/state',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          sendJson(res, 200, await traeSnapshot())
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const codeartsState = server.register({
      kind: 'exact',
      path: '/aihub/codearts/state',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        try {
          sendJson(res, 200, await codeartsSnapshot())
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const codeartsRelogin = server.register({
      kind: 'exact',
      path: '/aihub/codearts/relogin',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        const { accounts } = readCodeArtsAccounts()
        const account = accounts[0]
        if (account === undefined) return sendJson(res, 200, { available: false, status: 'unauthorized' })
        const errors = []
        // 1) The official client's store is authoritative when it holds a live
        //    session: it renews in the background, so this revives a dead
        //    refresh_token without asking for Huawei's OAuth device flow.
        let official
        try {
          official = importOfficialCodeArtsSession()
        } catch (error) {
          errors.push('读取官方客户端会话失败：' + (error instanceof Error ? error.message : String(error)))
        }
        if (official !== undefined) {
          if (official.id !== account.id) {
            errors.push('官方客户端登录的是另一个账号（' + (official.userName || official.id) + '），未导入')
          } else {
            try {
              const credits = await fetchCodeArtsCredits(official)
              try {
                persistCodeArtsAccount({ ...account, ...official })
              } catch {
                // Import still succeeds in memory if the store is read-only.
              }
              return sendJson(res, 200, { available: true, status: 'imported', source: 'official-client', credits })
            } catch (error) {
              errors.push('官方客户端会话已失效：' + (error instanceof Error ? error.message : String(error)))
            }
          }
        } else if (errors.length === 0) {
          errors.push('未找到 CodeArts Agent 客户端会话')
        }
        // 2) Otherwise rotate with the stored refresh_token.
        try {
          const fresh = await refreshCodeArtsAccount(account)
          persistCodeArtsAccount(fresh)
          const credits = await fetchCodeArtsCredits(fresh)
          return sendJson(res, 200, { available: true, status: 'refreshed', source: 'refresh-token', credits })
        } catch (error) {
          errors.push('刷新令牌失败：' + (error instanceof Error ? error.message : String(error)))
        }
        sendJson(res, 400, {
          available: true,
          status: 'failed',
          error: errors.join('；'),
          hint: '打开 CodeArts Agent 客户端并完成华为云登录后回来点「重新登录」；或点「华为云登录」直接在浏览器里重新授权。',
          canInteractiveLogin: true,
        })
      },
    })

    // Interactive login: hand the user a Huawei authorization URL instead of
    // sending them to the CodeArts client. The heavyweight OAuth exchange
    // (PKCE + DPoP + loopback callback) already exists in the dsh-codearts
    // plugin on this profile, and it writes the same
    // `~/.dsh/.codearts-accounts.json` we read, so delegate to it rather than
    // reimplementing an endpoint that only ever sees one account.
    const codeartsLogin = server.register({
      kind: 'exact',
      path: '/aihub/codearts/login',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        const { accounts } = readCodeArtsAccounts()
        const account = accounts[0]
        const origin = server.getOrigin?.() ?? 'http://127.0.0.1'
        const base = String(origin).replace(/\/$/, '')
        const query = account === undefined ? '' : `?account=${encodeURIComponent(account.id)}`
        let upstream
        try {
          upstream = await fetch(`${base}/api/codearts/login${query}`, { method: 'POST' })
        } catch (error) {
          return sendJson(res, 503, {
            status: 'unavailable',
            error: '本机没有可用的 CodeArts 登录服务：' + (error instanceof Error ? error.message : String(error)),
            hint: '安装 dsh-codearts 插件后即可在浏览器里直接重新登录。',
          })
        }
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '')
          return sendJson(res, 502, {
            status: 'unavailable',
            error: `CodeArts 登录服务返回 HTTP ${upstream.status} ${detail.slice(0, 200)}`,
          })
        }
        const payload = await upstream.json().catch(() => ({}))
        if (typeof payload.url !== 'string') {
          return sendJson(res, 502, { status: 'unavailable', error: '登录服务没有返回授权地址' })
        }
        sendJson(res, 200, { status: 'started', url: payload.url, port: payload.port })
      },
    })

    const codeartsLoginStatus = server.register({
      kind: 'exact',
      path: '/aihub/codearts/login/status',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        const url = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('url') ?? ''
        if (url === '') return sendJson(res, 400, { error: 'url is required' })
        const origin = server.getOrigin?.() ?? 'http://127.0.0.1'
        let upstream
        try {
          upstream = await fetch(`${String(origin).replace(/\/$/, '')}/api/codearts/login/status?url=${encodeURIComponent(url)}`)
        } catch (error) {
          return sendJson(res, 503, { status: 'unavailable', error: error instanceof Error ? error.message : String(error) })
        }
        const payload = await upstream.json().catch(() => ({}))
        // The delegate already settled credentials into the shared account
        // file; re-read so the card can show the refreshed quota immediately.
        if (payload.status === 'done') {
          try {
            const { accounts } = readCodeArtsAccounts()
            const fresh = accounts[0]
            if (fresh !== undefined) payload.credits = await fetchCodeArtsCredits(resolveCodeArtsAccount(fresh))
          } catch {
            // Quota display is best-effort; the login itself already succeeded.
          }
        }
        sendJson(res, 200, payload)
      },
    })

    return () => {
      state()
      config()
      qoderState()
      qoderConnect()
      qoderDisconnect()
      traeState()
      codeartsState()
      codeartsRelogin()
      codeartsLogin()
      codeartsLoginStatus()
      qoderCheckin()
      traeCheckin()
      codeartsCheckin()
    }
  }, 'llm-aihub: configuration API')
  })
}

/** Model-free diagnostic: run one chain and report which target actually answered. */
function registerSelftestTool(ctx, adapter, settings) {
  ctx.inject(['tools'], (ctx) => {
    const tools = ctx.tools

    tools.register({
    name: 'aihub_selftest',
    description: 'Call one AI Hub chain end-to-end and report which platform answered. Use model "selftest" (offline mock) to verify failover without spending quota.',
    parameters: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Chain name: selftest, dev or dev-fast. Defaults to selftest.' },
        prompt: { type: 'string', description: 'Prompt to send. Defaults to a one-word reply request.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          target: { type: 'string' },
          ok: { type: 'boolean' },
          text: { type: 'string' },
          failure: { type: 'string' },
          ms: { type: 'number' },
        },
        required: ['model', 'target', 'ok', 'text', 'failure', 'ms'],
        additionalProperties: false,
      },
      render(_args, value) {
        const head = value.ok
          ? `aihub ${value.model} · ${value.target} · ${value.ms}ms`
          : `aihub ${value.model} · all targets failed · ${value.ms}ms`
        return [{ type: 'text', text: value.ok ? `${head}\n${value.text}` : `${head}\n${value.failure}` }]
      },
    },
    async execute(args, exec) {
      const model = typeof args?.model === 'string' ? args.model : 'selftest'
      const prompt = typeof args?.prompt === 'string' ? args.prompt : '只回复两个字：收到'
      const started = Date.now()
      const text = []
      let failure
      for await (const chunk of adapter.stream({
        provider: settings.provider,
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        signal: exec?.signal,
      })) {
        if (chunk.type === 'text-delta') text.push(chunk.text)
        if (chunk.type === 'finish' && chunk.reason.kind !== 'stop') failure = chunk.reason.failure
      }
      return {
        model,
        target: adapter.lastTargetOf(model) ?? '',
        ok: failure === undefined,
        text: text.join(''),
        failure: failure?.message ?? '',
        ms: Date.now() - started,
      }
    },
    })
  })
}

const inject = ['llm']

export { apply, inject, name }
