import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Box, Button, Checkbox, Divider, Grid, Group, Modal, Paper, SegmentedControl, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconBallBasketball, IconCheck, IconClock, IconPlus, IconSearch, IconTrash, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { addCoachAttendance, ensureTodaySession, getAttendance, getCoachAttendance, removeAttendance, removeCoachAttendance, saveAttendance, saveStudent } from '../lib/api'
import { getClassSessions } from '../lib/sessionOperations'
import { EmptyState, PageHeader, PersonAvatar } from '../components/ui'
import type { Attendance, BootstrapData, CoachAttendance, Session, Student } from '../types/models'

export function AttendancePage({ branchId, data, isAdmin, onChanged }: { branchId: number; data: BootstrapData; isAdmin: boolean; onChanged: () => Promise<unknown> }) {
  const todayClasses = data.classes.filter((item) => item.day_of_week === dayjs().format('dddd'))
  const [mode, setMode] = useState<'today' | 'history'>('today')
  const availableClasses = mode === 'today' ? todayClasses : data.classes
  const [selectedClassId, setSelectedClassId] = useState<number | null>(todayClasses[0]?.id || null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [records, setRecords] = useState<Attendance[]>([])
  const [coachRecords, setCoachRecords] = useState<CoachAttendance[]>([])
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<string | null>('All')
  const [loading, setLoading] = useState(false)
  const [walkinOpened, walkinModal] = useDisclosure(false)
  const [walkinId, setWalkinId] = useState<string | null>(null)
  const [quickName, setQuickName] = useState('')
  const [quickPhone, setQuickPhone] = useState('')
  const [coachId, setCoachId] = useState<string | null>(null)

  const academyClass = data.classes.find((item) => item.id === selectedClassId) || null
  const enrolledIds = useMemo(() => new Set(data.enrollments.filter((item) => item.class_id === selectedClassId && (!session || item.start_date <= session.session_date)).map((item) => item.student_id)), [data.enrollments, selectedClassId, session])
  const enrolled = data.students.filter((student) => enrolledIds.has(student.id) && (mode === 'history' || student.status !== 'Inactive') && student.name.toLowerCase().includes(search.toLowerCase()) && (level === 'All' || student.level === level))
  const walkins = data.students.filter((student) => !enrolledIds.has(student.id) && records.some((record) => record.student_id === student.id))
  const possibleWalkins = data.students.filter((student) => !enrolledIds.has(student.id) && student.status !== 'Inactive')
  const present = records.filter((record) => record.status === 'Present')
  const breakdown = present.reduce((result, record) => {
    const student = data.students.find((item) => item.id === record.student_id)
    if (student?.status === 'Trial') result.trial += 1
    else if (!enrolledIds.has(record.student_id)) result.replacement += 1
    else result.regular += 1
    return result
  }, { regular: 0, trial: 0, replacement: 0 })
  const notMarked = enrolled.filter((student) => !records.some((record) => record.student_id === student.id && record.status === 'Present')).length

  useEffect(() => {
    if (!availableClasses.some((item) => item.id === selectedClassId)) setSelectedClassId(availableClasses[0]?.id || null)
  }, [availableClasses, selectedClassId])

  useEffect(() => {
    if (!academyClass) { setSession(null); setSessions([]); setRecords([]); return }
    let active = true
    setLoading(true)
    const request = mode === 'today'
      ? ensureTodaySession(academyClass).then((next) => ({ list: [next], selected: next }))
      : getClassSessions(academyClass.id).then((list) => ({ list, selected: list[0] || null }))
    request.then(async ({ list, selected }) => {
      if (!active) return
      setSessions(list); setSelectedSessionId(selected?.id || null); setSession(selected)
      if (!selected) { setRecords([]); setCoachRecords([]); return }
      const [nextRecords, nextCoaches] = await Promise.all([getAttendance(selected.id), getCoachAttendance(selected.id)])
      if (active) { setRecords(nextRecords); setCoachRecords(nextCoaches) }
    }).catch((error) => notifications.show({ color: 'red', message: errorMessage(error) })).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [academyClass, mode])

  async function selectSession(value: string | null) {
    const next = sessions.find((item) => String(item.id) === value) || null
    setSelectedSessionId(next?.id || null); setSession(next)
    if (!next) { setRecords([]); setCoachRecords([]); return }
    setLoading(true)
    try { const [nextRecords, nextCoaches] = await Promise.all([getAttendance(next.id), getCoachAttendance(next.id)]); setRecords(nextRecords); setCoachRecords(nextCoaches) } finally { setLoading(false) }
  }

  async function toggle(student: Student) {
    if (!session || !academyClass) return
    const existing = records.find((record) => record.student_id === student.id)
    const optimistic: Attendance = { student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId, attendance_date: session.session_date, status: existing?.status === 'Present' ? '' : 'Present', remarks: existing?.remarks || '' }
    setRecords((current) => [...current.filter((record) => record.student_id !== student.id), optimistic])
    try { await saveAttendance(optimistic) } catch (error) { setRecords((current) => [...current.filter((record) => record.student_id !== student.id), ...(existing ? [existing] : [])]); notifications.show({ color: 'red', message: errorMessage(error) }) }
  }

  async function updateRemark(student: Student, remarks: string) {
    if (!session || !academyClass) return
    const existing = records.find((record) => record.student_id === student.id)
    try { const saved = await saveAttendance({ student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId, attendance_date: session.session_date, status: existing?.status || '', remarks }); setRecords((current) => [...current.filter((record) => record.student_id !== student.id), saved]) } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) }
  }

  async function markAll() {
    if (!session || !academyClass) return
    setLoading(true)
    try { await Promise.all(enrolled.map((student) => saveAttendance({ student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId, attendance_date: session.session_date, status: 'Present', remarks: records.find((record) => record.student_id === student.id)?.remarks || '' }))); setRecords(await getAttendance(session.id)); notifications.show({ color: 'green', message: `${enrolled.length} students marked present` }) } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) } finally { setLoading(false) }
  }

  async function addWalkin() {
    if (!session || !academyClass) return
    setLoading(true)
    try {
      let student = data.students.find((item) => String(item.id) === walkinId)
      if (!student && quickName.trim()) { student = await saveStudent(branchId, { name: quickName.trim(), student_phone: quickPhone.trim(), status: 'Trial' }); await onChanged() }
      if (!student) return
      await saveAttendance({ student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId, attendance_date: session.session_date, status: 'Present', remarks: '' })
      setRecords(await getAttendance(session.id)); setWalkinId(null); setQuickName(''); setQuickPhone(''); walkinModal.close()
    } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) } finally { setLoading(false) }
  }

  async function deleteWalkin(studentId: number) { if (!session) return; await removeAttendance(studentId, session.id); setRecords((current) => current.filter((record) => record.student_id !== studentId)) }
  async function addCoach() { if (!session || !coachId) return; try { await addCoachAttendance(session.id, Number(coachId)); setCoachRecords(await getCoachAttendance(session.id)); setCoachId(null) } catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) } }
  async function deletePresentCoach(nextCoachId: number) { if (!session) return; await removeCoachAttendance(session.id, nextCoachId); setCoachRecords((current) => current.filter((item) => item.coach_id !== nextCoachId)) }

  return (
    <>
      <PageHeader title="Attendance" description={mode === 'today' ? `${dayjs().format('dddd, D MMMM')} · present-only attendance` : 'Review and correct historical attendance'} action={isAdmin ? <SegmentedControl value={mode} onChange={(value) => setMode(value as 'today' | 'history')} data={[{ value: 'today', label: 'Today' }, { value: 'history', label: 'Past records' }]} /> : undefined} />
      {availableClasses.length ? <Grid gutter="xl">
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Box hiddenFrom="lg"><Select label="Class" value={selectedClassId ? String(selectedClassId) : null} onChange={(value) => setSelectedClassId(value ? Number(value) : null)} data={availableClasses.map((item) => ({ value: String(item.id), label: item.label }))} /></Box>
          <Paper visibleFrom="lg" p="md" radius="lg" withBorder><Text size="xs" fw={800} c="dimmed" tt="uppercase" mb="sm">{mode === 'today' ? 'Today’s classes' : 'All classes'}</Text><Stack gap={8}>{availableClasses.map((item) => <button key={item.id} className={`class-picker ${selectedClassId === item.id ? 'active' : ''}`} onClick={() => setSelectedClassId(item.id)}><ThemeIcon variant={selectedClassId === item.id ? 'filled' : 'light'} color="orange" radius="md"><IconBallBasketball size={19} /></ThemeIcon><span><strong>{item.label}</strong><small>{formatTime(item.start_time)}</small></span></button>)}</Stack></Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          {academyClass && <Stack>
            {mode === 'history' && <Select label="Session date" value={selectedSessionId ? String(selectedSessionId) : null} onChange={selectSession} data={sessions.map((item) => ({ value: String(item.id), label: `${dayjs(item.session_date).format('dddd, D MMMM YYYY')}${item.notes ? ` · ${item.notes}` : ''}` }))} placeholder="No sessions" />}
            {session ? <><Paper p="lg" radius="lg" withBorder><Group justify="space-between" align="flex-start"><Box><Text fw={800} size="lg">{academyClass.label}</Text><Group gap={8} mt={5}><Badge leftSection={<IconClock size={12} />} variant="light">{dayjs(session.session_date).format('D MMM YYYY')}</Badge><Badge color="green" variant="light">{present.length} present</Badge><Badge color="gray" variant="light">{notMarked} not marked</Badge></Group></Box><Button leftSection={<IconCheck size={16} />} variant="light" onClick={markAll} loading={loading}>All present</Button></Group><SimpleGrid cols={{ base: 3 }} mt="md"><Badge color="blue" variant="light">Regular {breakdown.regular}</Badge><Badge color="orange" variant="light">Trial {breakdown.trial}</Badge><Badge color="violet" variant="light">Replacement {breakdown.replacement}</Badge></SimpleGrid><Divider my="md" /><Text size="xs" fw={800} c="dimmed" tt="uppercase" mb={8}>Coaches present</Text><Group gap="xs">{coachRecords.map((item) => <Badge key={item.id} size="lg" variant="light" rightSection={<ActionIcon aria-label="Remove coach" variant="transparent" color="gray" size="xs" onClick={() => deletePresentCoach(item.coach_id)}><IconTrash size={12} /></ActionIcon>}>{data.coaches.find((coach) => coach.id === item.coach_id)?.name || 'Coach'} · {item.hours}h</Badge>)}<Select placeholder="Add coach" value={coachId} onChange={setCoachId} data={data.coaches.filter((coach) => !coachRecords.some((item) => item.coach_id === coach.id)).map((coach) => ({ value: String(coach.id), label: coach.name }))} w={{ base: '100%', sm: 180 }} size="xs" /><ActionIcon aria-label="Add coach" variant="light" size="lg" onClick={addCoach} disabled={!coachId}><IconPlus size={17} /></ActionIcon></Group></Paper>
            <Paper p="md" radius="lg" withBorder><Grid mb="md"><Grid.Col span={{ base: 12, sm: 7 }}><TextInput leftSection={<IconSearch size={16} />} placeholder="Search students" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></Grid.Col><Grid.Col span={{ base: 6, sm: 3 }}><Select value={level} onChange={setLevel} data={['All', 'Beginner', 'Intermediate', 'Advanced']} /></Grid.Col><Grid.Col span={{ base: 6, sm: 2 }}><Button fullWidth variant="default" leftSection={<IconUserPlus size={16} />} onClick={walkinModal.open}>Walk-in</Button></Grid.Col></Grid><Stack gap={0}>{enrolled.map((student) => <AttendanceRow key={`${session.id}-${student.id}`} student={student} present={records.find((record) => record.student_id === student.id)?.status === 'Present'} remarks={records.find((record) => record.student_id === student.id)?.remarks || ''} onToggle={() => toggle(student)} onRemark={(value) => updateRemark(student, value)} />)}{walkins.length > 0 && <><Divider label="Walk-ins" labelPosition="left" my="md" />{walkins.map((student) => <AttendanceRow key={`${session.id}-${student.id}`} student={student} present={records.find((record) => record.student_id === student.id)?.status === 'Present'} remarks={records.find((record) => record.student_id === student.id)?.remarks || ''} onToggle={() => toggle(student)} onRemark={(value) => updateRemark(student, value)} onDelete={() => deleteWalkin(student.id)} />)}</>}</Stack></Paper></> : <EmptyState title="No session selected" message="Create a session from Classes, then return here to record attendance." icon={IconUsers} />}
          </Stack>}
        </Grid.Col>
      </Grid> : <EmptyState title={mode === 'today' ? 'No classes scheduled today' : 'No classes configured'} message="Classes assigned to this day will appear automatically." icon={IconUsers} />}

      <Modal opened={walkinOpened} onClose={walkinModal.close} title="Add walk-in" centered><Stack><Select label="Existing student" placeholder="Search student" searchable value={walkinId} onChange={setWalkinId} data={possibleWalkins.map((student) => ({ value: String(student.id), label: `${student.name} · ${student.status}` }))} /><Button onClick={addWalkin} disabled={!walkinId} loading={loading}>Mark selected student present</Button><Divider label="or register a trial student" /><TextInput label="Student name" value={quickName} onChange={(event) => setQuickName(event.currentTarget.value)} /><TextInput label="Phone" value={quickPhone} onChange={(event) => setQuickPhone(event.currentTarget.value)} /><Button variant="light" onClick={addWalkin} disabled={!quickName.trim()} loading={loading}>Register and mark present</Button></Stack></Modal>
    </>
  )
}

function AttendanceRow({ student, present, remarks, onToggle, onRemark, onDelete }: { student: Student; present: boolean; remarks: string; onToggle: () => void; onRemark: (value: string) => void; onDelete?: () => void }) {
  return <Box className={`attendance-row ${present ? 'present' : ''}`}><Group wrap="wrap"><Checkbox checked={present} onChange={onToggle} size="lg" color="green" /><PersonAvatar name={student.name} size={40} /><Box flex={1} style={{ minWidth: 0 }}><Text fw={700} truncate>{student.name}</Text><Text size="xs" c="dimmed">{student.level || student.status}</Text></Box>{onDelete && <ActionIcon aria-label={`Remove ${student.name} walk-in`} color="red" variant="subtle" onClick={onDelete}><IconTrash size={17} /></ActionIcon>}<TextInput defaultValue={remarks} onBlur={(event) => onRemark(event.currentTarget.value)} placeholder="Remarks" className="attendance-remark" /></Group></Box>
}

function formatTime(value: string | null) { return value ? dayjs(`2000-01-01T${value}`).format('h:mm A') : 'Time TBC' }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong' }
