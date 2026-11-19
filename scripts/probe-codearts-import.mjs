import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createDecipheriv } from 'node:crypto'
import { fetchCodeArtsCredits, fetchCodeArtsModels } from '../codearts.js'

const HOME = process.env.USERPROFILE
const localState = JSON.parse(readFileSync(HOME + '\\AppData\\Roaming\\codearts-agent\\Local State', 'utf8'))
const dpapi = Buffer.from(localState.os_crypt.encrypted_key, 'base64').subarray(5)
const ps = `
Add-Type -AssemblyName System.Security
$b = [Convert]::FromBase64String('${dpapi.toString('base64')}')
[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))
`
const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
const aesKey = Buffer.from(out.stdout.trim(), 'base64')

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(HOME + '\\AppData\\Roaming\\codearts-agent\\User\\globalStorage\\state.vscdb', { readOnly: true })
const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('secret://{"extensionId":"huaweicloud.authentication","key":"HuaweiCloudSession"}')
db.close()
const blob = Buffer.from(JSON.parse(String(row.value)).data)
const decipher = createDecipheriv('aes-256-gcm', aesKey, blob.subarray(3, 15))
decipher.setAuthTag(blob.subarray(blob.length - 16))
const session = JSON.parse(Buffer.concat([decipher.update(blob.subarray(15, blob.length - 16)), decipher.final()]).toString('utf8'))

const account = {
  id: session.account.id,
  token: session.securitytoken,
  accessKeyId: session.accessKey,
  secretAccessKey: session.secretKey,
  refreshToken: session.refresh_token,
  dpopPrivateKey: session.loginContext.dpopKeyPair.privateKeyJwk,
  clientId: 'codearts-agent',
  expiration: session.expires_at,
  userId: session.account.id,
  userName: session.account.label,
}
console.log('session expires_at:', session.expires_at, '-> now:', new Date().toISOString())
try {
  const credits = await fetchCodeArtsCredits(account)
  console.log('CREDITS OK:', JSON.stringify(credits))
} catch (error) {
  console.log('CREDITS FAILED:', String(error.message || error).slice(0, 300))
}
try {
  const models = await fetchCodeArtsModels(account)
  console.log('MODELS OK:', models.length, models.slice(0, 3).map((m) => m.id).join(', '))
} catch (error) {
  console.log('MODELS FAILED:', String(error.message || error).slice(0, 300))
}
