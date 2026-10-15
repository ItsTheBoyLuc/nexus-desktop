// Pure checks used by scripts/check-no-mock.mjs (and tested in src/main/buildGuards.test.ts). No file or network access in here.

export const RELEASES_OWNER = 'ItsTheBoyLuc'
export const RELEASES_REPO = 'nexus-desktop-releases'

/** Strings that must never appear in the built app: the dev-only way to force the updater to run, and a place a token could hide. */
export const FORBIDDEN_IN_BUILD = ['forceDevUpdateConfig', 'dev-app-update.yml', 'GH_TOKEN']

/**
 * The `publish` block of electron-builder.yml must be exactly the public releases-only repository, as a DRAFT, with no token in it.
 * Returns a list of problems (empty = fine). Reads plain `key: value` lines under `publish:`; the file is ours and flat.
 */
export function checkPublishConfig(yamlText) {
  const problems = []
  const lines = yamlText.split(/\r?\n/)
  const start = lines.findIndex((line) => /^publish:\s*$/.test(line))
  if (start === -1) return ['electron-builder.yml has no `publish:` block, so the installer carries no update feed.']
  const block = {}
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (!/^\s+/.test(line)) break
    const match = /^\s+([A-Za-z]+):\s*(.*?)\s*(?:#.*)?$/.exec(line)
    if (match) block[match[1]] = match[2]
  }
  if (block.provider !== 'github') problems.push('publish.provider must be github.')
  if (block.owner !== RELEASES_OWNER) problems.push(`publish.owner must be ${RELEASES_OWNER}.`)
  if (block.repo !== RELEASES_REPO) problems.push(`publish.repo must be ${RELEASES_REPO} (the public, releases-only repository), never the source repository.`)
  if (block.releaseType !== 'draft') problems.push('publish.releaseType must be draft: a release is reviewed and published by hand.')
  if (block.private === 'true') problems.push('publish.private must not be true: a private feed would need a token inside the app.')
  for (const key of Object.keys(block)) {
    if (/token|secret|password/i.test(key)) problems.push(`publish.${key} must not exist: no token is ever shipped inside the app.`)
  }
  return problems
}

/** Which of the given built files (path -> text) contain a forbidden string. */
export function findForbidden(files) {
  const found = []
  for (const [path, text] of files) {
    for (const needle of FORBIDDEN_IN_BUILD) if (text.includes(needle)) found.push(`${path} contains "${needle}"`)
  }
  return found
}
