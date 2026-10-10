import { Pencil, Plus, RotateCw, Users } from 'lucide-react'
import { useState } from 'react'
import { findOverlap } from '../../shared/attendanceValidation'
import type { AttendanceDivision, AttendanceDriver, AttendancePostResult } from '../../shared/types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRegion, Notice, PageHeader, Skeleton, Tabs, tabPanelProps } from '../components'
import { useAttendanceDivisions } from '../hooks/data'
import { describeError, errorCode } from '../lib/errors'
import { plural } from '../lib/format'
import { invalidateAttendance } from '../lib/invalidation'
import { DRIVERS_TOGGLE_THEMSELVES, PostCreatedDialog, PostDetail, PostDialog, PostsList } from './AttendancePosts'
import { DivisionDialog } from './DivisionDialog'
import { F1Only } from './F1Only'
import { useLeague } from './LeagueRoute'

type TabId = 'divisions' | 'posts'

function DriverNames({ drivers }: { drivers: AttendanceDriver[] }) {
  if (drivers.length === 0) return <p className="muted">Nobody.</p>
  return (
    <ul className="name-list">
      {drivers.map((driver) => (
        <li key={driver.userId}>
          <span>{driver.name ?? 'A member who left the server'}</span>
          {!driver.inServer ? <Badge>Left the server</Badge> : null}
        </li>
      ))}
    </ul>
  )
}

function readProblem(error: unknown): string {
  return errorCode(error) === 'forbidden' ? 'You no longer have the FIA, STAFF or Administrator role in this server, so attendance cannot be read.' : describeError(error)
}

function AttendanceScreen() {
  const { guild } = useLeague()
  const divisions = useAttendanceDivisions(guild.id)
  const [tab, setTab] = useState<TabId>('divisions')
  const [editing, setEditing] = useState<AttendanceDivision | 'new' | null>(null)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<AttendancePostResult | null>(null)
  const [post, setPost] = useState<string | null>(null)

  const data = divisions.status === 'ready' ? divisions.data : null
  const list = data?.divisions ?? []

  return (
    <div className="page">
      <PageHeader
        title="Attendance"
        description={`${guild.name} - divisions and attendance posts`}
        actions={
          <div className="header-actions">
            <Button variant="ghost" size="sm" icon={<RotateCw size={14} aria-hidden="true" />} loading={divisions.status === 'ready' && divisions.refreshing === true} onClick={() => invalidateAttendance(guild.id)}>
              Refresh
            </Button>
          </div>
        }
      />
      <Notice tone="info">{DRIVERS_TOGGLE_THEMSELVES}</Notice>

      {post !== null ? (
        <PostDetail key={post} guildId={guild.id} messageId={post} onBack={() => setPost(null)} />
      ) : (
        <>
          <Tabs
            label="Attendance"
            idPrefix="attendance"
            active={tab}
            onChange={(id) => setTab(id as TabId)}
            tabs={[
              { id: 'divisions', label: 'Divisions', badge: data ? list.length : undefined },
              { id: 'posts', label: 'Posts' }
            ]}
          />

          {tab === 'divisions' ? (
            <div {...tabPanelProps('attendance', 'divisions')} className="stack">
              <div className="section-head">
                <p className="muted">Like <code>/f1 attendance-setup</code>. A division has regular drivers (marked Present automatically) and reserve drivers (they can only use Reserve).</p>
                <Button icon={<Plus size={16} aria-hidden="true" />} disabled={divisions.status !== 'ready'} onClick={() => setEditing('new')}>
                  Create a division
                </Button>
              </div>
              {divisions.status === 'loading' ? (
                <LoadingRegion label="Loading the divisions" className="stack">
                  <Skeleton height={140} radius={12} />
                  <Skeleton height={140} radius={12} />
                </LoadingRegion>
              ) : null}
              {divisions.status === 'error' ? <ErrorState title="Could not load the divisions" message={readProblem(divisions.error)} onRetry={divisions.reload} /> : null}
              {data && data.legacy ? (
                <Notice tone="info">
                  This server still has the older, division-less lists ({plural(data.legacy.regularDrivers.length, 'regular driver')}, {plural(data.legacy.reserveDrivers.length, 'reserve driver')}). Posts made before divisions existed keep reading them, and editing the <strong>Main</strong> division does not change them. They
                  can only be changed in Discord.
                </Notice>
              ) : null}
              {data && list.length === 0 ? (
                <EmptyState
                  icon={<Users size={24} aria-hidden="true" />}
                  title="No divisions yet"
                  description="Create a division with its regular and reserve drivers. An attendance post is always made for a division."
                  action={
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing('new')}>
                      Create the first division
                    </Button>
                  }
                />
              ) : null}
              {list.map((division) => {
                const overlap = findOverlap(
                  division.regularDrivers.map((driver) => driver.userId),
                  division.reserveDrivers.map((driver) => driver.userId)
                )
                return (
                  <Card key={division.name} className="stack">
                    <div className="section-head">
                      <h2>{division.name}</h2>
                      <div className="header-actions">
                        {overlap.length > 0 ? <Badge tone="danger">{plural(overlap.length, 'driver')} in both lists</Badge> : null}
                        <Button variant="secondary" size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing(division)} aria-label={`Edit the division ${division.name}`}>
                          Edit
                        </Button>
                      </div>
                    </div>
                    <div className="division-grid">
                      <div className="stack stack--tight">
                        <h3 className="section-title">Regular drivers ({division.regularDrivers.length})</h3>
                        <DriverNames drivers={division.regularDrivers} />
                      </div>
                      <div className="stack stack--tight">
                        <h3 className="section-title">Reserve drivers ({division.reserveDrivers.length})</h3>
                        <DriverNames drivers={division.reserveDrivers} />
                      </div>
                    </div>
                    {overlap.length > 0 ? (
                      <Notice tone="warning">
                        {overlap.map((id) => [...division.regularDrivers, ...division.reserveDrivers].find((driver) => driver.userId === id)?.name ?? 'A member who left').join(', ')} {overlap.length === 1 ? 'is' : 'are'} in both lists: marked Present when a post is created, then refused by the Present button in Discord. Edit the division to fix it.
                      </Notice>
                    ) : null}
                  </Card>
                )
              })}
              {data ? <p className="muted">A division cannot be deleted or renamed: no command does it, so the API has no endpoint. To change one, edit its lists (or empty them).</p> : null}
            </div>
          ) : (
            <div {...tabPanelProps('attendance', 'posts')} className="stack">
              <div className="section-head">
                <p className="muted">Newest first. Open a post to see who is present, absent or on reserve, by name.</p>
                <Button icon={<Plus size={16} aria-hidden="true" />} disabled={divisions.status !== 'ready'} onClick={() => setCreating(true)}>
                  Create attendance post
                </Button>
              </div>
              <PostsList guildId={guild.id} divisions={list} onOpen={setPost} onCreate={() => setCreating(true)} />
            </div>
          )}
        </>
      )}

      {editing !== null ? <DivisionDialog guildId={guild.id} division={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {creating ? (
        <PostDialog
          guildId={guild.id}
          divisions={list}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false)
            setCreated(result)
          }}
        />
      ) : null}
      {created ? (
        <PostCreatedDialog
          guildId={guild.id}
          result={created}
          onClose={() => setCreated(null)}
          onView={(messageId) => {
            setCreated(null)
            setTab('posts')
            setPost(messageId)
          }}
        />
      ) : null}
    </div>
  )
}

export function Attendance() {
  return (
    <F1Only page="attendance">
      <AttendanceScreen />
    </F1Only>
  )
}
