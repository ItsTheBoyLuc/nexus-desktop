import { RotateCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { AppPost } from '../../shared/types'
import { Button, Card, EmptyState, ExternalLink, LoadingRegion, Notice, SearchSelect, Skeleton } from '../components'
import { useAppPosts, useGuildChannels } from '../hooks/data'
import { useManageDenied } from '../hooks/useFiaDenied'
import { APP_POSTS_KIND_TEXT, APP_POSTS_SCOPE_TEXT, channelLabel, DELETE_PERMISSION_TEXT, describeAppPostError, invalidateAppPosts } from '../lib/appPosts'
import { formatWhen, plural } from '../lib/format'
import { discordMessageLink, MANAGE_SERVER_RULE } from '../lib/racingView'
import { DeleteAppPostDialog } from './DeleteAppPostDialog'

interface Props {
  guild: { id: string; name: string }
  /** The channel whose posts are listed ('' = none chosen yet: nothing is read from Discord until the user picks one). */
  channelId: string
  onChannelChange: (channelId: string) => void
}

/**
 * "Recent posts made with the app" (milestone 7): pick a channel, read the app posts among its last 100 messages from Discord, and delete
 * one after a confirmation. Used by the Announcement screen of the server and the one of every game. The list is read only when a channel is
 * chosen (it counts towards a Discord read limit) and lives in memory only: nothing about a post is stored on this computer.
 * Every title comes from Discord and is shown as plain text.
 */
export function AppPostsSection({ guild, channelId, onChannelChange }: Props) {
  const channels = useGuildChannels(guild.id)
  const posts = useAppPosts(guild.id, channelId === '' ? null : channelId)
  const manage = useManageDenied(guild.id)
  const [deleting, setDeleting] = useState<AppPost | null>(null)

  const channelList = channels.status === 'ready' ? channels.data : []
  const channelName = channelList.find((channel) => channel.id === channelId)?.name ?? ''
  const refreshing = posts.status === 'ready' && posts.refreshing === true

  return (
    <Card className="stack">
      <div>
        <h2>Recent posts made with the app</h2>
        <p className="muted">
          {APP_POSTS_SCOPE_TEXT} {APP_POSTS_KIND_TEXT}
        </p>
      </div>
      <SearchSelect
        label="Channel"
        value={channelId}
        options={channelList.map((channel) => ({ value: channel.id, label: `# ${channel.name}` }))}
        placeholder={channels.status === 'loading' ? 'Loading channels' : 'Search channels'}
        hint="The posts are read from Discord when you choose a channel. Nothing is kept on this computer."
        emptyText="No channel found."
        disabled={channels.status !== 'ready'}
        onChange={onChannelChange}
      />
      {channels.status === 'error' ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={channels.reload}>Try again</Button>}>
          Could not load the channels.
        </Notice>
      ) : null}
      {manage.denied ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" onClick={manage.reset}>Check again</Button>}>
          {MANAGE_SERVER_RULE} The posts stay readable. If your permissions changed, choose Check again.
        </Notice>
      ) : (
        <p className="muted">{DELETE_PERMISSION_TEXT}</p>
      )}

      {channelId === '' ? <p className="muted">Choose a channel to see the posts Nexus made there.</p> : null}
      {channelId !== '' && posts.status === 'loading' ? (
        <LoadingRegion label="Reading the channel in Discord">
          <div className="stack stack--tight">
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        </LoadingRegion>
      ) : null}
      {posts.status === 'error' ? (
        <Notice tone="danger" action={<Button variant="secondary" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} onClick={posts.reload}>Try again</Button>}>
          Could not read the posts. {describeAppPostError(posts.error, 'list')}
        </Notice>
      ) : null}
      {posts.status === 'ready' && posts.data.posts.length === 0 ? (
        <EmptyState
          title={`No post made with the app in ${channelLabel(channelName)}`}
          description="There is none among the last 100 messages of this channel. A post further back is not found here, but it still exists in Discord."
          action={
            <Button variant="secondary" icon={<RotateCw size={16} aria-hidden="true" />} loading={refreshing} onClick={() => invalidateAppPosts(guild.id, channelId)}>
              Refresh list
            </Button>
          }
        />
      ) : null}
      {posts.status === 'ready' && posts.data.posts.length > 0 ? (
        <div className="stack stack--tight">
          <div className="table-wrap">
            <table className="table" aria-describedby="app-posts-count">
              <caption className="sr-only">Posts made with the app in {channelLabel(channelName)}, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Posted</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {posts.data.posts.map((post) => (
                  <tr key={post.messageId}>
                    <th scope="row" className="table__key plain-text">
                      {post.title === '' ? <span className="muted">No title</span> : post.title}
                    </th>
                    <td>{formatWhen(post.postedAt)}</td>
                    <td>
                      <div className="row-actions">
                        <ExternalLink href={discordMessageLink(guild.id, post.channelId, post.messageId)}>Open in Discord</ExternalLink>
                        <Button
                          variant="ghost"
                          size="sm"
                          destructive
                          disabled={manage.denied}
                          icon={<Trash2 size={16} aria-hidden="true" />}
                          aria-label={`Delete the post ${post.title === '' ? 'without a title' : post.title}`}
                          title={manage.denied ? 'Needs the Manage Server permission' : 'Delete this post from Discord'}
                          onClick={() => setDeleting(post)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-actions dialog-actions--start">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={refreshing} onClick={() => invalidateAppPosts(guild.id, channelId)}>
              Refresh list
            </Button>
            <p className="muted table-count" id="app-posts-count" aria-live="polite">
              {plural(posts.data.posts.length, 'post')} found among the last 100 messages.
            </p>
          </div>
        </div>
      ) : null}

      {deleting ? (
        <DeleteAppPostDialog
          guildId={guild.id}
          guildName={guild.name}
          post={{ channelId: deleting.channelId, messageId: deleting.messageId, title: deleting.title }}
          channelName={channelName}
          onCancel={() => setDeleting(null)}
          onDeleted={() => setDeleting(null)}
          onRefresh={() => setDeleting(null)}
        />
      ) : null}
    </Card>
  )
}
