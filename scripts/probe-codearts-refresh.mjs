import { readCodeArtsAccounts, refreshCodeArtsAccount, fetchCodeArtsCredits } from '../codearts.js'

const { accounts, errors } = readCodeArtsAccounts()
console.log('accounts:', accounts.length, 'errors:', JSON.stringify(errors))
const account = accounts[0]
if (account === undefined) process.exit(1)
console.log('user:', account.userName)
console.log('expiration:', account.expiration)
console.log('has refreshToken:', account.refreshToken.length > 0)
console.log('has dpopPrivateKey:', account.dpopPrivateKey !== undefined)
console.log('clientId:', account.clientId || '(default)')

try {
  const fresh = await refreshCodeArtsAccount(account)
  console.log('REFRESH OK')
  console.log('  new expiration:', fresh.expiration)
  console.log('  token changed:', fresh.token !== account.token)
  console.log('  refreshToken rotated:', fresh.refreshToken !== account.refreshToken)
  const credits = await fetchCodeArtsCredits(fresh)
  console.log('  credits:', JSON.stringify(credits))
} catch (error) {
  console.log('REFRESH FAILED:', String(error.message || error).slice(0, 400))
  process.exitCode = 2
}
