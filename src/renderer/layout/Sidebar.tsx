import {
  ArrowLeftRight,
  CalendarDays,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  FileWarning,
  Flag,
  Gavel,
  Layers,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Settings as SettingsIcon,
  ShieldAlert,
  Trophy,
  UserPlus,
  Users
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Logo, Select } from '../components'
import { MenuButton } from '../components/MenuButton'
import type { MenuItem } from '../components/MenuButton'
import { StatusLine } from '../components/StatusLine'
import { useAuth } from '../hooks/auth'
import { useGuildGames, useGuilds } from '../hooks/data'
import { mergeGames } from '../lib/catalog'
import { esportsModuleState, leagueModuleState, serverModuleState } from '../lib/modules'
import type { ModuleState } from '../lib/modules'
import { ESPORTS_PAGE_LABELS, ESPORTS_PAGES, gameHomePage, isLeaguePage, LEAGUE_PAGES, PAGE_LABELS, parseLocation, parseServerPage, routes, SERVER_PAGE_LABELS, SERVER_PAGES } from '../lib/routes'
import type { EsportsPageKey, LeaguePageKey, ServerPageKey } from '../lib/routes'

const SERVER_ICONS: Record<ServerPageKey, ReactNode> = {
  overview: <LayoutDashboard size={18} aria-hidden="true" />,
  tiers: <Layers size={18} aria-hidden="true" />,
  settings: <SettingsIcon size={18} aria-hidden="true" />,
  announcement: <Megaphone size={18} aria-hidden="true" />
}

const LEAGUE_ICONS: Record<LeaguePageKey, ReactNode> = {
  calendar: <CalendarDays size={16} aria-hidden="true" />,
  teams: <Users size={16} aria-hidden="true" />,
  standings: <Trophy size={16} aria-hidden="true" />,
  reports: <FileWarning size={16} aria-hidden="true" />,
  penalties: <Gavel size={16} aria-hidden="true" />,
  'dirty-drivers': <ShieldAlert size={16} aria-hidden="true" />,
  attendance: <CalendarCheck size={16} aria-hidden="true" />,
  signups: <UserPlus size={16} aria-hidden="true" />
}

const ESPORTS_ICONS: Record<EsportsPageKey, ReactNode> = {
  teams: <Users size={16} aria-hidden="true" />,
  events: <CalendarDays size={16} aria-hidden="true" />,
  results: <Trophy size={16} aria-hidden="true" />,
  attendance: <CalendarCheck size={16} aria-hidden="true" />,
  announcement: <Megaphone size={16} aria-hidden="true" />
}

const navClass = ({ isActive }: { isActive: boolean }): string => `nav-item${isActive ? ' nav-item--active' : ''}`

/** A greyed-out item that stays focusable and says why it is unavailable (tooltip, screen reader and visible hint). */
function NavDisabled({ icon, label, reason, trailing }: { icon: ReactNode; label: string; reason: string; trailing?: ReactNode }) {
  return (
    <button type="button" className="nav-item nav-item--disabled" aria-disabled="true" title={reason}>
      {icon}
      <span className="nav-item__label">{label}</span>
      {trailing}
      <span className="sr-only">. Not available: {reason}</span>
    </button>
  )
}

function LeagueGroup({ state, guildId, game, expandedByRoute }: { state: ModuleState; guildId: string | null; game: string | null; expandedByRoute: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const icon = <Flag size={18} aria-hidden="true" />
  if (!state.enabled || !guildId || !game) {
    return <NavDisabled icon={icon} label="League" reason={state.reason ?? 'Not available.'} />
  }
  const expanded = userOpen ?? expandedByRoute
  const listId = 'nav-league-list'
  return (
    <div className="nav-group">
      <button type="button" className="nav-item nav-item--group" aria-expanded={expanded} aria-controls={listId} onClick={() => setUserOpen(!expanded)}>
        {icon}
        <span className="nav-item__label">League</span>
        {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
      {expanded ? (
        <ul id={listId} className="nav-sublist">
          {LEAGUE_PAGES.map((key) => (
            <li key={key}>
              <NavLink to={routes.game(guildId, game, key)} className={({ isActive }) => `${navClass({ isActive })} nav-item--sub`}>
                {LEAGUE_ICONS[key]}
                {PAGE_LABELS[key]}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The Esports team group: Teams, Events, Results, Attendance and Announcement of the selected game. It follows the game selector
 * (the `{game}` of every endpoint) and does not need the game to be enabled in Games & Tiers: the esports data is separate.
 */
function EsportsGroup({ guildId, game, expandedByRoute }: { guildId: string; game: string; expandedByRoute: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const expanded = userOpen ?? expandedByRoute
  const listId = 'nav-esports-list'
  return (
    <div className="nav-group">
      <button type="button" className="nav-item nav-item--group" aria-expanded={expanded} aria-controls={listId} onClick={() => setUserOpen(!expanded)}>
        <ClipboardList size={18} aria-hidden="true" />
        <span className="nav-item__label">Esports team</span>
        {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
      {expanded ? (
        <ul id={listId} className="nav-sublist">
          {ESPORTS_PAGES.map((key) => (
            <li key={key}>
              <NavLink to={routes.esports(guildId, game, key)} className={({ isActive }) => `${navClass({ isActive })} nav-item--sub`}>
                {ESPORTS_ICONS[key]}
                {ESPORTS_PAGE_LABELS[key]}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function Sidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { state, logout } = useAuth()
  const { guildId, game, page, esportsPage } = parseLocation(pathname)
  const serverPage = parseServerPage(pathname)

  const guilds = useGuilds()
  const games = useGuildGames(guildId ?? undefined)

  const user = state.status === 'signed-in' ? state.user : null
  const guildList = guilds.status === 'ready' ? guilds.data : []
  const currentGuild = guildList.find((item) => item.id === guildId)
  // The five games are always listed and always selectable: the Esports team works for every one of them, enabled in Games & Tiers or not.
  const gameList = mergeGames(games.status === 'ready' ? games.data : [])
  const currentGame = gameList.find((item) => item.key === game)

  const serverItems: MenuItem[] = [
    ...guildList.map((item) => ({
      id: item.id,
      label: item.name,
      leading: <Avatar src={item.icon} name={item.name} size={24} shape="rounded" />,
      selected: item.id === guildId,
      onSelect: () => navigate(routes.games(item.id))
    })),
    ...(guildList.length > 0
      ? [{ id: '__all', label: 'All servers', leading: <ArrowLeftRight size={16} aria-hidden="true" />, onSelect: () => navigate(routes.servers) }]
      : [])
  ]

  const userItems: MenuItem[] = [
    { id: 'switch', label: 'Switch server', leading: <ArrowLeftRight size={16} aria-hidden="true" />, onSelect: () => navigate(routes.servers) },
    { id: 'logout', label: 'Log out', leading: <LogOut size={16} aria-hidden="true" />, danger: true, onSelect: logout }
  ]

  const hasServer = Boolean(guildId)
  const serverState = serverModuleState({ hasServer })
  const context = { hasServer, game: game ?? null, gameEnabled: Boolean(currentGame?.enabled) }
  const leagueState = leagueModuleState(context)
  const esportsState = esportsModuleState(context)

  const pickGame = (key: string): void => {
    if (!guildId) return
    // On an esports page every game has the same pages: stay on that page of the new game (its own data is read from scratch).
    if (page === 'esports') {
      navigate(routes.esports(guildId, key, esportsPage ?? 'teams'))
      return
    }
    // Stay on the same kind of page when the new game has it, otherwise open the game's home page.
    const keep = page && (key === 'f1' || !isLeaguePage(page)) ? page : gameHomePage(key)
    navigate(routes.game(guildId, key, keep))
  }

  return (
    <aside className="sidebar" aria-label="Main">
      <div className="sidebar__brand">
        <Logo size={32} />
        <span className="sidebar__wordmark">NEXUS</span>
      </div>

      <div className="sidebar__section">
        <span className="sidebar__label" id="server-switcher-label">
          Server
        </span>
        <MenuButton
          ariaLabel={currentGuild ? `Server: ${currentGuild.name}. Switch server` : 'Select a server'}
          items={serverItems}
          emptyText={guilds.status === 'loading' ? 'Loading servers' : 'No servers available'}
          className="menu--block"
        >
          {currentGuild ? <Avatar src={currentGuild.icon} name={currentGuild.name} size={28} shape="rounded" /> : null}
          <span className="menu__trigger-text">{currentGuild ? currentGuild.name : 'Select a server'}</span>
          <ChevronsUpDown size={16} aria-hidden="true" className="menu__chevron" />
        </MenuButton>
      </div>

      <nav className="sidebar__nav" aria-label="Server pages">
        {SERVER_PAGES.map((key) =>
          serverState.enabled && guildId ? (
            <NavLink key={key} to={routes.server(guildId, key)} className={navClass} aria-current={serverPage === key ? 'page' : undefined}>
              {SERVER_ICONS[key]}
              {SERVER_PAGE_LABELS[key]}
            </NavLink>
          ) : (
            <NavDisabled key={key} icon={SERVER_ICONS[key]} label={SERVER_PAGE_LABELS[key]} reason={serverState.reason ?? 'Not available.'} />
          )
        )}
      </nav>

      <div className="sidebar__section">
        <Select
          label="Game"
          value={game ?? ''}
          placeholder={guildId ? 'Select a game' : 'Choose a server first'}
          disabled={!guildId}
          options={gameList.map((item) => ({ value: item.key, label: item.label }))}
          onChange={pickGame}
        />
        {guildId ? <Link to={routes.games(guildId)}>All games</Link> : null}
      </div>

      <nav className="sidebar__nav sidebar__nav--modules" aria-label="Game modules">
        <LeagueGroup state={leagueState} guildId={guildId} game={game} expandedByRoute={isLeaguePage(page)} />
        {esportsState.enabled && guildId && game ? (
          <EsportsGroup guildId={guildId} game={game} expandedByRoute={page === 'esports'} />
        ) : (
          <NavDisabled icon={<ClipboardList size={18} aria-hidden="true" />} label={PAGE_LABELS.esports} reason={esportsState.reason ?? 'Not available.'} />
        )}
        {!leagueState.enabled ? <p className="sidebar__hint">{leagueState.reason}</p> : null}
        {game === 'f1' ? (
          <p className="sidebar__hint">
            <strong>League</strong> is the championship you organise yourself. <strong>Esports team</strong> is Formula 1 Esports: teams that race in external competitions. They never share teams, events or results.
          </p>
        ) : null}
      </nav>

      <div className="sidebar__footer">
        <StatusLine />
        {user ? (
          <MenuButton ariaLabel={`Account menu for ${user.username}`} items={userItems} placement="top" className="menu--block">
            <Avatar src={user.avatar} name={user.username} size={32} />
            <span className="menu__trigger-text">{user.username}</span>
            <ChevronsUpDown size={16} aria-hidden="true" className="menu__chevron" />
          </MenuButton>
        ) : null}
      </div>
    </aside>
  )
}
