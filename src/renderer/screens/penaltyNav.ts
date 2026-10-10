import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { routes } from '../lib/routes'
import { useLeague } from './LeagueRoute'

/** The tab ids of the Penalties screen that other screens link to. */
export const PENALTY_TAB_QUERY = 'tab'

/** Opens Penalties on its Settings tab (where the penalty rules are set up; saving them needs the Administrator permission). */
export function useOpenPenaltySettings(): () => void {
  const { guild, game } = useLeague()
  const navigate = useNavigate()
  return useCallback(() => navigate(`${routes.game(guild.id, game.key, 'penalties')}?${PENALTY_TAB_QUERY}=settings`), [navigate, guild.id, game.key])
}
