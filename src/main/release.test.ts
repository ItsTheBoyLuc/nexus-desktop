import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUMPS, checkPreconditions, isBump, nextVersion, scrub, STEPS } from '../../scripts/releaseLib.mjs'

/**
 * `npm run release -- patch|minor|major`: the rules are tested here, and the script is only ever run with --dry-run (it must not release
 * anything from a test).
 */
const ROOT = join(__dirname, '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const GOOD = { bump: 'patch', statusOutput: '', branch: 'main', token: 'ghp_example_token_value' }

describe('the conditions of a release', () => {
  it('pass for a clean tree on main with a token and a known kind of release', () => {
    for (const bump of BUMPS) expect(checkPreconditions({ ...GOOD, bump })).toEqual([])
  })

  it.each([undefined, '', 'patchy', 'PATCH', 'preminor', '1.2.3', null])('refuses the release kind %j', (bump) => {
    expect(checkPreconditions({ ...GOOD, bump })[0]).toMatch(/patch\|minor\|major/)
  })

  it.each([' M src/main/index.ts\n', '?? new-file.ts\n', 'A  x\n'])('refuses a tree that is not clean (%j)', (statusOutput) => {
    expect(checkPreconditions({ ...GOOD, statusOutput })).toEqual([expect.stringMatching(/not clean/)])
  })

  it.each(['develop', 'feature/x', 'HEAD', '', undefined])('refuses branch %j: only main releases', (branch) => {
    expect(checkPreconditions({ ...GOOD, branch })).toEqual([expect.stringMatching(/only made from main/)])
  })

  it.each([undefined, '', '   ', null, 5])('refuses a missing token (%j) with a clear message that points at the docs and shows no token', (token) => {
    const problems = checkPreconditions({ ...GOOD, token })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/GH_TOKEN is not set/)
    expect(problems[0]).toContain('docs/RELEASING.md')
  })

  it('reports every problem at once, and never puts the token in a message', () => {
    const token = 'ghp_SECRET_VALUE_1234'
    const problems = checkPreconditions({ bump: 'nope', statusOutput: ' M x', branch: 'dev', token })
    expect(problems).toHaveLength(3)
    expect(problems.join('\n')).not.toContain(token)
  })
})

describe('versions', () => {
  it.each([
    ['0.2.0', 'patch', '0.2.1'],
    ['0.2.9', 'patch', '0.2.10'],
    ['0.2.5', 'minor', '0.3.0'],
    ['0.9.9', 'major', '1.0.0'],
    ['1.4.2', 'major', '2.0.0'],
    ['1.4.2', 'minor', '1.5.0']
  ])('%s %s -> %s', (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected)
  })

  it('refuses a version that is not x.y.z and a kind that is not known', () => {
    expect(() => nextVersion('1.2', 'patch')).toThrow(/plain x\.y\.z/)
    expect(() => nextVersion('1.2.3-beta.1', 'patch')).toThrow(/plain x\.y\.z/)
    expect(() => nextVersion('1.2.3', 'huge')).toThrow(/not patch, minor or major/)
    expect(isBump('patch')).toBe(true)
    expect(isBump('x')).toBe(false)
  })
})

describe('the secret never reaches the output', () => {
  it('scrub removes every occurrence, and leaves text alone when there is nothing to hide', () => {
    expect(scrub('a ghp_abcd b ghp_abcd', 'ghp_abcd')).toBe('a *** b ***')
    expect(scrub('nothing here', 'ghp_abcd')).toBe('nothing here')
    expect(scrub('abc', undefined)).toBe('abc')
    expect(scrub('abc', 'ab')).toBe('abc') // too short to be a token: not a risk, and replacing it would mangle text
  })

  it('the script never prints or writes its environment or the token', () => {
    const script = read('scripts/release.mjs')
    // Every line that prints goes through scrub(), and nothing prints the environment.
    for (const line of script.split(/\r?\n/).filter((entry) => /console\.(info|log|error|warn)\(/.test(entry))) expect(line).toContain('scrub(')
    expect(script).not.toMatch(/console\.\w+\(process\.env|JSON\.stringify\(process\.env|\.\.\.process\.env\)\)/)
    expect(script).not.toMatch(/writeFile|appendFile|createWriteStream/)
    // The token is read from the environment only, and handed to the publish step alone.
    expect(script).toContain('const token = process.env.GH_TOKEN')
    expect(script.match(/withToken: true/g) ?? []).toHaveLength(1)
    expect(script).toContain("npx electron-builder --win --x64 --publish always', { withToken: true }")
    expect(script).toContain('if (!withToken) delete env.GH_TOKEN')
    // Every message that is printed goes through scrub().
    expect(script).toContain('console.info(scrub(message, token))')
    expect(script).toContain('console.error(`\\nRelease refused: ${scrub(message, token)}\\n`)')
  })

  it('the repository stores no token anywhere: not in the builder config, the scripts, the docs or the example env', () => {
    for (const file of ['electron-builder.yml', 'scripts/release.mjs', 'scripts/releaseLib.mjs', 'docs/RELEASING.md', '.env.example', 'package.json']) {
      expect(read(file), file).not.toMatch(/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/)
    }
    const builderCode = read('electron-builder.yml').split(/\r?\n/).filter((entry) => !entry.trim().startsWith('#')).join(' ')
    expect(builderCode).not.toMatch(/token/i)
  })
})

describe('the script', () => {
  it('is wired as npm run release and checks first, runs the steps in order, and restores the version if a step fails after the bump', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['release']).toBe('node scripts/release.mjs')
    expect(STEPS).toEqual(['typecheck', 'lint', 'test', 'bump', 'build', 'publish'])
    const script = read('scripts/release.mjs')
    const order = ['checkPreconditions(', "'npm run typecheck'", "'npm run lint'", "'npm test'", 'npm version ${bump} --no-git-tag-version', "run('npm run build')", '--publish always'].map((needle) => script.indexOf(needle))
    expect(order.every((index) => index > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(script.indexOf('if (dryRun)')).toBeGreaterThan(script.indexOf('checkPreconditions('))
    expect(script.indexOf('if (dryRun)')).toBeLessThan(script.indexOf("'npm run typecheck'"))
    expect(script.match(/restore\(\)/g)!.length).toBeGreaterThanOrEqual(3)
    expect(script).toContain('git checkout -- package.json package-lock.json')
  })

  it('the draft setting comes from the builder config, and the config is the releases repository', () => {
    expect(read('electron-builder.yml')).toMatch(/releaseType: draft/)
    expect(read('electron-builder.yml')).toMatch(/repo: nexus-desktop-releases/)
  })

  function dryRun(env: Record<string, string>, ...args: string[]) {
    const base = { ...process.env }
    delete base['GH_TOKEN']
    return spawnSync(process.execPath, [join(ROOT, 'scripts', 'release.mjs'), ...args, '--dry-run'], { cwd: ROOT, env: { ...base, ...env }, encoding: 'utf8' })
  }
  const hash = (path: string): string => createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex')

  it('--dry-run without a token refuses with the GH_TOKEN message and changes nothing', () => {
    const before = [hash('package.json'), hash('package-lock.json')]
    const result = dryRun({}, 'patch')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('GH_TOKEN is not set')
    expect([hash('package.json'), hash('package-lock.json')]).toEqual(before)
  })

  it('--dry-run with a token never prints it, never runs a step, and changes nothing, whatever the state of the tree', () => {
    const token = 'ghp_DryRunTokenThatMustNeverBePrinted0000'
    const before = [hash('package.json'), hash('package-lock.json')]
    for (const args of [['patch'], ['minor'], ['major'], ['huge'], []]) {
      const result = dryRun({ GH_TOKEN: token }, ...args)
      expect(`${result.stdout}${result.stderr}`, args.join(' ')).not.toContain(token)
      expect(result.stdout, args.join(' ')).not.toMatch(/== (typecheck|lint|test|bump|build|publish)/)
    }
    expect([hash('package.json'), hash('package-lock.json')]).toEqual(before)
  })

  it('--dry-run refuses an unknown kind of release', () => {
    const result = dryRun({ GH_TOKEN: 'ghp_example_not_a_real_token' }, 'huge')
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/patch\|minor\|major/)
  })
})

describe('the docs', () => {
  const docs = read('docs/RELEASING.md')

  it('cover every step the task asks for', () => {
    for (const part of [
      'nexus-desktop-releases',
      'Contents = Read and write',
      'only',
      'Read-Host',
      'AsSecureString',
      'npm run release -- patch',
      'Publish release',
      'must reinstall once',
      'SmartScreen',
      'Restart and install'
    ]) {
      expect(docs, part).toContain(part)
    }
  })
})
