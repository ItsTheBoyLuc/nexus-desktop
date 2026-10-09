import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { LeagueGame, Role, Tier, TierUpdateInput } from '../../shared/types'
import { KEY_LIMIT, TIER_LIMITS, validateTierDraft } from '../../shared/validation'
import type { TierField } from '../../shared/validation'
import { Button, Modal, Notice, SearchSelect, Skeleton, TextField, useToast } from '../components'
import type { SearchOption } from '../components'
import { useGuildRoles } from '../hooks/data'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, describeWriteError, errorCode, mayHaveSucceeded, unwrap } from '../lib/errors'
import { invalidateLeagueData } from '../lib/invalidation'
import { describeRoleChoice } from '../lib/roles'

/** Backend codes that are about the chosen role: shown under the role picker, where the user can fix them. */
const ROLE_CODES = new Set(['role_too_privileged', 'role_not_assignable', 'invalid_role', 'role_not_found'])

/** One row of the role picker; the rules live in lib/roles.ts. */
export function roleOption(role: Role): SearchOption {
  const choice = describeRoleChoice(role)
  return {
    value: role.id,
    label: role.name,
    disabled: choice.disabled,
    description: choice.description,
    badge: choice.badge,
    leading: <span className="color-dot" style={{ background: role.color ?? '#555555' }} aria-hidden="true" />
  }
}

interface TierDialogProps {
  guildId: string
  game: LeagueGame
  /** Present = edit this tier; absent = create a new one. */
  tier?: Tier
  onClose: () => void
}

export function TierDialog({ guildId, game, tier, onClose }: TierDialogProps) {
  const roles = useGuildRoles(guildId)
  const toast = useToast()
  const write = useWriteAction()
  const creating = tier === undefined

  const [draft, setDraft] = useState({ tierKey: tier?.key ?? '', roleId: tier?.roleId ?? '', pointsSystem: tier?.pointsSystem ?? '' })
  const [submitted, setSubmitted] = useState(false)
  const [roleProblem, setRoleProblem] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ text: string; uncertain: boolean } | null>(null)

  const checked = validateTierDraft(draft, creating)
  const errors: Partial<Record<TierField, string>> = checked.ok ? {} : checked.errors
  const roleList = roles.status === 'ready' ? roles.data : []
  const currentRoleMissing = !creating && roles.status === 'ready' && !roleList.some((role) => role.id === tier.roleId)

  // What an edit would send: only the fields that differ from what the server has.
  const update: TierUpdateInput = {}
  if (checked.ok && tier) {
    if (checked.value.roleId !== tier.roleId) update.roleId = checked.value.roleId
    if ((checked.value.pointsSystem ?? null) !== tier.pointsSystem) update.pointsSystem = checked.value.pointsSystem ?? null
  }
  const changed = creating || Object.keys(update).length > 0

  const set = (field: keyof typeof draft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setProblem(null)
    if (field === 'roleId') setRoleProblem(null)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!checked.ok || !changed) return
    setProblem(null)
    setRoleProblem(null)
    const value = checked.value
    const outcome = await write.run(() =>
      tier
        ? unwrap(window.nexus.api.updateTier(guildId, game.key, tier.key, update))
        : unwrap(window.nexus.api.createTier(guildId, game.key, value))
    )
    if (!outcome) return
    if (outcome.ok) {
      invalidateLeagueData(guildId)
      toast.push({ tone: 'success', title: creating ? 'Tier created' : 'Tier saved', message: `${creating ? value.tierKey : tier.key} in ${game.label}.` })
      onClose()
      return
    }
    const code = errorCode(outcome.error)
    if (code && ROLE_CODES.has(code)) setRoleProblem(describeError(outcome.error))
    else setProblem({ text: describeWriteError(outcome.error, creating ? 'The tier' : 'The change'), uncertain: mayHaveSucceeded(outcome.error) })
  }

  return (
    <Modal open title={creating ? `Add a tier to ${game.label}` : `Edit tier ${tier.key}`} dismissible={!write.busy} onClose={onClose}>
      <form className="stack stack--tight" onSubmit={(event) => void submit(event)} noValidate aria-label={creating ? 'New tier' : 'Edit tier'}>
        {creating ? (
          <TextField
            label="Tier key"
            value={draft.tierKey}
            maxLength={KEY_LIMIT}
            hint="Short name, 1-20 letters, digits or underscores. It cannot be changed later."
            error={submitted ? (errors.tierKey ?? null) : null}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => set('tierKey', event.target.value)}
          />
        ) : (
          <p className="muted">
            Tier key <code>{tier.key}</code> cannot be changed. To use another key, remove the tier and add it again.
          </p>
        )}

        {roles.status === 'loading' ? <Skeleton height={64} /> : null}
        {roles.status === 'error' ? (
          <Notice
            tone="danger"
            action={
              <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={roles.reload}>
                Try again
              </Button>
            }
          >
            Could not load the roles. {describeError(roles.error)}
          </Notice>
        ) : null}
        {roles.status === 'ready' ? (
          <SearchSelect
            label="Discord role"
            value={draft.roleId}
            options={roleList.map(roleOption)}
            placeholder="Search for a role"
            emptyText="This server has no roles Nexus can see."
            hint={
              currentRoleMissing
                ? 'The role linked to this tier no longer exists in Discord. Pick another one.'
                : 'Members who click Join on the sign-up panel get this role. Only roles that already exist can be linked.'
            }
            error={roleProblem ?? (submitted ? (errors.roleId ?? null) : null)}
            onChange={(value) => set('roleId', value)}
          />
        ) : null}

        <TextField
          label="Points system"
          optional
          value={draft.pointsSystem}
          maxLength={TIER_LIMITS.pointsSystemMax}
          hint="A name for the points table this tier uses, for example F1 2025."
          error={submitted ? (errors.pointsSystem ?? null) : null}
          autoComplete="off"
          onChange={(event) => set('pointsSystem', event.target.value)}
        />

        {problem ? (
          <Notice
            tone="danger"
            action={
              problem.uncertain ? (
                <Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={() => invalidateLeagueData(guildId)}>
                  Refresh
                </Button>
              ) : undefined
            }
          >
            {problem.text}
          </Notice>
        ) : null}

        <div className="dialog-actions">
          <Button variant="secondary" disabled={write.busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={write.busy} disabled={roles.status !== 'ready' || !changed}>
            {creating ? 'Add tier' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
