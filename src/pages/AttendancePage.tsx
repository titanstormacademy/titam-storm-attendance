import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Box, Button, Divider, Group, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconArrowLeft, IconCheck, IconChevronRight, IconSearch, IconTrash, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { addCoachAttendance, ensureTodaySession, getAttendance, getCoachAttendance, removeAttendance, removeCoachAttendance, saveAttendance } from '../lib/api'
import { getClassSessions } from '../lib/sessionOperations'
import { publicImageUrl } from '../lib/supabase'
import { EmptyState, PageHeader, PersonAvatar, PhotoLightbox } from '../components/ui'
import type { AcademyClass, Attendance, BootstrapData, CoachAttendance, Session, Student } from '../types/models'

export function AttendancePage({ branchId, data, isAdmin, onRegisterStudent }: { branchId: number; data: BootstrapData; isAdmin: boolean; onRegisterStudent: () => void }) {
  const [screen, setScreen] = useState<'hub' | 'detail'>('hub')
  const [mode, setMode] = useState<'today' | 'history'>('today')
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [records, setRecords] = useState<Attendance[]>([])
  const [coachRecords, setCoachRecords] = useState<CoachAttendance[]>([])
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<string | null>('All')
  const [loading, setLoading] = useState(false)
  const [walkinOpened, walkinModal] = useDisclosure(false)
  const [walkinId, setWalkinId] = useState<string | null>(null)
  const [walkinSearch, setWalkinSearch] = useState('')
  const [walkinLevel, setWalkinLevel] = useState<string>('All')
  const [coachId, setCoachId] = useState<string | null>(null)
  const [photoView, setPhotoView] = useState<{ src: string | null; name: string } | null>(null)

  const todayName = dayjs().format('dddd')
  const todayClasses = data.classes.filter((item) => item.day_of_week === todayName)
  const academyClass = data.classes.find((item) => item.id === selectedClassId) || null
  const effectiveEnrollmentIds = useMemo(() => new Set(data.enrollments
    .filter((item) => item.class_id === selectedClassId && (!session || item.start_date <= session.session_date))
    .map((item) => item.student_id)), [data.enrollments, selectedClassId, session])
  const allEnrolled = data.students.filter((student) => effectiveEnrollmentIds.has(student.id) && (mode === 'history' || student.status !== 'Inactive'))
  const visibleEnrolled = allEnrolled.filter((student) => student.name.toLowerCase().includes(search.toLowerCase()) && (level === 'All' || student.level === level))
  const walkins = data.students.filter((student) => !effectiveEnrollmentIds.has(student.id) && records.some((record) => record.student_id === student.id))
  const possibleWalkins = data.students.filter((student) => !effectiveEnrollmentIds.has(student.id) && student.status !== 'Inactive')
  const filteredWalkins = possibleWalkins.filter((student) => {
    const needle = walkinSearch.trim().toLowerCase()
    return (!needle || [student.name, student.student_phone, student.parent_contact].some((value) => value?.toLowerCase().includes(needle)))
      && (walkinLevel === 'All' || student.level === walkinLevel)
  }).sort((a, b) => a.name.localeCompare(b.name))
  const present = records.filter((record) => record.status === 'Present')
  const breakdown = present.reduce((result, record) => {
    const student = data.students.find((item) => item.id === record.student_id)
    if (student?.status === 'Trial') result.trial += 1
    else if (!effectiveEnrollmentIds.has(record.student_id)) result.replacement += 1
    else result.regular += 1
    return result
  }, { regular: 0, trial: 0, replacement: 0 })
  const notMarked = allEnrolled.filter((student) => !records.some((record) => record.student_id === student.id && record.status === 'Present')).length
  const groupedStudents = useMemo(() => {
    const groups = new Map<string, Student[]>()
    visibleEnrolled.forEach((student) => {
      const group = student.level || 'Other'
      groups.set(group, [...(groups.get(group) || []), student])
    })
    return [...groups].sort(([a], [b]) => levelOrder(a) - levelOrder(b))
  }, [visibleEnrolled])

  useEffect(() => {
    if (screen !== 'detail' || !academyClass) return
    let active = true
    setLoading(true)
    const request = mode === 'today'
      ? ensureTodaySession(academyClass).then((selected) => ({ list: [selected], selected }))
      : getClassSessions(academyClass.id).then((list) => ({ list, selected: nearestSession(list) }))
    request.then(async ({ list, selected }) => {
      if (!active) return
      setSessions(list)
      setSession(selected)
      if (!selected) { setRecords([]); setCoachRecords([]); return }
      const [nextRecords, nextCoaches] = await Promise.all([getAttendance(selected.id), getCoachAttendance(selected.id)])
      if (active) { setRecords(nextRecords); setCoachRecords(nextCoaches) }
    }).catch((error) => notifications.show({ color: 'red', message: errorMessage(error) })).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [academyClass, mode, screen])

  function openClass(item: AcademyClass, nextMode: 'today' | 'history') {
    setMode(nextMode)
    setSelectedClassId(item.id)
    setSession(null)
    setSessions([])
    setRecords([])
    setCoachRecords([])
    setSearch('')
    setLevel('All')
    setScreen('detail')
  }

  function openWalkinPicker() {
    setWalkinId(null)
    setWalkinSearch('')
    setWalkinLevel('All')
    walkinModal.open()
  }

  async function selectSession(next: Session) {
    setSession(next)
    setLoading(true)
    try {
      const [nextRecords, nextCoaches] = await Promise.all([getAttendance(next.id), getCoachAttendance(next.id)])
      setRecords(nextRecords)
      setCoachRecords(nextCoaches)
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function toggle(student: Student) {
    if (!session || !academyClass) return
    const existing = records.find((record) => record.student_id === student.id)
    const optimistic: Attendance = {
      student_id: student.id,
      session_id: session.id,
      class_id: academyClass.id,
      branch_id: branchId,
      attendance_date: session.session_date,
      status: existing?.status === 'Present' ? '' : 'Present',
      remarks: existing?.remarks || '',
    }
    setRecords((current) => [...current.filter((record) => record.student_id !== student.id), optimistic])
    try {
      await saveAttendance(optimistic)
    } catch (error) {
      setRecords((current) => [...current.filter((record) => record.student_id !== student.id), ...(existing ? [existing] : [])])
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  async function updateRemark(student: Student, remarks: string) {
    if (!session || !academyClass) return
    const existing = records.find((record) => record.student_id === student.id)
    try {
      const saved = await saveAttendance({
        student_id: student.id,
        session_id: session.id,
        class_id: academyClass.id,
        branch_id: branchId,
        attendance_date: session.session_date,
        status: existing?.status || '',
        remarks,
      })
      setRecords((current) => [...current.filter((record) => record.student_id !== student.id), saved])
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  async function markAll() {
    if (!session || !academyClass) return
    setLoading(true)
    try {
      await Promise.all(allEnrolled.map((student) => saveAttendance({
        student_id: student.id,
        session_id: session.id,
        class_id: academyClass.id,
        branch_id: branchId,
        attendance_date: session.session_date,
        status: 'Present',
        remarks: records.find((record) => record.student_id === student.id)?.remarks || '',
      })))
      setRecords(await getAttendance(session.id))
      notifications.show({ color: 'green', message: `${allEnrolled.length} students marked present` })
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function addWalkin() {
    if (!session || !academyClass) return
    setLoading(true)
    try {
      const student = data.students.find((item) => String(item.id) === walkinId)
      if (!student) return
      await saveAttendance({ student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId, attendance_date: session.session_date, status: 'Present', remarks: '' })
      setRecords(await getAttendance(session.id))
      setWalkinId(null)
      walkinModal.close()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function deleteWalkin(studentId: number) {
    if (!session) return
    await removeAttendance(studentId, session.id)
    setRecords((current) => current.filter((record) => record.student_id !== studentId))
  }

  async function addCoach() {
    if (!session || !coachId) return
    try {
      await addCoachAttendance(session.id, Number(coachId))
      setCoachRecords(await getCoachAttendance(session.id))
      setCoachId(null)
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  async function deletePresentCoach(nextCoachId: number) {
    if (!session) return
    await removeCoachAttendance(session.id, nextCoachId)
    setCoachRecords((current) => current.filter((item) => item.coach_id !== nextCoachId))
  }

  if (screen === 'hub') {
    return <AttendanceHub data={data} todayClasses={todayClasses} isAdmin={isAdmin} onToday={(item) => openClass(item, 'today')} onHistory={(item) => openClass(item, 'history')} />
  }

  return (
    <>
      <Box className="attendance-detail-header">
        <ActionIcon aria-label="Back to attendance" variant="subtle" color="dark" size={44} onClick={() => setScreen('hub')}><IconArrowLeft size={24} /></ActionIcon>
        <Box><Title order={2}>{academyClass?.label || 'Attendance'}</Title><Text c="dimmed" size="sm">{mode === 'history' ? 'Past Records' : session ? dayjs(session.session_date).format('dddd, D MMMM YYYY') : 'Today'}</Text></Box>
      </Box>

      {mode === 'history' && sessions.length > 0 && <Box className="attendance-date-pills">{[...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date)).map((item) => <button type="button" key={item.id} className={session?.id === item.id ? 'active' : ''} onClick={() => selectSession(item)}>{dayjs(item.session_date).format('D MMM YYYY')}</button>)}</Box>}

      {session ? <Stack gap="md">
        <SimpleGrid cols={2} spacing="sm" className="attendance-summary-grid">
          <Paper className="attendance-summary-card present" p="lg" radius="lg"><Text className="attendance-summary-value">{present.length}</Text><Text size="xs" c="dimmed">Present</Text><Group justify="center" gap="xs" mt="xs"><Text size="xs">Regular <b>{breakdown.regular}</b></Text><Text size="xs" c="orange">Trial <b>{breakdown.trial}</b></Text><Text size="xs" c="blue">Replacement <b>{breakdown.replacement}</b></Text></Group></Paper>
          <Paper className="attendance-summary-card" p="lg" radius="lg"><Text className="attendance-summary-value">{notMarked}</Text><Text size="xs" c="dimmed">Not marked</Text></Paper>
        </SimpleGrid>

        <Box>
          <Text className="attendance-section-label">Coaches present</Text>
          {coachRecords.length ? <Group gap="xs" mb="sm">{coachRecords.map((item) => <Badge key={item.id} size="lg" variant="light" rightSection={<ActionIcon aria-label="Remove coach" variant="transparent" color="gray" size="xs" onClick={() => deletePresentCoach(item.coach_id)}><IconTrash size={12} /></ActionIcon>}>{data.coaches.find((coach) => coach.id === item.coach_id)?.name || 'Coach'} · {item.hours}h</Badge>)}</Group> : <Text size="sm" c="dimmed" mb="sm">None marked yet</Text>}
          <Group wrap="nowrap"><Select placeholder="-- Add coach --" value={coachId} onChange={setCoachId} data={data.coaches.filter((coach) => !coachRecords.some((item) => item.coach_id === coach.id)).map((coach) => ({ value: String(coach.id), label: coach.name }))} flex={1} /><Button variant="light" onClick={addCoach} disabled={!coachId}>Add</Button></Group>
        </Box>

        <Group className="attendance-tools" wrap="wrap"><TextInput leftSection={<IconSearch size={16} />} placeholder="Search students" value={search} onChange={(event) => setSearch(event.currentTarget.value)} flex={1} /><Select value={level} onChange={setLevel} data={['All', 'Beginner', 'Intermediate', 'Advanced']} w={150} /><Button leftSection={<IconCheck size={16} />} variant="light" onClick={markAll} loading={loading}>All present</Button></Group>

        <Box>
          <Text className="attendance-section-label">Enrolled students</Text>
          {groupedStudents.length ? groupedStudents.map(([group, students]) => <Box key={group} mb="lg"><Group gap="xs" mb="xs"><Text className="attendance-level-label">{group}</Text><Badge size="sm" color="gray" variant="light">{students.length}</Badge></Group><Stack gap="xs">{students.map((student) => <AttendanceStudentCard key={`${session.id}-${student.id}`} student={student} present={records.find((record) => record.student_id === student.id)?.status === 'Present'} remarks={records.find((record) => record.student_id === student.id)?.remarks || ''} onToggle={() => toggle(student)} onRemark={(value) => updateRemark(student, value)} onPhoto={() => setPhotoView({ src: publicImageUrl('student-photos', student.photo_path), name: student.name })} />)}</Stack></Box>) : <Text c="dimmed" py="md">No students match this filter.</Text>}
        </Box>

        <Box>
          <Group justify="space-between" mb="xs"><Text className="attendance-section-label" mb={0}>Walk-ins</Text><Button size="xs" leftSection={<IconUserPlus size={15} />} onClick={openWalkinPicker}>Add walk-in</Button></Group>
          {walkins.length ? <Stack gap="xs">{walkins.map((student) => <AttendanceStudentCard key={`${session.id}-${student.id}`} student={student} present={records.find((record) => record.student_id === student.id)?.status === 'Present'} remarks={records.find((record) => record.student_id === student.id)?.remarks || ''} onToggle={() => toggle(student)} onRemark={(value) => updateRemark(student, value)} onPhoto={() => setPhotoView({ src: publicImageUrl('student-photos', student.photo_path), name: student.name })} onDelete={() => deleteWalkin(student.id)} />)}</Stack> : <Text size="sm" c="dimmed">No walk-ins recorded.</Text>}
        </Box>
      </Stack> : <EmptyState title="No sessions recorded" message="Create or generate a session from Classes, then return here." icon={IconUsers} />}

      <Modal opened={walkinOpened} onClose={walkinModal.close} title="Add walk-in" size="md" centered><Stack gap="sm"><TextInput aria-label="Search walk-in students" leftSection={<IconSearch size={17} />} placeholder="Search by name or phone…" value={walkinSearch} onChange={(event) => setWalkinSearch(event.currentTarget.value)} /><Box className="walkin-level-filters">{['All', 'Beginner', 'Intermediate', 'Advanced'].map((item) => <button type="button" key={item} className={walkinLevel === item ? 'active' : ''} onClick={() => setWalkinLevel(item)}>{item}</button>)}</Box><ScrollArea h={310} type="auto" offsetScrollbars><Stack gap={4} pr="xs">{filteredWalkins.length ? filteredWalkins.map((student) => {
        const selected = walkinId === String(student.id)
        return <button type="button" key={student.id} className={`walkin-student-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => setWalkinId(String(student.id))}><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={46} /><Box flex={1} ta="left" style={{ minWidth: 0 }}><Text fw={700} size="sm" truncate>{student.name}</Text><Text size="xs" c="dimmed" truncate>{student.level || student.status}{student.student_phone ? ` · ${student.student_phone}` : ''}</Text></Box><Badge color={student.status === 'Trial' ? 'orange' : 'green'} variant="light">{student.status}</Badge></button>
      }) : <Text c="dimmed" size="sm" ta="center" py="xl">No students match this search and level.</Text>}</Stack></ScrollArea><Button onClick={addWalkin} disabled={!walkinId} loading={loading}>Add selected student</Button><Divider label="Student not listed?" /><Paper className="walkin-registration-handoff" p="md" radius="md" withBorder><Text fw={700}>Register a complete student profile</Text><Text size="sm" c="dimmed" mt={3}>Collect photo, identity, contacts, guardian details, school, level, monthly fee, and optional class enrollment. After saving, return here and select the student.</Text><Button mt="md" fullWidth variant="light" leftSection={<IconUserPlus size={16} />} onClick={() => { walkinModal.close(); onRegisterStudent() }}>Open student registration</Button></Paper><Button variant="default" onClick={walkinModal.close}>Cancel</Button></Stack></Modal>
      <PhotoLightbox src={photoView?.src || null} name={photoView?.name || 'Student photo'} opened={Boolean(photoView)} onClose={() => setPhotoView(null)} />
    </>
  )
}

function AttendanceHub({ data, todayClasses, isAdmin, onToday, onHistory }: { data: BootstrapData; todayClasses: AcademyClass[]; isAdmin: boolean; onToday: (item: AcademyClass) => void; onHistory: (item: AcademyClass) => void }) {
  return <>
    <PageHeader title="Attendance" description="Select a session to take or review attendance" />
    <Text className="attendance-section-label">Today’s sessions</Text>
    {todayClasses.length ? <Stack gap="sm" mb="xl">{todayClasses.map((item) => <AttendanceClassCard key={item.id} item={item} enrolled={data.enrollments.filter((entry) => entry.class_id === item.id).length} action="Take" onClick={() => onToday(item)} />)}</Stack> : <Text c="dimmed" size="sm" mb="xl">No classes today</Text>}
    {isAdmin && <><Text className="attendance-section-label">Review past attendance</Text><Stack gap="sm">{data.classes.map((item) => <AttendanceClassCard key={item.id} item={item} enrolled={data.enrollments.filter((entry) => entry.class_id === item.id).length} action="View" onClick={() => onHistory(item)} />)}</Stack></>}
  </>
}

function AttendanceClassCard({ item, enrolled, action, onClick }: { item: AcademyClass; enrolled: number; action: string; onClick: () => void }) {
  return <Paper component="button" type="button" className="attendance-class-card" p="md" radius="lg" withBorder onClick={onClick}><Box><Text fw={800}>{item.label}</Text><Text c="dimmed" size="sm" mt={3}>{item.day_of_week} · {formatTime(item.start_time)} – {formatTime(item.end_time)}</Text></Box><Box ta="right"><Text className="attendance-card-action">{action} <IconChevronRight size={14} /></Text><Text c="dimmed" size="xs">{enrolled} enrolled</Text></Box></Paper>
}

function AttendanceStudentCard({ student, present, remarks, onToggle, onRemark, onPhoto, onDelete }: { student: Student; present: boolean; remarks: string; onToggle: () => void; onRemark: (value: string) => void; onPhoto: () => void; onDelete?: () => void }) {
  return <Paper className={`attendance-student-card ${present ? 'present' : ''}`} p="md" radius="lg" withBorder><Group wrap="nowrap"><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={64} onClick={onPhoto} /><Box flex={1} style={{ minWidth: 0 }}><Text fw={750} truncate>{student.name}</Text><Text size="xs" c="dimmed">{student.status}</Text></Box><Button className="attendance-present-button" color={present ? 'green' : 'gray'} variant={present ? 'filled' : 'default'} onClick={onToggle}>{present ? 'Present' : 'Present'}</Button>{onDelete && <ActionIcon aria-label={`Remove ${student.name}`} color="red" variant="subtle" onClick={onDelete}><IconTrash size={17} /></ActionIcon>}</Group><TextInput key={`${student.id}-${remarks}`} defaultValue={remarks} onBlur={(event) => onRemark(event.currentTarget.value)} placeholder="Remarks (optional)" mt="sm" /></Paper>
}

function nearestSession(items: Session[]) {
  if (!items.length) return null
  const past = items.filter((item) => item.session_date <= dayjs().format('YYYY-MM-DD'))
  return (past.length ? past : items).sort((a, b) => b.session_date.localeCompare(a.session_date))[0]
}

function levelOrder(value: string) {
  return ['Beginner', 'Intermediate', 'Advanced', 'Other'].indexOf(value)
}

function formatTime(value: string | null) {
  return value ? dayjs(`2000-01-01T${value}`).format('h:mm A') : 'Time TBC'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
