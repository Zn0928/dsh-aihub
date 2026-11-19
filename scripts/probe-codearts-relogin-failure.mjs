// Failure path: no readable official session AND a dead refresh_token must
// report both reasons instead of silently succeeding.
process.env.APPDATA = 'C:\\__no_codearts_client_here__'

const { importOfficialCodeArtsSession, refreshCodeArtsAccount } = await import('../codearts.js')

const official = importOfficialCodeArtsSession()
console.log('official session with redirected APPDATA:', official === undefined ? 'undefined (expected)' : 'unexpected')

if (official !== undefined) {
  console.log('FAIL: import should be undefined when the client is absent')
  process.exit(1)
}

const stale = {
  id: 'deadbeef-id',
  token: 'x',
  accessKeyId: 'y',
  secretAccessKey: 'z',
  refreshToken: 'not-a-real-refresh-token',
  clientId: 'codearts-agent',
}
try {
  await refreshCodeArtsAccount(stale, AbortSignal.timeout(15000))
  console.log('FAIL: refresh should have thrown')
  process.exit(2)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.log('refresh rejected as expected:', message.slice(0, 120))
}
console.log('FAILURE PATH OK: both branches report their own reason')
process.exit(0)