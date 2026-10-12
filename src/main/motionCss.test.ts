import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The motion layer is CSS, and no component is rendered in these tests, so the rules of the layer are checked on the files:
 * what may move, that the tokens are used, that reduced motion removes everything, that destructive buttons never glow.
 */
const root = join(__dirname, '..', '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')
const css = (name: string): string => read(`src/renderer/theme/${name}`)
const THEME_FILES = ['motion.css', 'components.css', 'layout.css', 'screens.css', 'global.css']
const motionCss = css('motion.css')
/** The rules without the comments (the comments talk about the same properties the rules use). */
const motionRules = motionCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `@keyframes name { ... }` block of a stylesheet: name and the property names declared inside it. */
function keyframes(source: string): Array<{ name: string; properties: string[] }> {
  const result: Array<{ name: string; properties: string[] }> = []
  const opener = /@keyframes\s+([\w-]+)\s*\{/g
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    let depth = 1
    let index = opener.lastIndex
    while (depth > 0 && index < source.length) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') depth -= 1
      index += 1
    }
    const body = source.slice(opener.lastIndex, index - 1)
    const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((property) => property[1] as string)
    result.push({ name: match[1] as string, properties })
  }
  return result
}

describe('what the motion layer is allowed to move', () => {
  const ALLOWED = new Set(['transform', 'opacity', 'stroke-dashoffset'])

  it.each(THEME_FILES)('every keyframe in %s only changes transform, opacity or stroke-dashoffset', (file) => {
    for (const frame of keyframes(css(file))) {
      for (const property of frame.properties) expect(ALLOWED.has(property), `@keyframes ${frame.name} animates ${property}`).toBe(true)
    }
  })

  it('has no shimmer that moves a background (the skeleton sweep is a transform)', () => {
    expect(THEME_FILES.map(css).join('\n')).not.toMatch(/background-position\s*:/)
  })

  it('transitions in motion.css only name transform, opacity, colour-like properties and the group row', () => {
    const named = [...motionRules.matchAll(/transition\s*:\s*([^;]+);/g)].flatMap((match) =>
      (match[1] as string)
        .split(/,(?![^(]*\))/)
        .map((part) => part.trim().split(/\s+/)[0] as string)
        .filter((property) => property !== 'none')
    )
    const allowed = new Set(['transform', 'opacity', 'background', 'border-color', 'box-shadow', 'color', 'visibility', 'grid-template-rows', 'stroke-dashoffset'])
    for (const property of named) expect(allowed.has(property), `transition on ${property}`).toBe(true)
  })

  it('grid-template-rows (the group expand and collapse) is the only size that animates, and only on .nav-collapse', () => {
    const blocks = motionRules.split('}').filter((block) => /transition[^;]*grid-template-rows/.test(block))
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) expect(block).toMatch(/\.nav-collapse/)
  })
})

describe('the tokens', () => {
  it('every animation duration in motion.css comes from a token, except the named loading indicators', () => {
    const declarations = [...motionRules.matchAll(/(?:^|[;{\s])animation\s*:\s*([^;]+);/g)].map((match) => (match[1] as string).trim())
    expect(declarations.length).toBeGreaterThan(5)
    for (const declaration of declarations) {
      if (declaration === 'none !important') continue
      expect(declaration, declaration).toMatch(/var\(--motion-(micro|standard|page|loop|toast)/)
    }
  })

  it('the old fixed-time easing "ease" is not used in the motion layer', () => {
    expect(motionCss).not.toMatch(/\d(ms|s)\s+ease\b/)
  })
})

describe('reduced motion', () => {
  it('is removed for the operating system setting and for the Reduce animations switch alike', () => {
    expect(motionCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\*[^}]*\{[^}]*animation: none !important;[^}]*transition: none !important/s)
    expect(motionCss).toMatch(/:root\[data-motion='reduced'\] \*,[\s\S]*?animation: none !important;[\s\S]*?transition: none !important/)
  })

  it('comes last in the file, so nothing declared later can undo it', () => {
    const reduced = motionCss.indexOf('/* ── Reduced motion')
    expect(reduced).toBeGreaterThan(0)
    expect(motionCss.slice(reduced)).not.toMatch(/@keyframes/)
  })

  it('the entrances only have a "from" frame and use backwards fill, so a removed animation leaves the element in place', () => {
    const entrances = motionCss.split('\n').filter((line) => /animation: (rise-in|item-in|pop-in)/.test(line))
    expect(entrances.length).toBeGreaterThan(3)
    for (const line of entrances) expect(line).toContain('backwards')
  })
})

describe('route transitions and the staggered entrance', () => {
  const shell = read('src/renderer/layout/AppShell.tsx')

  it('the content area animates, skeleton pages do not, and the sidebar is outside the animated scope', () => {
    expect(motionCss).toMatch(/\.route-scope > :not\(\[aria-busy='true'\]\)\s*\{\s*animation: rise-in var\(--motion-page\)/)
    expect(shell).toMatch(/<main[\s\S]*<div key=\{scope\} className="route-scope">[\s\S]*<Outlet \/>[\s\S]*<\/main>/)
    expect(shell.indexOf('<Sidebar />')).toBeLessThan(shell.indexOf('route-scope'))
  })

  it('the scope key is the server and the game, not the page: switching either rebuilds and re-animates, a page change does not rebuild the layouts', () => {
    expect(shell).toContain("const scope = `${guildId ?? ''}:${game ?? ''}`")
    expect(shell).not.toMatch(/key=\{pathname\}/)
  })

  it('staggers at most eight items, 40ms apart, and nothing after the eighth', () => {
    expect(motionCss).toContain('.stagger > :nth-child(-n + 8) { animation: item-in var(--motion-standard) var(--ease) backwards; }')
    for (let n = 2; n <= 8; n += 1) expect(motionCss).toContain(`.stagger > :nth-child(${n}) { animation-delay: calc(var(--motion-stagger) * ${n - 1}); }`)
    expect(motionCss).not.toMatch(/:nth-child\((9|1\d)\)/)
  })

  it('the Stagger component drops the class after the entrance, so Load more rows appear without stagger', () => {
    const source = read('src/renderer/components/Stagger.tsx')
    expect(source).toContain('STAGGER_WINDOW_MS')
    expect(source).toContain("entering ? 'stagger' : ''")
  })
})

describe('buttons and cards', () => {
  const components = css('components.css')

  it('primary buttons lift 2px with a soft glow, and every button squeezes to 0.98 when pressed', () => {
    expect(components).toMatch(/\.btn--primary:hover:not\(:disabled\)\s*\{[^}]*box-shadow: var\(--shadow-glow\);[^}]*translateY\(-2px\)/)
    expect(components).toMatch(/\.btn:active:not\(:disabled\),\s*\.btn--primary:active:not\(:disabled\)\s*\{\s*transform: scale\(0\.98\)/)
  })

  it('destructive buttons never glow or lift', () => {
    const destructive = components.split('\n').filter((line) => line.includes('.btn--destructive'))
    expect(destructive.length).toBeGreaterThan(2)
    for (const line of destructive.filter((item) => item.includes(':hover'))) {
      expect(line).toContain('box-shadow: none')
      expect(line).not.toMatch(/translateY\(-/)
    }
    expect(components).not.toMatch(/\.btn--destructive[^{]*\{[^}]*shadow-glow/)
  })

  it('every confirm button of the shared dialogs is destructive', () => {
    expect(read('src/renderer/components/ConfirmDialog.tsx')).toContain('<Button destructive loading={busy} onClick={onConfirm}>')
    expect(read('src/renderer/screens/ActionShell.tsx')).toContain('<Button destructive loading={write.busy} onClick={() => void confirm()}>')
  })

  it('cards lift 2px and take a low-opacity #ff3333 border on hover', () => {
    expect(components).toMatch(/\.card--interactive:focus-visible\s*\{[^}]*border-color: rgba\(255, 51, 51, 0\.5\);[^}]*translateY\(-2px\)/)
  })

  it('the spinner fades in', () => {
    expect(components).toMatch(/\.spinner\s*\{[^}]*animation: spin 800ms linear infinite, fade-in var\(--motion-micro\)/)
  })

  it('table rows only get a subtle tint on hover (no movement)', () => {
    expect(css('screens.css')).toContain('.table tbody tr:hover { background: rgba(255, 255, 255, 0.03); }')
  })
})

describe('the sidebar', () => {
  const sidebar = read('src/renderer/layout/Sidebar.tsx')

  it('has one indicator bar, positioned absolutely and moved with a transform only', () => {
    expect(sidebar.match(/className="nav-indicator"/g)).toHaveLength(1)
    expect(/\.nav-indicator\s*\{([^}]*)\}/.exec(motionCss)?.[1] ?? '').toContain('position: absolute')
    expect(motionCss).toMatch(/\.nav-indicator\[data-ready='true'\]\s*\{\s*transition: transform var\(--motion-standard\)/)
    const hook = read('src/renderer/layout/useNavIndicator.ts')
    expect(hook).toContain('bar.style.transform')
    expect(hook).not.toMatch(/style\.(top|left|height|width)\b/)
  })

  it('the League and Esports groups open and close smoothly and stay out of reach while closed', () => {
    expect(sidebar.match(/<NavCollapse /g)).toHaveLength(2)
    expect(sidebar).toContain('inert={!expanded}')
    expect(motionCss).toMatch(/\.nav-collapse\[data-collapsed='true'\]\s*\{[^}]*visibility: hidden/)
  })

  it('keeps the focus rings of the items visible while a group is clipped', () => {
    expect(motionCss).toContain('overflow-clip-margin: 4px')
  })
})

describe('the Preferences popover and the saved switch', () => {
  it('lives in the sidebar footer and is the only place that writes the flag', () => {
    expect(read('src/renderer/layout/Sidebar.tsx')).toContain('<PreferencesMenu />')
    expect(read('src/renderer/layout/PreferencesMenu.tsx')).toContain('Reduce animations')
    expect(read('src/renderer/hooks/settings.tsx')).toContain('window.nexus.settings.set({ reduceMotion: reduce })')
  })

  it('is applied before the first paint', () => {
    const main = read('src/renderer/main.tsx')
    expect(main.indexOf('applyMotionMode(document.documentElement')).toBeGreaterThan(0)
    expect(main.indexOf('applyMotionMode(document.documentElement')).toBeLessThan(main.indexOf('createRoot(container)'))
  })
})

describe('the window', () => {
  it('has the dark background and is shown only when ready, so there is no white flash', () => {
    const main = read('src/main/index.ts')
    expect(main).toContain("backgroundColor: '#0a0a0a'")
    expect(main).toContain('show: false')
    expect(main).toContain("window.once('ready-to-show', () => window.show())")
  })
})

describe('dialogs, toasts, dropdowns, skeletons and states', () => {
  it('the dialog backdrop fades and the panel scales from 0.96 to 1 while it fades in', () => {
    expect(motionCss).toMatch(/@keyframes modal-in\s*\{\s*from \{ opacity: 0; transform: scale\(0\.96\); \}/)
    expect(motionCss).toContain('.modal-overlay { animation: fade-in var(--motion-micro) var(--ease) backwards; }')
    expect(motionCss).toContain('.modal { animation: modal-in var(--motion-standard) var(--ease) backwards; }')
  })

  it('does not touch how the dialog takes and gives back focus', () => {
    const modal = read('src/renderer/components/Modal.tsx')
    expect(modal).toContain("appRoot?.setAttribute('inert', '')")
    expect(modal).toContain('[data-autofocus]:not([disabled])')
    expect(modal).not.toMatch(/animationend|transitionend|setTimeout/)
  })

  it('toasts slide in from the right, and a thin bar runs for exactly as long as the toast stays', () => {
    expect(motionCss).toMatch(/@keyframes toast-in\s*\{\s*from \{ opacity: 0; transform: translateX\(24px\); \}/)
    expect(motionCss).toContain('animation: toast-progress var(--motion-toast) linear forwards;')
    const toast = read('src/renderer/components/Toast.tsx')
    expect(toast).toContain('Number.parseInt(motion.toast, 10)')
    expect(toast).toContain('<span className="toast__progress" aria-hidden="true" />')
  })

  it('dropdowns, pickers and the popover fade in and slide 4px', () => {
    expect(motionCss).toMatch(/@keyframes pop-in\s*\{\s*from \{ opacity: 0; transform: translateY\(var\(--pop-offset, -4px\)\); \}/)
    expect(motionCss).toMatch(/\.menu__list,\s*\.search-list \{ animation: pop-in var\(--motion-micro\)/)
    expect(motionCss).toContain('.menu__list--top,\n.prefs__panel { --pop-offset: 4px; }')
  })

  it('skeletons shimmer with a transform on a pseudo element', () => {
    expect(motionCss).toMatch(/@keyframes shimmer\s*\{\s*to \{ transform: translateX\(100%\); \}/)
    expect(motionCss).toMatch(/\.skeleton::after \{[^}]*transform: translateX\(-100%\);[^}]*animation: shimmer var\(--motion-loop\)/)
  })

  it('empty and error icons fade in, and the retry button of an error shakes once', () => {
    expect(motionCss).toContain('.state__icon { animation: fade-in var(--motion-page) var(--ease) backwards; }')
    expect(motionCss).toContain('.state--error .state__actions .btn { animation: shake var(--motion-page) var(--ease) var(--motion-standard) 1 backwards; }')
    expect(motionCss).toMatch(/@keyframes shake\s*\{[^}]*translateX/)
  })

  it('the old animations of components.css are gone, so each one is declared once', () => {
    const components = css('components.css')
    for (const name of ['toast-in', 'modal-in', 'shimmer']) expect(components).not.toContain(`@keyframes ${name}`)
    expect(components).not.toMatch(/modal-in|toast-in/)
  })
})

describe('the login screen and the waking dots', () => {
  it('the logo draws its outline once with stroke-dashoffset, the bolt fades in, then a slow glow pulses with opacity only', () => {
    expect(motionCss).toMatch(/@keyframes logo-draw\s*\{\s*from \{ stroke-dashoffset: 1; \}/)
    expect(motionCss).toMatch(/\.logo__outline \{[^}]*stroke-dasharray: 1;[^}]*animation: logo-draw/)
    expect(motionCss).toMatch(/\.logo__bolt \{ animation: fade-in/)
    expect(keyframes(motionCss).find((frame) => frame.name === 'logo-glow')?.properties).toEqual(['opacity', 'opacity'])
    expect(motionCss).toMatch(/\.logo__glow \{[^}]*animation: logo-glow var\(--motion-loop-glow\)[^}]*infinite/)
  })

  it('only the login screen uses the animated logo', () => {
    expect(read('src/renderer/screens/Login.tsx')).toContain('<Logo size={64} label="Nexus" animated />')
    expect(read('src/renderer/layout/Sidebar.tsx')).not.toContain('animated')
    expect(read('src/renderer/layout/AppShell.tsx')).not.toContain('animated')
  })

  it('"Waking up the server" has three dots that pulse their opacity, and shows while the API reports waking', () => {
    expect(read('src/renderer/components/WakingNote.tsx').match(/<i \/>/g)).toHaveLength(3)
    expect(keyframes(motionCss).find((frame) => frame.name === 'dot-pulse')?.properties.every((property) => property === 'opacity')).toBe(true)
    expect(read('src/renderer/screens/Login.tsx')).toContain("apiStatus === 'waking' ? <WakingNote />")
    expect(read('src/renderer/layout/AppShell.tsx')).toContain("status === 'waking' ? <WakingNote />")
  })

  it('has no other infinite loop than the loading indicators and the login glow', () => {
    const loops = [...motionRules.matchAll(/animation:\s*([\w-]+)[^;]*infinite/g)].map((match) => match[1])
    expect([...loops].sort()).toEqual(['dot-pulse', 'logo-glow', 'shimmer'])
  })
})

describe('the success check mark', () => {
  it('draws itself with stroke-dashoffset', () => {
    expect(motionCss).toMatch(/@keyframes draw\s*\{\s*from \{ stroke-dashoffset: 1; \}/)
    expect(motionCss).toMatch(/\.success-mark__ring \{ animation: draw/)
    expect(motionCss).toMatch(/\.success-mark__tick \{ animation: draw/)
  })

  it('is only drawn by success states: the success panels, success toasts and success notices', () => {
    for (const name of ['Announcement', 'ResultsForm']) expect(read(`src/renderer/screens/${name}.tsx`), name).toContain('<SuccessMark')
    // The esports posts show it in the shared result dialog (milestone 6), which only exists after a confirmed post.
    expect(read('src/renderer/components/PostResultDialog.tsx')).toContain('<SuccessMark')
    expect(read('src/renderer/components/Toast.tsx')).toContain("item.tone === 'success' ? <SuccessMark")
    expect(read('src/renderer/components/Notice.tsx')).toContain("tone === 'success' ? <SuccessMark")
  })

  it('the announcement success panel is the "done" branch; the lost branch never draws it', () => {
    const source = read('src/renderer/screens/Announcement.tsx')
    const mark = source.indexOf('<SuccessMark')
    expect(source.slice(source.lastIndexOf("phase === 'done'", mark), mark), 'Announcement').toContain("phase === 'done'")
    const esports = read('src/renderer/screens/EsportsAnnouncement.tsx')
    const lost = esports.indexOf("phase === 'lost' ? (")
    expect(lost).toBeGreaterThan(0)
    expect(esports.slice(lost, esports.indexOf('Discard this draft', lost))).not.toContain('SuccessMark')
    // The result dialog (with the check mark) is only mounted once a post was confirmed: `posted` is only ever set in the success branch.
    expect(esports).toMatch(/\{posted \? \(\s*<PostResultDialog/)
    expect(esports.match(/setPosted\(\{/g)).toHaveLength(1)
    expect(esports.slice(esports.lastIndexOf('if (outcome.ok) {', esports.indexOf('setPosted({')), esports.indexOf('setPosted({'))).toContain('if (outcome.ok) {')
  })

  it('a success toast is never pushed from a lost or failed branch', () => {
    const screens = ['Announcement', 'EsportsAnnouncement', 'EsportsResults', 'EsportsAttendance', 'EsportsEvents', 'ResultsForm', 'ServerSettings', 'RacingTeamDialog']
    for (const name of screens) {
      const lines = read(`src/renderer/screens/${name}.tsx`).split('\n')
      lines.forEach((line, index) => {
        if (!line.includes("tone: 'success'")) return
        const before = lines.slice(Math.max(0, index - 6), index).join('\n')
        expect(before, `${name}:${index + 1}`).not.toMatch(/'lost'|\.ok\) return|!outcome\.ok/)
      })
    }
  })
})

describe('the look rules', () => {
  it('the motion layer has no yellow and no emoji', () => {
    expect(motionCss).not.toMatch(/yellow|gold|amber|#ff0\b|#ffd|#fc0|#fa0/i)
    expect(motionCss).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
