/** "Waking up the server" with three softly pulsing dots (the free server sleeps when idle and needs up to a minute). */
export function WakingNote() {
  return (
    <p className="waking" role="status">
      Waking up the server
      <span className="waking__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </p>
  )
}
