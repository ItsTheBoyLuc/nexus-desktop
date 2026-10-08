// Build guard: the fake bridge used by `npm run dev:mock` must never be part of a build.
//   node scripts/check-no-mock.mjs pre    before bundling: the mock flags must be off
//   node scripts/check-no-mock.mjs post   after bundling: no mock code may exist in out/
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'NEXUS_MOCK_BRIDGE'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const phase = process.argv[2]

function fail(message) {
  console.error(`\nBuild refused: ${message}\n`)
  process.exit(1)
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

if (phase === 'pre') {
  const on = (value) => value !== undefined && !['', '0', 'false'].includes(String(value).toLowerCase())
  if (on(process.env.NEXUS_MOCK) || on(process.env.VITE_USE_MOCK)) {
    fail('the mock flag (NEXUS_MOCK / VITE_USE_MOCK) is on. Unset it: mock mode is for `npm run dev:mock` only.')
  }
} else if (phase === 'post') {
  const out = join(root, 'out')
  if (!existsSync(out)) fail('out/ does not exist, nothing was built.')
  const leaked = walk(out).filter((file) => readFileSync(file).includes(MARKER))
  if (leaked.length > 0) fail(`mock bridge code found in the bundle: ${leaked.join(', ')}`)
  console.info('Mock guard OK: no mock code in out/.')
} else {
  fail('usage: node scripts/check-no-mock.mjs <pre|post>')
}
