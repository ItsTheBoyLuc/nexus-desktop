import { RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { GAME_LABELS, isGameKey } from '../../shared/types'
import { Button } from '../components'
import { useGuildGames, useGuilds, useRefresh } from '../hooks/data'
import { PAGE_LABELS, parseLocation } from '../lib/routes'

export function TopBar() {
  const { pathname } = useLocation()
  const { guildId, game, page } = parseLocation(pathname)
  const guilds = useGuilds()
  const games = useGuildGames(guildId ?? undefined)
  const { refresh } = useRefresh()

  const [spinning, setSpinning] = useState(false)
  const spinTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(spinTimer.current), [])

  const guildName = guilds.status === 'ready' ? guilds.data.find((item) => item.id === guildId)?.name : undefined
  const gameLabel = game
    ? (games.status === 'ready' ? games.data.find((item) => item.key === game)?.label : undefined) ?? (isGameKey(game) ? GAME_LABELS[game] : game)
    : undefined

  const crumbs: string[] = []
  if (pathname.startsWith('/servers')) crumbs.push('Servers')
  else if (guildId) {
    crumbs.push(guildName ?? 'Server')
    if (game) {
      crumbs.push(gameLabel ?? game)
      if (page) crumbs.push(PAGE_LABELS[page])
    } else {
      crumbs.push('Choose a game')
    }
  }

  const onRefresh = (): void => {
    refresh()
    setSpinning(true)
    window.clearTimeout(spinTimer.current)
    spinTimer.current = window.setTimeout(() => setSpinning(false), 800)
  }

  return (
    <header className="topbar">
      <nav aria-label="Breadcrumb">
        <ol className="breadcrumb">
          {crumbs.map((crumb, index) => (
            <li key={`${index}-${crumb}`} className="breadcrumb__item" aria-current={index === crumbs.length - 1 ? 'page' : undefined}>
              {crumb}
            </li>
          ))}
        </ol>
      </nav>
      <Button
        variant="ghost"
        iconOnly
        aria-label="Refresh data"
        title="Refresh data"
        onClick={onRefresh}
        icon={<RotateCw size={18} aria-hidden="true" className={spinning ? 'is-spinning' : undefined} />}
      />
    </header>
  )
}
