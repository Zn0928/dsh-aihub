// Without node:sqlite the plugin must degrade gracefully (report no session)
// rather than throw or misread the store.
const original = process.getBuiltinModule
process.getBuiltinModule = (name) => (name === 'node:sqlite' ? undefined : original.call(process, name))

const { importOfficialCodeArtsSession } = await import('../codearts.js')
const account = importOfficialCodeArtsSession()
console.log('NO-SQLITE IMPORT:', account === undefined ? 'undefined (graceful)' : 'imported ' + account.userName)
process.exit(account === undefined ? 0 : 1)
