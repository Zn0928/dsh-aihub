import { importOfficialCodeArtsSession, fetchCodeArtsCredits } from '../codearts.js'

const account = importOfficialCodeArtsSession()
if (account === undefined) {
  console.log('IMPORT: undefined')
  process.exit(1)
}
const redact = (value) => (typeof value === 'string' && value.length > 12 ? value.slice(0, 6) + '…len' + value.length : value)
console.log('IMPORT OK')
for (const key of ['id', 'userName', 'expiration', 'clientId']) console.log(' ', key, '=', account[key])
for (const key of ['token', 'accessKeyId', 'secretAccessKey', 'refreshToken']) console.log(' ', key, '=', redact(account[key]))
console.log('  dpopPrivateKey crv =', account.dpopPrivateKey?.crv, 'has d =', typeof account.dpopPrivateKey?.d === 'string')

try {
  const credits = await fetchCodeArtsCredits(account)
  console.log('CREDITS OK:', JSON.stringify(credits))
} catch (error) {
  console.log('CREDITS FAILED:', String(error.message || error).slice(0, 200))
  process.exit(2)
}
