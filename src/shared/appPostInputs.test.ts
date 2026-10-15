import { describe, expect, it } from 'vitest'
import { parseAppPostChannel, parseAppPostRef } from './appPostInputs'

/** Milestone 7: what the main process lets through from the renderer for the posts made with the app: Discord ids, nothing else. */
const CH = '777000000000000001'
const MSG = '600000000000000001'

describe('app post ids from the renderer', () => {
  it('accepts a channel id and a channel + message pair', () => {
    expect(parseAppPostChannel(CH)).toEqual({ ok: true, value: CH })
    expect(parseAppPostRef(CH, MSG)).toEqual({ ok: true, value: { channelId: CH, messageId: MSG } })
  })

  it.each([undefined, null, 5, {}, [], '', 'general', '#general', '../x', `${CH}/x`, '0', ' 123456789012345678', 'https://discord.com/channels/1/2/3'])('refuses %j as a channel', (value) => {
    expect(parseAppPostChannel(value).ok).toBe(false)
    expect(parseAppPostRef(value, MSG).ok).toBe(false)
  })

  it.each([undefined, null, 5, {}, '', 'abc', '../x', `${MSG}/..`, 'Round 3 starts', 'https://discord.com/channels/1/2/3'])('refuses %j as a message', (value) => {
    expect(parseAppPostRef(CH, value).ok).toBe(false)
  })

  it('takes nothing else along: a title, a link or a team cannot be passed in place of the ids', () => {
    const parsed = parseAppPostRef(CH, MSG)
    expect(parsed.ok && Object.keys(parsed.value).sort()).toEqual(['channelId', 'messageId'])
  })
})
