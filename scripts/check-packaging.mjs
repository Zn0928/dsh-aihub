// Guard the packaging invariants that DSH is strict about but editors and
// Windows PowerShell are not. Run with `node scripts/check-packaging.mjs`;
// exits non-zero and names the offending file on any violation.
//
// Why this exists: writing package.json through PowerShell's `Set-Content`
// silently prepends a UTF-8 BOM, and DSH then refuses to load the plugin with
// `Unexpected token '﻿', "﻿{\n  \"name\"... is not valid JSON`.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

function fail(file, reason) {
  failures.push(`${file}: ${reason}`)
}

/** A leading BOM makes JSON.parse throw even though most editors hide it. */
function checkNoBom(file) {
  const buffer = readFileSync(file)
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    fail(file, 'starts with a UTF-8 BOM (DSH reports "Unexpected token \'\\uFEFF\'")')
  }
}

function checkJson(file) {
  const raw = readFileSync(file, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(file, `is not valid JSON: ${error.message}`)
    return undefined
  }
}

/** Every JSON/YAML file the loader reads directly. */
const dataFiles = ['package.json', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json']
for (const relative of dataFiles) {
  const file = join(root, relative)
  if (!existsSync(file)) {
    if (relative === 'package.json' || relative === 'cordis.patch.yml') fail(relative, 'is missing')
    continue
  }
  checkNoBom(file)
  if (relative.endsWith('.json')) checkJson(file)
  // YAML forbids a BOM in most parsers too; checkNoBom above already covers it.
}

const manifest = existsSync(join(root, 'package.json')) ? checkJson(join(root, 'package.json')) : undefined

if (manifest !== undefined) {
  // `exports` must resolve: DSH imports the host entry plus ./client.
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target !== 'string' || target.includes('*')) continue
    if (!existsSync(join(root, target))) fail('package.json', `exports["${subpath}"] points at missing ${target}`)
  }
  // The bundle patch path is what makes the profile pick the plugin up.
  const patchPath = manifest.dsh?.bundle?.patch
  if (typeof patchPath !== 'string') {
    fail('package.json', 'dsh.bundle.patch is missing')
  } else if (!existsSync(join(root, patchPath))) {
    fail('package.json', `dsh.bundle.patch points at missing ${patchPath}`)
  }
  // No runtime dependencies is a deliberate promise: a linked install does not
  // install them, so any dependency would break the plugin at load time.
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    const declared = Object.keys(manifest[field] ?? {})
    if (declared.length > 0) fail('package.json', `${field} must stay empty (linked installs skip installing them): ${declared.join(', ')}`)
  }
  // The source files the exports and patch refer to.
  for (const relative of ['index.js', 'client.js', 'qoder.js', 'trae.js', 'codearts.js']) {
    if (!existsSync(join(root, relative))) fail(relative, 'is missing')
  }
}

if (failures.length > 0) {
  console.error('packaging check FAILED:')
  for (const line of failures) console.error('  - ' + line)
  process.exit(1)
}
console.log('packaging check OK: no BOM, valid manifest, exports and patch resolve, zero runtime dependencies')
