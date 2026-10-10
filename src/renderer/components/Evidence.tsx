import { Copy, ExternalLink, ImageOff } from 'lucide-react'
import { useState } from 'react'
import { evidenceImage, httpsUrl } from '../lib/reportView'
import { Button } from './Button'
import { useToast } from './Toast'

/** Copies plain text through the main process and says so (or says it did not work). */
export function CopyButton({ text, label = 'Copy', what = 'Text' }: { text: string; label?: string; what?: string }) {
  const toast = useToast()
  const copy = async (): Promise<void> => {
    const done = await window.nexus.system.copyText(text).catch(() => false)
    toast.push(done ? { tone: 'success', title: 'Copied', message: `${what} is on your clipboard.` } : { tone: 'danger', title: 'Not copied', message: 'The text could not be copied. Select it and copy it by hand.' })
  }
  return (
    <Button variant="secondary" size="sm" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void copy()}>
      {label}
    </Button>
  )
}

/**
 * An evidence link, shown as plain text. It can be opened only when it is an https link, and then only through the
 * app's allowlist (the main process refuses every other host): when it refuses, the user is told and can copy the link.
 * A link that is not https is never made clickable.
 */
export function EvidenceLink({ url, label = 'Open link' }: { url: string; label?: string }) {
  const toast = useToast()
  const safe = httpsUrl(url)

  const open = async (): Promise<void> => {
    if (safe === null) return
    const opened = await window.nexus.system.openExternal(safe).catch(() => false)
    if (!opened) {
      toast.push({
        tone: 'danger',
        title: 'Link not opened',
        message: 'The app only opens links to discord.com and its own pages. Copy the link and open it in your browser yourself.'
      })
    }
  }

  return (
    <div className="evidence">
      <p className="evidence__url">{url}</p>
      <div className="evidence__actions">
        {safe !== null ? (
          <Button variant="secondary" size="sm" icon={<ExternalLink size={14} aria-hidden="true" />} onClick={() => void open()}>
            {label}
          </Button>
        ) : null}
        <CopyButton text={url} label="Copy link" what="The link" />
      </div>
      {safe === null ? <p className="muted">This is not an https link, so it cannot be opened from the app. It is shown as text only.</p> : null}
    </div>
  )
}

/**
 * An evidence image. Only an https image on Discord's CDN is rendered (the app's content security policy allows no other
 * image source); an image on another https host is offered as a link, and anything that is not https is never rendered.
 */
export function EvidenceImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  const image = evidenceImage(url)

  if (image.kind === 'none') return null
  if (image.kind === 'inline' && !failed) {
    return (
      <figure className="evidence-image">
        <img src={image.src} alt="Evidence attached to the report" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      </figure>
    )
  }
  return (
    <div className="evidence-image evidence-image--missing">
      <ImageOff size={20} aria-hidden="true" />
      <div className="stack stack--tight">
        <p>
          {image.kind === 'inline'
            ? 'The evidence image could not be loaded (it may have been deleted in Discord).'
            : image.kind === 'link-only'
              ? 'The evidence image is hosted outside Discord, so the app does not load it. Open or copy the link instead.'
              : 'The evidence image link is not an https link, so the app does not load or open it.'}
        </p>
        {image.kind === 'link-only' ? <EvidenceLink url={image.url} label="Open image link" /> : <p className="evidence__url">{url}</p>}
      </div>
    </div>
  )
}
