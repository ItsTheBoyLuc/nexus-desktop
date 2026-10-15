// npm run release -- patch|minor|major [--dry-run]
//
// Publishes a DRAFT release of the installer to the public releases repository (the `publish` block of electron-builder.yml), so the app can
// update itself once the draft is published by hand. See docs/RELEASING.md.
//
// It refuses unless the working tree is clean, the branch is main and GH_TOKEN is set. Then: typecheck, lint, tests, version bump, build (with
// the mock/updater guard), publish. GH_TOKEN is read from the environment only: it is handed to the publish step alone, never printed, never
// written to a file. If a step fails after the version was bumped, package.json and package-lock.json are put back.
// --dry-run checks the conditions and prints the plan, and runs nothing.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkPreconditions, nextVersion, scrub, STEPS } from './releaseLib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const bump = args.find((arg) => !arg.startsWith('--'))
const token = process.env.GH_TOKEN

function say(message) {
  console.info(scrub(message, token))
}
function stop(message) {
  console.error(`\nRelease refused: ${scrub(message, token)}\n`)
  process.exit(1)
}

/** Runs a command in the project, showing its output. The token is only passed when `withToken` is true. */
function run(command, { withToken = false } = {}) {
  const env = { ...process.env }
  if (!withToken) delete env.GH_TOKEN
  const result = spawnSync(command, { cwd: root, env, stdio: 'inherit', shell: true })
  return result.status === 0
}

function capture(command) {
  const result = spawnSync(command, { cwd: root, encoding: 'utf8', shell: true })
  return result.status === 0 ? result.stdout : null
}

const status = capture('git status --porcelain')
const branch = capture('git rev-parse --abbrev-ref HEAD')?.trim()
if (status === null || !branch) stop('this is not a git repository, or git could not be run.')

const problems = checkPreconditions({ bump, statusOutput: status, branch, token })
if (problems.length > 0) stop(`\n  - ${problems.join('\n  - ')}`)

const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const next = nextVersion(current, bump)
say(`Release ${bump}: ${current} -> ${next}. Steps: ${STEPS.join(', ')}.`)
if (dryRun) {
  say('Dry run: the conditions are met. Nothing was run, nothing was changed.')
  process.exit(0)
}

function restore() {
  say('Putting package.json and package-lock.json back.')
  run('git checkout -- package.json package-lock.json')
}

for (const [name, command] of [
  ['typecheck', 'npm run typecheck'],
  ['lint', 'npm run lint'],
  ['test', 'npm test']
]) {
  say(`\n== ${name} ==`)
  if (!run(command)) stop(`${name} failed. Nothing was changed.`)
}

say('\n== bump ==')
if (!run(`npm version ${bump} --no-git-tag-version`)) {
  restore()
  stop('the version could not be bumped.')
}

say('\n== build ==')
if (!run('npm run build')) {
  restore()
  stop('the build failed (or the mock/updater guard refused it). Nothing was published.')
}

say('\n== publish (a DRAFT, to the releases repository) ==')
if (!run('npx electron-builder --win --x64 --publish always', { withToken: true })) {
  restore()
  stop('publishing failed. Look in the releases repository on GitHub: a partly uploaded draft may exist and has to be deleted there before you try again.')
}

if (!run('git add package.json package-lock.json') || !run(`git commit -m "release v${next}"`) || !run(`git tag v${next}`)) {
  stop(`the draft v${next} was published, but the version commit or tag could not be made. Commit package.json and package-lock.json by hand.`)
}
say(`\nDone: draft v${next} is on GitHub (not public yet).`)
say('Next: review the draft in the releases repository, publish it, then run `git push origin main --tags`. See docs/RELEASING.md.')
