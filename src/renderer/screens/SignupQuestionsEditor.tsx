import { ArrowDown, ArrowUp, ListRestart, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { validateQuestions } from '../../shared/attendanceValidation'
import type { SignupQuestion, SignupQuestions } from '../../shared/types'
import { Badge, Button, Card, ErrorState, LoadingRegion, Notice, Skeleton, TextField, useToast, WriteProblemNotice } from '../components'
import { useSignupQuestions } from '../hooks/data'
import { useAdminDenied } from '../hooks/useFiaDenied'
import { useWriteAction } from '../hooks/useWriteAction'
import { describeError, errorCode, unwrap, writeProblem } from '../lib/errors'
import type { WriteProblem } from '../lib/errors'
import { invalidateSignupQuestions } from '../lib/invalidation'
import { moveRow, questionLimits, questionsChanged, resetRows } from '../lib/signupView'

function QuestionList({ title, questions, note }: { title: string; questions: SignupQuestion[]; note?: string }) {
  return (
    <div className="stack stack--tight">
      <h3 className="section-title">{title}</h3>
      {note ? <p className="muted">{note}</p> : null}
      <ol className="plain-list">
        {questions.map((question) => (
          <li key={question.label}>
            {question.label} {question.required ? <span className="muted">(required)</span> : <span className="muted">(optional)</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Form({ guildId, data }: { guildId: string; data: SignupQuestions }) {
  const toast = useToast()
  const write = useWriteAction()
  const admin = useAdminDenied(guildId)
  const limits = questionLimits(data)
  const [rows, setRows] = useState<string[]>(() => [...data.questions])
  const [submitted, setSubmitted] = useState(false)
  const [problem, setProblem] = useState<WriteProblem | null>(null)
  const [serverText, setServerText] = useState<string | null>(null)
  const [resetNote, setResetNote] = useState(false)

  const readOnly = data.canEdit === false || admin.denied
  const check = validateQuestions(rows, limits.max, limits.length)
  const dirty = questionsChanged(rows, data.questions)

  const edit = (next: string[]): void => {
    setRows(next)
    setProblem(null)
    setServerText(null)
    setResetNote(false)
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitted(true)
    if (!check.ok || readOnly || !dirty) return
    setProblem(null)
    setServerText(null)
    const outcome = await write.run(() => unwrap(window.nexus.api.saveSignupQuestions(guildId, check.value)))
    if (!outcome) return
    if (outcome.ok) {
      invalidateSignupQuestions(guildId)
      toast.push({ tone: 'success', title: 'Sign-up questions saved', message: outcome.value.usingDefaults ? 'The default questions are used again.' : `${outcome.value.questions.length} custom ${outcome.value.questions.length === 1 ? 'question' : 'questions'}.` })
      return
    }
    const code = errorCode(outcome.error)
    if (code === 'admin_required') {
      admin.markDenied()
      setRows([...data.questions]) // read-only now: show what is really stored
      return
    }
    if (code === 'invalid_questions') setServerText(`${describeError(outcome.error)} Nothing was saved.`)
    else setProblem(writeProblem(outcome.error, 'The change'))
  }

  return (
    <form className="stack" onSubmit={(event) => void save(event)} noValidate aria-label="Sign-up questions">
      <Notice tone="info">
        These questions are asked by <strong>every sign-up form</strong> of this server, after the platform and platform username. With no custom question, the {data.defaultQuestions.length} default questions are asked. The answer to a question is stored under the question&apos;s text, which is why a
        question cannot contain a comma and two questions cannot start the same.
      </Notice>
      {readOnly ? (
        <Notice tone="danger" action={admin.denied ? <Button variant="secondary" size="sm" onClick={admin.reset}>Check again</Button> : undefined}>
          <strong>Only server Administrators can change the sign-up questions.</strong> Your account has the staff role only, so the form is read-only: you can see what is asked, not change it. {admin.denied ? 'If your permissions changed, choose Check again.' : ''}
        </Notice>
      ) : null}

      <Card className="stack">
        <div className="section-head">
          <h2 className="section-title">Custom questions</h2>
          {data.usingDefaults ? <Badge>Using the defaults</Badge> : <Badge tone="primary">Custom</Badge>}
        </div>
        <p className="muted">
          At most {limits.max} {limits.max === 1 ? 'question' : 'questions'} of {limits.length} characters each (Discord cuts a form label there). Leave the list empty to use the {data.defaultQuestions.length} defaults.
        </p>
        {rows.length === 0 ? <p className="muted">No custom question: the default questions below are asked.</p> : null}
        <ol className="question-rows">
          {rows.map((row, index) => (
            <li key={index} className="question-row">
              <TextField
                label={`Question ${index + 1}`}
                value={row}
                readOnly={readOnly}
                maxLength={limits.length}
                error={submitted || row.trim() !== '' ? (check.rows[index] ?? null) : null}
                autoComplete="off"
                onChange={(event) => edit(rows.map((item, position) => (position === index ? event.target.value : item)))}
              />
              <div className="question-row__actions">
                <Button variant="ghost" size="sm" iconOnly disabled={readOnly || index === 0} icon={<ArrowUp size={16} aria-hidden="true" />} aria-label={`Move question ${index + 1} up`} onClick={() => edit(moveRow(rows, index, index - 1))} />
                <Button variant="ghost" size="sm" iconOnly disabled={readOnly || index === rows.length - 1} icon={<ArrowDown size={16} aria-hidden="true" />} aria-label={`Move question ${index + 1} down`} onClick={() => edit(moveRow(rows, index, index + 1))} />
                <Button variant="ghost" size="sm" iconOnly disabled={readOnly} icon={<Trash2 size={16} aria-hidden="true" />} aria-label={`Remove question ${index + 1}`} onClick={() => edit(rows.filter((_, position) => position !== index))} />
              </div>
            </li>
          ))}
        </ol>
        {check.general && (submitted || rows.length > limits.max) ? (
          <p className="field__error" role="alert">
            {check.general}
          </p>
        ) : null}
        <div className="dialog-actions dialog-actions--start">
          <Button variant="secondary" size="sm" icon={<Plus size={14} aria-hidden="true" />} disabled={readOnly || rows.length >= limits.max} onClick={() => edit([...rows, ''])}>
            Add a question
          </Button>
          {rows.length >= limits.max ? <span className="muted">The limit of {limits.max} is reached.</span> : null}
        </div>
      </Card>

      {resetNote ? (
        <Notice tone="info">
          The form is empty now, which means <strong>the default questions will be used</strong>. <strong>Nothing is saved yet</strong>: press Save the questions to switch to the defaults, or Discard changes to go back.
        </Notice>
      ) : null}
      {serverText ? <Notice tone="danger">{serverText}</Notice> : null}
      <WriteProblemNotice problem={problem} onRefresh={() => invalidateSignupQuestions(guildId)} refreshLabel="Refresh" />

      <div className="form-actions form-actions--split">
        <div className="header-actions">
          <Button
            variant="ghost"
            disabled={!dirty || write.busy}
            icon={<RotateCcw size={16} aria-hidden="true" />}
            onClick={() => {
              setRows([...data.questions])
              setSubmitted(false)
              setProblem(null)
              setServerText(null)
              setResetNote(false)
            }}
          >
            Discard changes
          </Button>
          <Button
            variant="secondary"
            disabled={readOnly || write.busy || rows.length === 0}
            icon={<ListRestart size={16} aria-hidden="true" />}
            title="Empty the list so the default questions are used. Nothing is saved until you press Save."
            onClick={() => {
              setRows(resetRows())
              setSubmitted(false)
              setProblem(null)
              setServerText(null)
              setResetNote(true)
            }}
          >
            Reset to defaults
          </Button>
        </div>
        <Button type="submit" loading={write.busy} disabled={readOnly || !dirty} icon={<Save size={16} aria-hidden="true" />}>
          Save the questions
        </Button>
      </div>

      <Card className="division-grid">
        <QuestionList title="What the form asks now" questions={data.effectiveQuestions} note={data.usingDefaults ? 'The defaults, because no custom question is saved.' : 'Your custom questions.'} />
        <QuestionList title={`The ${data.defaultQuestions.length} default questions`} questions={data.defaultQuestions} note="Used when the list above is empty." />
      </Card>
    </form>
  )
}

export function SignupQuestionsEditor({ guildId }: { guildId: string }) {
  const questions = useSignupQuestions(guildId)
  if (questions.status === 'loading') {
    return (
      <LoadingRegion label="Loading the sign-up questions" className="stack">
        <Skeleton height={220} radius={12} />
      </LoadingRegion>
    )
  }
  if (questions.status === 'error') return <ErrorState title="Could not load the sign-up questions" message={describeError(questions.error)} onRetry={questions.reload} />
  // Rebuilt from what the server holds after every save and re-read.
  const key = JSON.stringify([questions.data.questions, questions.data.canEdit, questions.data.maxQuestions, questions.data.maxQuestionLength])
  return <Form key={key} guildId={guildId} data={questions.data} />
}
