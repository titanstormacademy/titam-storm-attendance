import { useRef, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Box, Button, Grid, Group, Menu, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconBallBasketball, IconCalendarPlus, IconClock, IconDots, IconEdit, IconList, IconPlus, IconTrash, IconUsers } from '@tabler/icons-react'
import { deleteClass, generateSessions, saveClass } from '../lib/api'
import { deleteSession, getClassSessions, saveSession } from '../lib/sessionOperations'
import { EmptyState, PageHeader } from '../components/ui'
import { useNavigationGuard } from '../contexts/useNavigationGuard'
import type { AcademyClass, BootstrapData, Session } from '../types/models'

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const blankClass: Partial<AcademyClass> & { label: string; day_of_week: string } = { label: '', day_of_week: 'Saturday', start_time: '09:00', end_time: '10:30', coach_id: null }

export function ClassesPage({ branchId, data, onChanged }: { branchId: number; data: BootstrapData; onChanged: () => Promise<unknown> }) {
  const [formOpened, formModal] = useDisclosure(false)
  const [generateOpened, generateModal] = useDisclosure(false)
  const [sessionsOpened, sessionsModal] = useDisclosure(false)
  const [sessionFormOpened, sessionFormModal] = useDisclosure(false)
  const [form, setForm] = useState(blankClass)
  const [target, setTarget] = useState<AcademyClass | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionForm, setSessionForm] = useState<{ id?: number; session_date: string; notes: string; coach_id: number | null }>({ session_date: dayjs().format('YYYY-MM-DD'), notes: '', coach_id: null })
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'))
  const [toDate, setToDate] = useState(dayjs().add(3, 'month').endOf('month').format('YYYY-MM-DD'))
  const [saving, setSaving] = useState(false)
  const [formBaseline, setFormBaseline] = useState('')
  const [sessionBaseline, setSessionBaseline] = useState('')
  const [generatorBaseline, setGeneratorBaseline] = useState('')
  const dirty = (formOpened && JSON.stringify(form) !== formBaseline) || (sessionFormOpened && JSON.stringify(sessionForm) !== sessionBaseline) || (generateOpened && JSON.stringify([target?.id, fromDate, toDate]) !== generatorBaseline)
  const { confirmDiscard } = useNavigationGuard('class-editors', { dirty, pending: saving })
  const sessionRequest = useRef(0)
  const submitLock = useRef(false)
  const sessionTarget = useRef<number | null>(null)

  function edit(item?: AcademyClass) {
    const next = item ? { ...item } : { ...blankClass }
    setForm(next); setFormBaseline(JSON.stringify(next)); formModal.open()
  }
  function openGenerator(item?: AcademyClass) {
    const next = item || data.classes[0] || null
    setTarget(next); setGeneratorBaseline(JSON.stringify([next?.id, fromDate, toDate])); generateModal.open()
  }
  function closeForm() { if (confirmDiscard({ dirty: formOpened && JSON.stringify(form) !== formBaseline, pending: saving })) formModal.close() }
  function closeGenerator() { if (confirmDiscard({ dirty: generateOpened && JSON.stringify([target?.id, fromDate, toDate]) !== generatorBaseline, pending: saving })) generateModal.close() }
  function closeSessionForm() { if (confirmDiscard({ dirty: sessionFormOpened && JSON.stringify(sessionForm) !== sessionBaseline, pending: saving })) sessionFormModal.close() }

  async function submit() {
    if (!form.label.trim() || submitLock.current) return
    submitLock.current = true
    setSaving(true)
    try {
      const saved = await saveClass(branchId, form)
      notifications.show({ color: 'green', message: 'Class saved' })
      setFormBaseline(JSON.stringify(saved))
      formModal.close()
      try { await onChanged() } catch (error) { notifications.show({ color: 'orange', title: 'Class saved, refresh failed', message: errorMessage(error) }) }
    } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) } finally { submitLock.current = false; setSaving(false) }
  }

  async function remove(item: AcademyClass) {
    if (!window.confirm(`Delete ${item.label}? Classes with enrollment or session history cannot be deleted.`)) return
    try { await deleteClass(branchId, item.id); await onChanged() } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) }
  }

  async function runGenerator() {
    if (!target) return
    setSaving(true)
    try { const created = await generateSessions(target.id, fromDate, toDate); notifications.show({ color: 'green', title: 'Sessions generated', message: `${created} new session${created === 1 ? '' : 's'} created.` }); generateModal.close(); await openSessions(target); await onChanged() } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) } finally { setSaving(false) }
  }

  async function openSessions(item: AcademyClass) {
    const requestId = ++sessionRequest.current
    sessionTarget.current = item.id
    setTarget(item); setSessions([]); sessionsModal.open(); setSaving(true)
    try {
      const nextSessions = await getClassSessions(item.id)
      if (requestId === sessionRequest.current && sessionTarget.current === item.id) setSessions(nextSessions)
    } catch (error) {
      if (requestId === sessionRequest.current) notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      if (requestId === sessionRequest.current) setSaving(false)
    }
  }

  function closeSessions() {
    sessionRequest.current += 1
    sessionTarget.current = null
    sessionsModal.close()
  }

  function openSessionForm(session?: Session) {
    sessionTarget.current = session?.class_id || target?.id || null
    const next = session ? { id: session.id, session_date: session.session_date, notes: session.notes || '', coach_id: session.coach_id } : { session_date: dayjs().format('YYYY-MM-DD'), notes: '', coach_id: target?.coach_id || null }
    setSessionForm(next)
    setSessionBaseline(JSON.stringify(next))
    sessionFormModal.open()
  }

  async function submitSession() {
    const classId = sessionTarget.current
    if (!classId || !sessionForm.session_date || submitLock.current) return
    submitLock.current = true
    setSaving(true)
    try {
      const saved = await saveSession({ ...sessionForm, branch_id: branchId, class_id: classId })
      notifications.show({ color: 'green', message: sessionForm.id ? 'Session updated' : 'Session created' })
      setSessionBaseline(JSON.stringify(sessionForm))
      sessionFormModal.close()
      try {
        const nextSessions = await getClassSessions(classId)
        if (sessionTarget.current === classId) setSessions(nextSessions)
        await onChanged()
      } catch (error) { notifications.show({ color: 'orange', title: `${saved.session_date} saved, refresh failed`, message: errorMessage(error) }) }
    } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) } finally { submitLock.current = false; setSaving(false) }
  }

  async function removeSession(session: Session) {
    if (!window.confirm(`Delete the ${dayjs(session.session_date).format('D MMMM YYYY')} session and all linked attendance?`)) return
    try { await deleteSession(session.id); if (target) setSessions(await getClassSessions(target.id)); await onChanged() } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) }
  }

  return (
    <>
      <PageHeader title="Classes" description="Weekly schedules, coach assignments, dated sessions, and one-off training" action={<Group><Button variant="light" leftSection={<IconCalendarPlus size={17} />} onClick={() => openGenerator()} disabled={!data.classes.length}>Bulk sessions</Button><Button leftSection={<IconPlus size={17} />} onClick={() => edit()}>Add class</Button></Group>} />
      {data.classes.length ? <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>{data.classes.map((item) => {
        const enrolled = new Set(data.enrollments.filter((entry) => entry.class_id === item.id && !entry.end_date).map((entry) => entry.student_id)).size
        const upcoming = data.sessions.filter((session) => session.class_id === item.id && session.session_date >= dayjs().format('YYYY-MM-DD')).length
        return <Paper key={item.id} p={{ base: 'md', sm: 'lg' }} radius="lg" withBorder className="class-card"><Group justify="space-between" align="flex-start"><ThemeIcon size={46} variant="light" color="orange" radius="md"><IconBallBasketball size={24} /></ThemeIcon><Menu position="bottom-end"><Menu.Target><ActionIcon aria-label={`Actions for ${item.label}`} size={44} variant="subtle"><IconDots size={20} /></ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item leftSection={<IconList size={16} />} onClick={() => openSessions(item)}>Manage sessions</Menu.Item><Menu.Item leftSection={<IconCalendarPlus size={16} />} onClick={() => openGenerator(item)}>Generate sessions</Menu.Item><Menu.Item leftSection={<IconEdit size={16} />} onClick={() => edit(item)}>Edit class</Menu.Item><Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => remove(item)}>Delete class</Menu.Item></Menu.Dropdown></Menu></Group><Text fw={800} size="lg" mt="md">{item.label}</Text><Group gap={7} mt={8}><Badge variant="light">{item.day_of_week}</Badge><Badge variant="outline" color="gray" leftSection={<IconClock size={12} />}>{formatTime(item.start_time)} – {formatTime(item.end_time)}</Badge></Group><Stack gap={7} mt="lg"><Group justify="space-between"><Text size="sm" c="dimmed">Assigned coach</Text><Text size="sm" fw={650}>{item.coach?.name || 'Unassigned'}</Text></Group><Group justify="space-between"><Text size="sm" c="dimmed">Enrolled students</Text><Group gap={4}><IconUsers size={15} /><Text size="sm" fw={650}>{enrolled}</Text></Group></Group><Group justify="space-between"><Text size="sm" c="dimmed">Upcoming sessions</Text><Text size="sm" fw={650}>{upcoming}</Text></Group></Stack><Button mt="lg" fullWidth variant="light" leftSection={<IconList size={17} />} onClick={() => openSessions(item)}>Sessions</Button></Paper>
      })}</SimpleGrid> : <EmptyState title="No classes yet" message="Create a weekly class, assign a coach, then generate dated sessions." icon={IconBallBasketball} />}

      <Modal opened={formOpened} onClose={closeForm} title={form.id ? 'Edit class' : 'Add class'} centered><Stack><TextInput label="Class name" placeholder="Saturday Morning Elite" value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} required /><Select label="Day of week" data={days} value={form.day_of_week} onChange={(value) => setForm({ ...form, day_of_week: value || 'Saturday' })} /><Grid><Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Start time" type="time" value={form.start_time || ''} onChange={(event) => setForm({ ...form, start_time: event.currentTarget.value })} /></Grid.Col><Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="End time" type="time" value={form.end_time || ''} onChange={(event) => setForm({ ...form, end_time: event.currentTarget.value })} /></Grid.Col></Grid><Select label="Head coach" clearable value={form.coach_id ? String(form.coach_id) : null} onChange={(value) => setForm({ ...form, coach_id: value ? Number(value) : null })} data={data.coaches.filter((coach) => coach.status === 'Active' && coach.coach_type === 'Head').map((coach) => ({ value: String(coach.id), label: coach.name }))} /><Group className="modal-actions" justify="flex-end"><Button variant="default" disabled={saving} onClick={closeForm}>Cancel</Button><Button onClick={submit} loading={saving}>Save class</Button></Group></Stack></Modal>

      <Modal opened={generateOpened} onClose={closeGenerator} title="Bulk generate sessions" centered><Stack><Select label="Class" searchable value={target ? String(target.id) : null} onChange={(value) => setTarget(data.classes.find((item) => String(item.id) === value) || null)} data={data.classes.map((item) => ({ value: String(item.id), label: item.label }))} /><Paper p="md" radius="md" withBorder bg="var(--mantine-color-orange-light)"><Text fw={700} size="sm">Weekly schedule</Text><Text size="sm" c="dimmed">One session every {target?.day_of_week || 'selected weekday'} · {formatTime(target?.start_time || null)} – {formatTime(target?.end_time || null)}</Text><Text size="xs" c="dimmed" mt={4}>Existing dates are skipped automatically.</Text></Paper><Grid><Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="From" type="date" value={fromDate} onChange={(event) => setFromDate(event.currentTarget.value)} /></Grid.Col><Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="To" type="date" value={toDate} onChange={(event) => setToDate(event.currentTarget.value)} /></Grid.Col></Grid><Button leftSection={<IconCalendarPlus size={17} />} onClick={runGenerator} loading={saving} disabled={!target}>Generate sessions</Button></Stack></Modal>

      <Modal opened={sessionsOpened} onClose={closeSessions} title={`${target?.label || ''} sessions`} size="lg" centered><Stack><Group justify="space-between"><Text c="dimmed" size="sm">Add one-off training or correct generated sessions.</Text><Button leftSection={<IconPlus size={16} />} onClick={() => openSessionForm()}>Add session</Button></Group>{sessions.length ? sessions.map((session) => <Paper key={session.id} p="md" radius="md" withBorder><Group justify="space-between" align="flex-start"><Box><Text fw={750}>{dayjs(session.session_date).format('dddd, D MMMM YYYY')}</Text><Text size="sm" c="dimmed">{session.coach?.name || 'No coach'}{session.notes ? ` · ${session.notes}` : ''}</Text></Box><Group gap="xs"><ActionIcon aria-label="Edit session" size={44} variant="light" onClick={() => openSessionForm(session)}><IconEdit size={17} /></ActionIcon><ActionIcon aria-label="Delete session" size={44} variant="light" color="red" onClick={() => removeSession(session)}><IconTrash size={17} /></ActionIcon></Group></Group></Paper>) : <Text c="dimmed" ta="center" py="xl">No sessions yet.</Text>}</Stack></Modal>

      <Modal opened={sessionFormOpened} onClose={closeSessionForm} title={sessionForm.id ? 'Edit session' : 'Add session'} centered><Stack><TextInput label="Date" type="date" value={sessionForm.session_date} onChange={(event) => setSessionForm({ ...sessionForm, session_date: event.currentTarget.value })} required /><Select label="Coach" clearable value={sessionForm.coach_id ? String(sessionForm.coach_id) : null} onChange={(value) => setSessionForm({ ...sessionForm, coach_id: value ? Number(value) : null })} data={data.coaches.filter((coach) => coach.status === 'Active').map((coach) => ({ value: String(coach.id), label: coach.name }))} /><Textarea label="Notes" value={sessionForm.notes} onChange={(event) => setSessionForm({ ...sessionForm, notes: event.currentTarget.value })} /><Group className="modal-actions" justify="flex-end"><Button variant="default" disabled={saving} onClick={closeSessionForm}>Cancel</Button><Button onClick={submitSession} loading={saving}>Save session</Button></Group></Stack></Modal>
    </>
  )
}

function formatTime(value: string | null) { return value ? dayjs(`2000-01-01T${value}`).format('h:mm A') : 'TBC' }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong' }
