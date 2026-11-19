import { createDecipheriv, createHash, createHmac, createPrivateKey, createSign, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Self-implemented CodeArts client.
 *
 * Credentials live in the local account store written by the desktop flow
 * (STS token + temporary AK/SK). Chat is OpenAI-compatible at
 * `snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions` and must
 * carry a Huawei SDK-HMAC-SHA256 signature beside `x-auth-token`.
 */

const HOST = 'https://snap-access.cn-north-4.myhuaweicloud.com'
const CHAT_PATH = '/api/v2/chat/completions'
const ALGO = 'SDK-HMAC-SHA256'

function hubHome() {
  return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
}

/** The local CodeArts account store, if this machine has signed in once. */
export function readCodeArtsAccounts() {
  const path = join(hubHome(), '.codearts-accounts.json')
  if (!existsSync(path)) return { accounts: [], errors: [{ path, error: 'not found' }] }
  try {
    const document = JSON.parse(readFileSync(path, 'utf8'))
    const accounts = Object.entries(document.accounts ?? {}).map(([id, value]) => ({
      id,
      token: String(value.token ?? ''),
      accessKeyId: String(value.accessKeyId ?? ''),
      secretAccessKey: String(value.secretAccessKey ?? ''),
      refreshToken: String(value.refreshToken ?? ''),
      dpopPrivateKey: value.dpopPrivateKey,
      clientId: String(value.clientId ?? ''),
      expiration: typeof value.expiration === 'string' ? value.expiration : undefined,
      userId: String(value.userId ?? ''),
      userName: String(value.userName ?? ''),
    })).filter((account) => account.token.length > 0 && account.accessKeyId.length > 0)
    return { accounts, errors: [] }
  } catch (error) {
    return { accounts: [], errors: [{ path, error: error instanceof Error ? error.message : String(error) }] }
  }
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hmacHex(key, message) {
  return createHmac('sha256', key).update(message).digest('hex')
}

function sdkDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

function canonicalUri(path) {
  let out = path.split('/').map(encodeURIComponent).join('/')
  if (!out.endsWith('/')) out += '/'
  return out
}

function canonicalQuery(raw) {
  if (!raw) return ''
  const params = new URLSearchParams(raw)
  return [...new Set(params.keys())].sort()
    .flatMap((key) => params.getAll(key).sort().map((value) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`))
    .join('&')
}

/** Huawei AK/SK signature headers for one request. */
function sign(url, body, account, headers, method = 'POST') {
  const parsed = new URL(url)
  const date = sdkDate(new Date())
  const payloadHash = sha256Hex(body)
  const merged = {
    ...headers,
    'X-Sdk-Date': date,
    'X-Sdk-Content-Sha256': payloadHash,
    'X-Security-Token': account.token,
  }
  const rows = [...Object.entries(merged).map(([key, value]) => [key.toLowerCase(), String(value).trim()]), ['host', parsed.host]]
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
  const canonicalHeaders = rows.map(([key, value]) => `${key}:${value}\n`).join('')
  const signedHeaders = rows.map(([key]) => key).join(';')
  const canonicalRequest = [
    method,
    canonicalUri(parsed.pathname),
    canonicalQuery(parsed.search.slice(1)),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const stringToSign = [ALGO, date, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmacHex(account.secretAccessKey, stringToSign)
  return {
    ...headers,
    'X-Sdk-Date': date,
    'X-Sdk-Content-Sha256': payloadHash,
    'X-Security-Token': account.token,
    Authorization: `${ALGO} Access=${account.accessKeyId}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

function textOf(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content.filter((block) => block?.type === 'text').map((block) => block.text).join('')
}

function openAIMessages(options) {
  const messages = []
  if (typeof options.system === 'string' && options.system.length > 0) messages.push({ role: 'system', content: options.system })
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
        entry.tool_calls = calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }))
      }
      messages.push(entry)
      continue
    }
    if (message.role === 'tool') {
      messages.push({ role: 'tool', tool_call_id: String(message.source?.callId ?? message.toolCallId ?? ''), content: textOf(message.content) })
    }
  }
  return messages
}

/** Stream one CodeArts chat turn as harness chunks. */
export async function* chatCodeArts(account, modelId, options, signal) {
  const tools = Array.isArray(options.tools) && options.tools.length > 0
    ? options.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
    : undefined
  const body = JSON.stringify({
    model: modelId,
    messages: openAIMessages(options),
    stream: true,
    ...(Number.isFinite(options.maxTokens) ? { max_tokens: options.maxTokens } : {}),
    ...(tools === undefined ? {} : { tools }),
  })
  const url = `${HOST}${CHAT_PATH}`
  const headers = sign(url, body, account, {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'x-auth-token': account.token,
  })

  const response = await fetch(url, { method: 'POST', headers, body, signal })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const code = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : `HTTP_${response.status}`
    throw Object.assign(new Error(`codearts chat: HTTP ${response.status} ${detail.slice(0, 300)}`), { code, status: response.status })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let nextIndex = 0
  let textBlock
  let reasoningBlock
  const tools_ = new Map()
  let usage
  let finishReason

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
        let payload
        try { payload = JSON.parse(raw) } catch { continue }
        if (payload.error_code !== undefined) throw new Error(`codearts upstream ${payload.error_code}: ${payload.error_msg ?? ''}`)
        if (payload.usage !== undefined) usage = payload.usage
        for (const choice of payload.choices ?? []) {
          if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) finishReason = choice.finish_reason
          const delta = choice.delta ?? {}
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
            let call = tools_.get(key)
            if (call === undefined) {
              call = { index: nextIndex++, id: rawCall.id ?? `call_${key}_${tools_.size}`, name: '', args: '' }
              tools_.set(key, call)
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

  if (reasoningBlock !== undefined) yield { type: 'block-end', index: reasoningBlock.index, block: { type: 'reasoning', text: reasoningBlock.text } }
  if (textBlock !== undefined) yield { type: 'block-end', index: textBlock.index, block: { type: 'text', text: textBlock.text } }
  for (const call of tools_.values()) {
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
  if (tools_.size > 0 || finishReason === 'tool_calls') kind = 'tool-calls'
  else if (finishReason === 'length') kind = 'max-tokens'
  yield { type: 'finish', reason: { kind } }
}

/** Built-in model roster (`Agent-Type: PromptCenter` is required). */
export async function fetchCodeArtsModels(account, signal) {
  const url = `${HOST}/v1/model/builtin`
  const headers = sign(url, '', account, { accept: 'application/json', 'Agent-Type': 'PromptCenter' }, 'GET')
  const response = await fetch(url, { method: 'GET', headers, signal })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`codearts models: HTTP ${response.status} ${detail.slice(0, 200)}`)
  }
  const body = await response.json()
  return (body.builtinModels ?? [])
    .filter((entry) => entry?.enable !== false)
    .map((entry) => {
      const credit = Array.isArray(entry.credit) ? entry.credit[0] : undefined
      const ratio = Number(credit?.ratio ?? NaN)
      const window = Number(entry.context_window ?? 0) || undefined
      return {
        id: String(entry.model_id ?? ''),
        name: String(entry.model_name ?? entry.model_id ?? ''),
        contextWindow: window,
        defaultContextWindow: window,
        maxContextWindow: window,
        priceFactor: Number.isFinite(ratio) ? ratio : undefined,
      }
    })
    .filter((entry) => entry.id.length > 0)
}

/** Package credits from the signed statistics endpoint. */
export async function fetchCodeArtsCredits(account, signal) {
  const url = `${HOST}/snap-manager/v1/statistics/plugin`
  const headers = sign(url, '', account, { accept: 'application/json' }, 'GET')
  const response = await fetch(url, { method: 'GET', headers, signal })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`codearts credits: HTTP ${response.status} ${detail.slice(0, 200)}`)
  }
  const body = await response.json()
  const metrics = Array.isArray(body.metrics) ? body.metrics : []
  const metric = metrics.find((entry) => entry?.name === 'usageTotalPackageCredit')
  if (metric === undefined) throw new Error('codearts credits: no usageTotalPackageCredit metric')
  const pack = body.package ?? {}
  return {
    planName: String(pack.package_name_cn ?? pack.package_name_en ?? ''),
    total: Number(metric.package_credit_amount ?? 0),
    used: Number(metric.package_credit_used ?? 0),
    remain: Number(metric.package_credit_remain ?? 0),
    expiring: Number(metric.package_credit_expiring_amount ?? 0),
    periodStart: typeof body.start_date === 'string' ? body.start_date : undefined,
    periodEnd: typeof body.end_date === 'string' ? body.end_date : undefined,
  }
}

const STS_TOKEN_URL = 'https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens'
const DPOP_CLIENT_ID = 'codearts-agent'
const DPOP_PLUGIN = 'snap_AIIDE'
const DPOP_VERSION = '5.2.0'
const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551')
const P256_HALF = P256_ORDER >> 1n

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

/** RFC 9449 DPoP proof: ES256 over header/payload, low-S normalised. */
function signDpopProof(jwk) {
  const key = createPrivateKey({ key: jwk, format: 'jwk' })
  const header = {
    alg: 'ES256',
    typ: 'dpop+jwt',
    jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
  }
  const payload = {
    htm: 'POST',
    htu: STS_TOKEN_URL,
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString('hex'),
  }
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = createSign('SHA256').update(input).sign({ key, dsaEncoding: 'ieee-p1363' })
  const s = signature.subarray(32, 64)
  let value = BigInt(`0x${s.toString('hex')}`)
  if (value > P256_HALF) {
    value = P256_ORDER - value
    s.write(value.toString(16).padStart(64, '0'), 'hex')
  }
  return `${input}.${base64url(Buffer.concat([signature.subarray(0, 32), s]))}`
}

function accountsPath() {
  return join(hubHome(), '.codearts-accounts.json')
}

/**
 * Refresh the OAuth credentials with the stored refresh_token + DPoP key.
 * Huawei rotates the refresh token, so the caller must persist the result or
 * the next refresh (and the official client) would be locked out.
 */
export async function refreshCodeArtsAccount(account, signal) {
  if (typeof account.refreshToken !== 'string' || account.refreshToken.length === 0) {
    throw new Error('账号缺少 refresh_token，需要在 CodeArts Agent 客户端重新登录')
  }
  if (account.dpopPrivateKey === undefined || account.dpopPrivateKey === null) {
    // Without the DPoP key the token endpoint cannot be called at all, so say
    // that plainly instead of surfacing a cryptography type error.
    throw new Error('账号缺少 DPoP 私钥，无法刷新令牌，需要在 CodeArts Agent 客户端重新登录')
  }
  const dpop = signDpopProof(account.dpopPrivateKey)
  const body = new URLSearchParams({
    client_id: account.clientId || DPOP_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
  }).toString()
  const response = await fetch(STS_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      DPoP: dpop,
      'plugin-name': DPOP_PLUGIN,
      'plugin-version': DPOP_VERSION,
    },
    body,
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    // Huawei rotates the refresh token on every use, so a previously used value
    // is permanently dead: name that case instead of echoing raw STS JSON.
    if (detail.includes('STS5.1806') || detail.includes('has been used')) {
      throw new Error('refresh_token 已被使用过（华为每次刷新都会轮换），需要在 CodeArts Agent 客户端重新登录')
    }
    throw new Error(`CodeArts 刷新失败：HTTP ${response.status} ${detail.slice(0, 200)}`)
  }
  const json = await response.json()
  const cred = json.credentials ?? {}
  return {
    ...account,
    token: cred.security_token ?? cred.SecurityToken ?? '',
    accessKeyId: cred.access_key_id ?? cred.AccessKeyID ?? account.accessKeyId,
    secretAccessKey: cred.secret_access_key ?? cred.SecretAccessKey ?? account.secretAccessKey,
    expiration: cred.expiration ?? cred.Expiration ?? account.expiration,
    refreshToken: json.refresh_token ?? json.RefreshToken ?? account.refreshToken,
    userId: json.user_id ?? account.userId,
    userName: json.user_name ?? account.userName,
  }
}

/** Write rotated credentials back atomically, keeping a one-time backup. */
export function persistCodeArtsAccount(account) {
  const path = accountsPath()
  if (!existsSync(path)) return
  const document = JSON.parse(readFileSync(path, 'utf8'))
  const accounts = document.accounts ?? {}
  const current = accounts[account.id]
  if (current === undefined) return
  accounts[account.id] = {
    ...current,
    token: account.token,
    accessKeyId: account.accessKeyId,
    secretAccessKey: account.secretAccessKey,
    refreshToken: account.refreshToken,
    expiration: account.expiration,
    storedAt: Date.now(),
  }
  const backup = `${path}.aihub-backup`
  if (!existsSync(backup)) copyFileSync(path, backup)
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, JSON.stringify(document, null, 2), { mode: 0o600 })
  renameSync(temporary, path)
}

/**
 * The official CodeArts Agent client keeps its Huawei Cloud session in
 * `globalStorage/state.vscdb`, encrypted with Electron safeStorage (a
 * DPAPI-wrapped AES-256-GCM key on Windows). The session there is kept fresh
 * by that client, so importing it is the practical "log in again" path: log in
 * (or let the client renew) once, then click "重新登录" to pull the new token.
 *
 * Returns undefined when the client is absent or its store is unreadable, so
 * callers fall back to the on-disk account file.
 */
export function importOfficialCodeArtsSession() {
  const base = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'codearts-agent')
  const localStatePath = join(base, 'Local State')
  const databasePath = join(base, 'User', 'globalStorage', 'state.vscdb')
  if (!existsSync(localStatePath) || !existsSync(databasePath)) return undefined

  const payload = readSafeStorageSecret(localStatePath, databasePath, 'HuaweiCloudSession')
  if (payload === undefined) return undefined
  const session = payload
  const credentials = {
    token: String(session.securitytoken ?? ''),
    accessKeyId: String(session.accessKey ?? ''),
    secretAccessKey: String(session.secretKey ?? ''),
  }
  if (credentials.token.length === 0 || credentials.accessKeyId.length === 0) return undefined
  const loginContext = session.loginContext ?? {}
  return {
    id: String(session.account?.id ?? ''),
    userName: String(session.account?.label ?? ''),
    ...credentials,
    refreshToken: String(session.refresh_token ?? ''),
    dpopPrivateKey: loginContext.dpopKeyPair?.privateKeyJwk,
    clientId: 'codearts-agent',
    expiration: typeof session.expires_at === 'string' ? session.expires_at : undefined,
    userId: String(session.account?.id ?? ''),
  }
}

/**
 * Decrypt one safeStorage-backed secret out of an Electron `state.vscdb`.
 *
 * On Windows the raw key in `Local State` is DPAPI-protected under the current
 * user, so this shells out to PowerShell for `ProtectedData.Unprotect`; on
 * Linux/macOS safeStorage uses a keyring the plugin cannot reach, so only the
 * plaintext and `basic_text` variants are handled.
 */
/**
 * Decrypt one safeStorage-backed secret out of an Electron `state.vscdb`.
 *
 * AES-256-GCM authenticates, so a wrong candidate simply fails to decrypt: the
 * store layer can return every plausible blob and this picks the real one.
 *
 * On Windows the raw key in `Local State` is DPAPI-protected under the current
 * user, so this shells out to PowerShell for `ProtectedData.Unprotect`; on
 * Linux/macOS safeStorage uses a keyring the plugin cannot reach, so only the
 * plaintext and `basic_text` variants are handled.
 */
function readSafeStorageSecret(localStatePath, databasePath, key) {
  let localState
  try {
    localState = JSON.parse(readFileSync(localStatePath, 'utf8'))
  } catch {
    return undefined
  }
  let aesKey
  try {
    aesKey = unwrapSafeStorageKey(localState.os_crypt?.encrypted_key)
  } catch {
    return undefined
  }
  if (aesKey === undefined) return undefined

  const identifier = `secret://{"extensionId":"huaweicloud.authentication","key":"${key}"}`
  for (const value of readValuesFromDatabase(databasePath, identifier)) {
    const parsed = decodeSecret(value, aesKey)
    if (parsed !== undefined) return parsed
  }
  return undefined
}

/** Try one stored value; undefined when it is not a decryptable session. */
function decodeSecret(value, aesKey) {
  let stored
  try {
    stored = JSON.parse(value)
  } catch {
    return undefined
  }
  if (stored?.type !== 'Buffer' || !Array.isArray(stored.data)) return undefined
  const blob = Buffer.from(stored.data)
  if (blob.length < 32) return undefined
  // Electron prefixes safeStorage blobs with a 3-byte version marker ("v10"/"v11").
  const nonce = blob.subarray(3, 15)
  const tag = blob.subarray(blob.length - 16)
  let plain
  try {
    const decipher = createDecipheriv('aes-256-gcm', aesKey, nonce)
    decipher.setAuthTag(tag)
    plain = Buffer.concat([decipher.update(blob.subarray(15, blob.length - 16)), decipher.final()])
  } catch {
    return undefined
  }
  let session
  try {
    session = JSON.parse(plain.toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof session?.securitytoken !== 'string' || session.securitytoken.length === 0) return undefined
  return session
}

function unwrapSafeStorageKey(encryptedKey) {
  if (typeof encryptedKey !== 'string' || encryptedKey.length === 0) return undefined
  const raw = Buffer.from(encryptedKey, 'base64')
  if (process.platform !== 'win32') return raw.length === 32 ? raw : undefined
  if (raw.subarray(0, 5).toString() !== 'DPAPI') return undefined
  const script = [
    'Add-Type -AssemblyName System.Security',
    `$b=[Convert]::FromBase64String('${raw.subarray(5).toString('base64')}')`,
    '[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,\'CurrentUser\'))',
  ].join(';')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const key = Buffer.from(result.stdout.trim(), 'base64')
  return key.length === 32 ? key : undefined
}

/**
 * Read one `ItemTable` row out of the client's SQLite store.
 *
 * `state.vscdb` is ordinary SQLite and DSH's runtime ships `node:sqlite`, so no
 * driver dependency is needed. Large values land on overflow pages, which rules
 * out a byte-scan fallback: if the built-in module is missing we report nothing
 * rather than guess, and the caller falls back to the refresh token.
 */
function readValuesFromDatabase(databasePath, key) {
  let DatabaseSync
  try {
    DatabaseSync = process.getBuiltinModule?.('node:sqlite')?.DatabaseSync
  } catch {
    return []
  }
  if (typeof DatabaseSync !== 'function') return []
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const row = database.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key)
      return row === undefined ? [] : [Buffer.from(String(row.value)).toString('utf8')]
    } finally {
      database.close()
    }
  } catch {
    return []
  }
}

const WELFARE_ALREADY = new Set(['CLAIMED', 'CONFIRMED', 'CONSUMED'])

function welfareHeaders(account) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'X-Language': 'zh-cn',
    'x-snap-traceid': randomBytes(16).toString('hex'),
    'x-auth-token': account.token,
    'Agent-Type': 'PromptCenter',
  }
}

async function welfareJson(url, method, account, body, signal) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const headers = sign(url, payload, account, welfareHeaders(account), method)
  const response = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: payload }),
    signal,
  })
  const text = await response.text()
  if (!response.ok) throw Object.assign(new Error(`CodeArts 福利接口 HTTP ${response.status} ${text.slice(0, 200)}`), { status: response.status })
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/** Daily check-in campaign from the welfare delivery list. */
export async function codeartsCheckinStatus(account, signal) {
  const url = `${HOST}/v1/ops/delivery?channel=IDE`
  const body = await welfareJson(url, 'GET', account, undefined, signal)
  const items = Array.isArray(body?.data?.items) ? body.data.items : []
  const campaign = items.find((item) => item?.type === 'USER_LOGIN' && item?.benefitUnit === 'CREDIT')
  if (campaign === undefined) return { available: false, status: 'no-campaign' }
  const claimed = !campaign.claimable && WELFARE_ALREADY.has(String(campaign.status ?? ''))
  return {
    available: true,
    campaignId: Number(campaign.campaignId) || 0,
    title: String(campaign.title ?? ''),
    amount: Number(campaign.benefitAmount ?? 0) || 0,
    claimable: campaign.claimable === true,
    claimed,
    status: claimed ? 'already-claimed' : campaign.claimable === true ? 'claimable' : String(campaign.status ?? 'unavailable'),
  }
}

/** Claim the daily campaign; business failures arrive as HTTP 200 with a code. */
export async function codeartsCheckinClaim(account, signal) {
  const status = await codeartsCheckinStatus(account, signal)
  if (!status.available) return { status: 'no-campaign', claimed: false }
  if (status.claimed) return { status: 'already-claimed', claimed: true, amount: status.amount }
  if (status.claimable !== true) return { status: 'unavailable', claimed: false, message: status.status }
  const body = await welfareJson(`${HOST}/v1/ops/claim`, 'POST', account, {
    campaignId: status.campaignId,
    idempotentKey: randomBytes(16).toString('hex'),
    channel: 'IDE',
  }, signal)
  const code = Number(body.code ?? -1)
  if (code === 0) return { status: 'claimed', claimed: true, amount: status.amount }
  if (code === 40001) return { status: 'already-claimed', claimed: true, amount: 0 }
  return { status: 'failed', claimed: false, code, message: String(body.message ?? '').slice(0, 200) }
}