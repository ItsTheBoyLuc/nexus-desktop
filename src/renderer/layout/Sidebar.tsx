import { ArrowLeftRight, CalendarDays, ChevronsUpDown, FileWarning, LayoutDashboard, LogOut, Megaphone, Trophy, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Avatar, Logo, Select } from '../components'
import { MenuButton } from '../components/MenuButton'
import type { MenuItem } from '../components/MenuButton'
import { StatusLine } from '../components/StatusLine'
import { useAuth } from '../hooks/auth'
import { useGuildGames, useGuilds } from '../hooks/data'
import { PAGE_LABELS, PAGES, parseLocation, routes } from '../lib/routes'
import type { PageKey } from '../lib/routes'

const PAGE_ICONS: Record<PageKey, ReactNode> = {
  overview: <LayoutDashboard size={18} aria-hidden="true" />,
  calendar: <CalendarDays size={18} aria-hidden="true" />,
  reports: <FileWarning size={18} aria-hidden="true" />,
  standings: <Trophy size={18} aria-hidden="true" />,
  teams: <Users size={18} aria-hidden="true" />,
  announcement: <Megaphone size={18} aria-hidden="true" />
}

export function Sidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { state, logout } = useAuth()
  const { guildId, game, page } = parseLocation(pathname)

  const guilds = useGuilds()
  const games = useGuildGames(guildId ?? undefined)

  const user = state.status === 'signed-in' ? state.user : null
  const guildList = guilds.status === 'ready' ? guilds.data : []
  const currentGuild = guildList.find((item) => item.id === guildId)
  const gameList = games.status === 'ready' ? games.data : []

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

  const navigationReady = Boolean(guildId && game)

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

      <div className="sidebar__section">
        <Select
          label="Game"
          value={game ?? ''}
          placeholder={guildId ? 'Select a game' : 'Choose a server first'}
          disabled={!guildId || games.status !== 'ready'}
          options={gameList.map((item) => ({
            value: item.key,
            label: item.enabled ? item.label : `${item.label} (not set up)`,
            disabled: !item.enabled
          }))}
          onChange={(key) => guildId && navigate(routes.league(guildId, key, page ?? 'overview'))}
        />
      </div>

      <nav className="sidebar__nav" aria-label="League">
        {PAGES.map((key) =>
          navigationReady && guildId && game ? (
            <NavLink key={key} to={routes.league(guildId, game, key)} className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}>
              {PAGE_ICONS[key]}
              {PAGE_LABELS[key]}
            </NavLink>
          ) : (
            <span key={key} className="nav-item nav-item--disabled" aria-disabled="true">
              {PAGE_ICONS[key]}
              {PAGE_LABELS[key]}
            </span>
          )
        )}
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
