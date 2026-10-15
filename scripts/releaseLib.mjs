// Pure rules of `npm run release -- patch|minor|major` (scripts/release.mjs). No process, file or network access in here, so the rules are tested
// (src/main/release.test.ts) without ever releasing anything.

export const BUMPS = ['patch', 'minor', 'major']

/** The steps of a release, in order. The checks come first and nothing changes before they all pass. */
export const STEPS = ['typecheck', 'lint', 'test', 'bump', 'build', 'publish']

/** The remote the draft is published to is NOT chosen here: it is the `publish` block of electron-builder.yml (guarded by the build). */

export function isBump(value) {
  return BUMPS.includes(value)
}

/** The next version of `1.2.3` for a bump. Only plain x.y.z versions are bumped. */
export function nextVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) throw new Error(`The version "${current}" in package.json is not a plain x.y.z version.`)
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`"${bump}" is not patch, minor or major.`)
}

/**
 * Everything that must be true before a release starts. Returns a list of plain-language problems (empty = go).
 * `statusOutput` is the output of `git status --porcelain`; `token` is only tested for being there and is never put in a message.
 */
export function checkPreconditions({ bump, statusOutput, branch, token }) {
  const problems = []
  if (!isBump(bump)) problems.push(`Say what kind of release this is: npm run release -- patch|minor|major (got "${String(bump ?? '')}").`)
  if (String(statusOutput ?? '').trim() !== '') problems.push('The working tree is not clean. Commit or stash your changes first: a release is built from what is committed.')
  if (branch !== 'main') problems.push(`You are on "${String(branch ?? '')}". A release is only made from main.`)
  if (typeof token !== 'string' || token.trim() === '') {
    problems.push('GH_TOKEN is not set. Create the token as described in docs/RELEASING.md (step 2) and set it in this shell only, without saving it in your history, then run the release again.')
  }
  return problems
}

/** Removes a secret from a text before it is printed (defence in depth: the script never prints its environment). */
export function scrub(text, secret) {
  if (typeof secret !== 'string' || secret.length < 4) return text
  return text.split(secret).join('***')
}
