import type { Role } from '../../shared/types'

export interface RoleChoice {
  /** Cannot be picked at all. */
  disabled: boolean
  /** Why it is disabled, or a caution for roles that can be picked. */
  description: string | undefined
  badge: string | undefined
}

/**
 * How a role appears in the tier role picker. The backend refuses @everyone (not listed), bot or
 * integration roles (`managed`) and roles above the bot (`!assignable`); a role with admin-level
 * permissions (`privileged`) can be picked but only a server Administrator may link it. Showing this
 * up front saves a round trip; the backend still decides (403 role_too_privileged and friends).
 */
export function describeRoleChoice(role: Pick<Role, 'managed' | 'assignable' | 'privileged'>): RoleChoice {
  if (role.managed) return { disabled: true, description: 'Managed by a bot or integration, so it cannot be used.', badge: 'Bot role' }
  if (!role.assignable) return { disabled: true, description: "Above the bot's highest role, so Nexus cannot hand it out.", badge: 'Too high' }
  if (role.privileged) return { disabled: false, description: 'Has admin-level permissions: only a server Administrator can link it.', badge: 'Admin-level' }
  return { disabled: false, description: undefined, badge: undefined }
}
