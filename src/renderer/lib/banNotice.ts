import { ANNOUNCEMENT_LIMITS } from '../../shared/validation'

/**
 * The ban text of manual penalty points is returned by the server and NOT posted ("Nothing has been announced in
 * Discord"). The user may post it as an announcement through the server-level announcement endpoint. That endpoint escapes
 * underscores itself, so the backslashes the ban text already carries (`Max\_V`) are taken out first, otherwise the name
 * would be escaped twice.
 */
export const BAN_ANNOUNCEMENT_TITLE = 'Penalty ban notice'

export function announcementTextOf(notice: string): string {
  return notice.replace(/\\([\\_*~`|>])/g, '$1').trim()
}

export function banAnnouncementDraft(notice: string): { title: string; message: string } {
  return { title: BAN_ANNOUNCEMENT_TITLE, message: announcementTextOf(notice).slice(0, ANNOUNCEMENT_LIMITS.messageMax) }
}
