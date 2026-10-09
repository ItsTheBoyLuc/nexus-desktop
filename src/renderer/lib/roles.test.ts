import { describe, expect, it } from 'vitest'
import { describeRoleChoice } from './roles'

describe('role picker rules', () => {
  const plain = { managed: false, assignable: true, privileged: false }

  it('an ordinary role is selectable without a remark', () => {
    expect(describeRoleChoice(plain)).toEqual({ disabled: false, description: undefined, badge: undefined })
  })

  it('bot / integration roles and roles above the bot cannot be picked, and say why', () => {
    expect(describeRoleChoice({ ...plain, managed: true, assignable: false })).toMatchObject({ disabled: true, badge: 'Bot role' })
    expect(describeRoleChoice({ ...plain, assignable: false })).toMatchObject({ disabled: true, badge: 'Too high', description: expect.stringContaining('highest role') })
  })

  it('an admin-level role can be picked (the backend decides by the caller) but is flagged', () => {
    const choice = describeRoleChoice({ ...plain, privileged: true })
    expect(choice).toMatchObject({ disabled: false, badge: 'Admin-level' })
    expect(choice.description).toContain('Administrator')
  })

  it('a role that is both too high and admin-level is simply unavailable', () => {
    expect(describeRoleChoice({ ...plain, assignable: false, privileged: true }).disabled).toBe(true)
  })
})
