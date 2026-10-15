/**
 * The long free-text limits of the app API: ONE constant per limit, copied from the table "Text limits" in
 * docs/APP_API.md ("Raised in this version"). Every validator, form, response parser and test takes its number from
 * here, never from a literal. When the docs change, change the number here and nowhere else.
 *
 * Counting (docs/APP_API.md, "Text limits"): one Unicode character is 1 (an emoji counts 1) and the text is trimmed
 * first. For the fields marked ✱ in the docs the bot shows the text with Discord markdown escaped, so every `_`
 * counts as 2 (see `escapedLength` in validation.ts).
 */
export const TEXT_LIMITS = {
  /** `notes` of POST /racing/{game}/events ✱: the 1024-character Discord field minus date, time and class (113). */
  eventNotes: 911,
  /** `notes` of POST /racing/{game}/results ✱: the 1014 below minus `result` (100) and `drivers` (200). */
  resultNotes: 714,
  /** `result` + `drivers` + `notes` of POST /racing/{game}/results together ✱: one 1024-character Discord field minus 10 of layout. */
  resultCombined: 1014,
  /** `description` of POST /racing/{game}/attendance: the embed's 6000 minus the rest of the post in its worst case. */
  racingAttendanceDescription: 3645,
  /** `description` of POST /f1/attendance/posts: the same reasoning for the F1 post. */
  f1AttendanceDescription: 2520,
  /** `description` of POST /league/signups: Discord's embed-description limit. */
  signupDescription: 4096,
  /** `reason` of POST /f1/penalties/points ✱: one field of the Stewards Decision embed. */
  penaltyPointsReason: 1024,
  /** `reason` of POST /f1/penalties/clear: stored only, never posted. */
  penaltyClearReason: 4000,
  /** `explanation` of POST /f1/reports/{id}/decision ✱: one field of the report embed. */
  decisionExplanation: 1024,
  /** `description` of POST /f1/reports/{id}/decision ✱: one field of the report embed. */
  decisionDescription: 1024
} as const

/**
 * The room a response parser needs for a text of `characters` Unicode characters: `String.slice` counts UTF-16 units and an
 * emoji is two of them, so a parser that cuts at `characters` would cut a legal text that is full of emoji.
 */
export const utf16Units = (characters: number): number => characters * 2

/** Where the limit comes from, in one short sentence for the form (the number itself is shown by the counter). */
export const LIMIT_NOTES = {
  discordField: 'The limit comes from Discord: this text is shown in one field of a Discord message.',
  discordEmbed: 'The limit comes from Discord: this text is shown in one Discord embed, which has a size limit.',
  discordDescription: 'The limit comes from Discord: this is the most an embed description can hold.',
  stored: 'The limit is the most the server stores for this text. It is not posted to Discord.'
} as const
/** Added to the note of every field whose underscores count twice (✱ in the docs). */
export const UNDERSCORE_NOTE = 'Each underscore counts as 2.'
