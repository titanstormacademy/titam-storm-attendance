import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Alert, Badge, Box, Button, Divider, Group, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconArrowLeft, IconCheck, IconChevronRight, IconSearch, IconTrash, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { addCoachAttendance, ensureTodaySession, getAttendance, getCoachAttendance, markAllPresent, removeAttendance, removeCoachAttendance, setAttendanceRemark, setAttendanceStatus, setAttendanceTrial } from '../lib/api'
import { getClassSessions } from '../lib/sessionOperations'
import { publicImageUrl } from '../lib/supabase'
import { EmptyState, PageHeader, PageLoader, PersonAvatar, PhotoLightbox } from '../components/ui'
import { useNavigationGuard } from '../contexts/useNavigationGuard'
import type { AcademyClass, Attendance, BootstrapData, CoachAttendance, Session, Student } from '../types/models'

export function AttendancePage({ data, isAdmin, onRegisterStudent }: { branchId: number; data: BootstrapData; isAdmin: boolean; onRegisterStudent: () => void }) {
  const initialRoute = attendanceRoute()
  const [screen, setScreen] = useState<'hub' | 'detail'>(initialRoute.classId ? 'detail' : 'hub')
  const [mode, setMode] = useState<'today' | 'history'>(isAdmin ? initialRoute.mode : 'today')
  const [selectedClassId, setSelectedClassId] = useState<number | null>(initialRoute.classId)
  const [sessions, setSessions] = useState<Session[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [records, setRecords] = useState<Attendance[]>([])
  const [remarkDrafts, setRemarkDrafts] = useState<Record<number, string>>({})
  const [coachRecords, setCoachRecords] = useState<CoachAttendance[]>([])
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<string | null>('All')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadRequest, setReloadRequest] = useState(0)
  const [bulkPending, setBulkPending] = useState(false)
  const [walkinPending, setWalkinPending] = useState(false)
  const [coachPending, setCoachPending] = useState(false)
  const [pendingStudents, setPendingStudents] = useState<Set<number>>(new Set())
  const sessionRequest = useRef(0)
  const sessionRef = useRef<Session | null>(null)
  const mutationLocks = useRef(new Set<string>())
  const [walkinOpened, walkinModal] = useDisclosure(false)
  const [walkinId, setWalkinId] = useState<string | null>(null)
  const [walkinSearch, setWalkinSearch] = useState('')
  const [walkinLevel, setWalkinLevel] = useState<string>('All')
  const [coachId, setCoachId] = useState<string | null>(null)
  const [photoView, setPhotoView] = useState<{ src: string | null; name: string } | null>(null)
  const mutationPending = bulkPending || walkinPending || coachPending || pendingStudents.size > 0
  const remarksDirty = Object.entries(remarkDrafts).some(([studentId, value]) => value !== (records.find((record) => record.student_id === Number(studentId))?.remarks || ''))
  const { confirmDiscard } = useNavigationGuard('attendance-writes', { dirty: remarksDirty, pending: mutationPending })

  const todayName = dayjs().format('dddd')
  const todayClasses = data.classes.filter((item) => item.day_of_week === todayName)
  const academyClass = data.classes.find((item) => item.id === selectedClassId) || null
  const effectiveEnrollmentIds = useMemo(() => {
    const date = session?.session_date || dayjs().format('YYYY-MM-DD')
    return new Set(data.enrollments
      .filter((item) => item.class_id === selectedClassId && item.start_date <= date && (!item.end_date || item.end_date >= date))
      .map((item) => item.student_id))
  }, [data.enrollments, selectedClassId, session?.session_date])
  const allEnrolled = data.students.filter((student) => effectiveEnrollmentIds.has(student.id) && (mode === 'history' || student.status !== 'Inactive'))
  const markAllEligible = allEnrolled.filter((student) => student.status !== 'Inactive')
  const visibleEnrolled = allEnrolled.filter((student) => student.name.toLowerCase().includes(search.toLowerCase()) && (level === 'All' || student.level === level))
  const walkins = data.students.filter((student) => !effectiveEnrollmentIds.has(student.id) && records.some((record) => record.student_id === student.id))
  const possibleWalkins = data.students.filter((student) => !effectiveEnrollmentIds.has(student.id) && student.status !== 'Inactive')
  const filteredWalkins = possibleWalkins.filter((student) => {
    const needle = walkinSearch.trim().toLowerCase()
    return (!needle || [student.name, student.student_phone, student.parent_contact].some((value) => value?.toLowerCase().includes(needle)))
      && (walkinLevel === 'All' || student.level === walkinLevel)
  }).sort((a, b) => a.name.localeCompare(b.name))
  const present = records.filter((record) => record.status === 'Present')
  const trialCount = present.filter((record) => record.is_trial).length
  const countedAttendance = present.length - trialCount
  const notMarked = allEnrolled.filter((student) => !records.some((record) => record.student_id === student.id && record.status === 'Present')).length
  const groupedStudents = useMemo(() => {
    const groups = new Map<string, Student[]>()
    visibleEnrolled.forEach((student) => {
      const group = student.level || 'Other'
      groups.set(group, [...(groups.get(group) || []), student])
    })
    return [...groups].sort(([a], [b]) => levelOrder(a) - levelOrder(b))
  }, [visibleEnrolled])

  useEffect(() => { sessionRef.current = session; setRemarkDrafts({}) }, [session])

  useEffect(() => {
    if (isAdmin || new URLSearchParams(window.location.search).get('attendanceMode') !== 'history') return
    setMode('today')
    const url = attendanceUrl(selectedClassId, 'today')
    window.history.replaceState({ ...window.history.state, attendanceDetail: Boolean(selectedClassId) }, '', url)
    announceLocation(url)
  }, [isAdmin, selectedClassId])

  useEffect(() => {
    if (screen === 'detail' && selectedClassId && !academyClass) {
      setScreen('hub')
      setSelectedClassId(null)
      const url = attendanceUrl(null, 'today')
      window.history.replaceState({ ...window.history.state, attendanceDetail: false }, '', url)
      announceLocation(url)
    }
  }, [academyClass, screen, selectedClassId])

  useEffect(() => {
    const handlePopState = () => {
      if (new URLSearchParams(window.location.search).get('page') !== 'attendance') return
      const route = attendanceRoute()
      if (!confirmDiscard({ dirty: remarksDirty, pending: mutationPending })) {
        const url = attendanceUrl(selectedClassId, mode)
        window.history.pushState({ ...window.history.state, attendanceDetail: Boolean(selectedClassId) }, '', url)
        announceLocation(url)
        return
      }
      setSelectedClassId(route.classId)
      setMode(isAdmin ? route.mode : 'today')
      setScreen(route.classId ? 'detail' : 'hub')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [confirmDiscard, isAdmin, mode, mutationPending, remarksDirty, selectedClassId])

  useEffect(() => {
    if (screen !== 'detail' || !academyClass) return
    const requestId = ++sessionRequest.current
    let active = true
    setLoading(true)
    setLoadError('')
    setRecords([])
    setCoachRecords([])
    const request = mode === 'today'
      ? ensureTodaySession(academyClass).then((selected) => ({ list: [selected], selected }))
      : getClassSessions(academyClass.id).then((list) => ({ list, selected: nearestSession(list) }))
    request.then(async ({ list, selected }) => {
      if (!active || requestId !== sessionRequest.current) return
      setSessions(list)
      setSession(selected)
      if (!selected) { setRecords([]); setCoachRecords([]); return }
      const [nextRecords, nextCoaches] = await Promise.all([getAttendance(selected.id), getCoachAttendance(selected.id)])
      if (active && requestId === sessionRequest.current) { setRecords(nextRecords); setCoachRecords(nextCoaches) }
    }).catch((error) => { if (active && requestId === sessionRequest.current) setLoadError(errorMessage(error)) }).finally(() => { if (active && requestId === sessionRequest.current) setLoading(false) })
    return () => { active = false }
  }, [academyClass, mode, reloadRequest, screen])

  function openClass(item: AcademyClass, nextMode: 'today' | 'history') {
    setMode(nextMode)
    setSelectedClassId(item.id)
    const url = attendanceUrl(item.id, nextMode)
    window.history.pushState({ ...window.history.state, attendanceDetail: true }, '', url)
    announceLocation(url)
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

  function closeDetail() {
    sessionRequest.current += 1
    if (window.history.state?.attendanceDetail) window.history.back()
    else {
      setScreen('hub')
      setSelectedClassId(null)
      const url = attendanceUrl(null, 'today')
      window.history.replaceState({ ...window.history.state, attendanceDetail: false }, '', url)
      announceLocation(url)
    }
  }

  async function selectSession(next: Session) {
    if (!confirmDiscard({ dirty: remarksDirty, pending: mutationPending })) return
    const requestId = ++sessionRequest.current
    setSession(next)
    setRecords([])
    setCoachRecords([])
    setLoadError('')
    setLoading(true)
    try {
      const [nextRecords, nextCoaches] = await Promise.all([getAttendance(next.id), getCoachAttendance(next.id)])
      if (requestId === sessionRequest.current) {
        setRecords(nextRecords)
        setCoachRecords(nextCoaches)
      }
    } catch (error) {
      if (requestId === sessionRequest.current) setLoadError(errorMessage(error))
    } finally {
      if (requestId === sessionRequest.current) setLoading(false)
    }
  }

  async function toggle(student: Student) {
    if (!session || !academyClass || bulkPending) return
    const sessionId = session.id
    const key = `${sessionId}:${student.id}`
    if (mutationLocks.current.has(key)) return
    mutationLocks.current.add(key)
    setPendingStudents((current) => new Set(current).add(student.id))
    const existing = records.find((record) => record.student_id === student.id)
    const nextStatus = existing?.status === 'Present' ? '' : 'Present'
    try {
      const saved = await setAttendanceStatus(student.id, sessionId, nextStatus)
      if (sessionRef.current?.id === sessionId) setRecords((current) => [...current.filter((record) => record.student_id !== student.id), saved])
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      mutationLocks.current.delete(key)
      setPendingStudents((current) => { const next = new Set(current); next.delete(student.id); return next })
    }
  }

  async function updateRemark(student: Student, remarks: string) {
    if (!session) return
    const sessionId = session.id
    if (remarks === (records.find((record) => record.student_id === student.id)?.remarks || '')) {
      setRemarkDrafts((current) => { const next = { ...current }; delete next[student.id]; return next })
      return
    }
    const key = `${sessionId}:${student.id}`
    if (mutationLocks.current.has(key)) return
    mutationLocks.current.add(key)
    setPendingStudents((current) => new Set(current).add(student.id))
    try {
      const saved = await setAttendanceRemark(student.id, sessionId, remarks)
      if (sessionRef.current?.id === sessionId) {
        setRecords((current) => [...current.filter((record) => record.student_id !== student.id), saved])
        setRemarkDrafts((current) => { const next = { ...current }; delete next[student.id]; return next })
      }
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      mutationLocks.current.delete(key)
      setPendingStudents((current) => { const next = new Set(current); next.delete(student.id); return next })
    }
  }

  async function updateTrial(student: Student, isTrial: boolean) {
    if (!session) return
    const sessionId = session.id
    const key = `${sessionId}:${student.id}`
    if (mutationLocks.current.has(key)) return
    mutationLocks.current.add(key)
    setPendingStudents((current) => new Set(current).add(student.id))
    try {
      const saved = await setAttendanceTrial(student.id, sessionId, isTrial)
      if (sessionRef.current?.id === sessionId) setRecords((current) => [...current.filter((record) => record.student_id !== student.id), saved])
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      mutationLocks.current.delete(key)
      setPendingStudents((current) => { const next = new Set(current); next.delete(student.id); return next })
    }
  }

  async function markAll() {
    if (!session || !academyClass || mutationPending) return
    setBulkPending(true)
    try {
      const saved = await markAllPresent(session.id, markAllEligible.map((student) => student.id))
      setRecords(saved)
      notifications.show({ color: 'green', message: `${markAllEligible.length} students marked present` })
    } catch (error) {
      try { setRecords(await getAttendance(session.id)) } catch {}
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setBulkPending(false)
    }
  }

  async function addWalkin() {
    if (!session || !academyClass || walkinPending) return
    const student = data.students.find((item) => String(item.id) === walkinId)
    if (!student) return
    setWalkinPending(true)
    try {
      const saved = await setAttendanceStatus(student.id, session.id, 'Present')
      setRecords((current) => [...current.filter((record) => record.student_id !== student.id), saved])
      setWalkinId(null)
      walkinModal.close()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setWalkinPending(false)
    }
  }

  async function deleteWalkin(studentId: number) {
    if (!session || pendingStudents.has(studentId)) return
    setPendingStudents((current) => new Set(current).add(studentId))
    try {
      await removeAttendance(studentId, session.id)
      setRecords((current) => current.filter((record) => record.student_id !== studentId))
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setPendingStudents((current) => { const next = new Set(current); next.delete(studentId); return next })
    }
  }

  async function addCoach() {
    if (!session || !coachId || coachPending) return
    setCoachPending(true)
    try {
      await addCoachAttendance(session.id, Number(coachId))
      setCoachRecords(await getCoachAttendance(session.id))
      setCoachId(null)
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setCoachPending(false)
    }
  }

  async function deletePresentCoach(nextCoachId: number) {
    if (!session || coachPending) return
    setCoachPending(true)
    try {
      await removeCoachAttendance(session.id, nextCoachId)
      setCoachRecords((current) => current.filter((item) => item.coach_id !== nextCoachId))
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setCoachPending(false)
    }
  }

  if (screen === 'hub') {
    return <AttendanceHub data={data} todayClasses={todayClasses} isAdmin={isAdmin} onToday={(item) => openClass(item, 'today')} onHistory={(item) => openClass(item, 'history')} />
  }

  return (
    <>
      <Box className="attendance-detail-header">
        <ActionIcon aria-label="Back to attendance" variant="subtle" color="gray" size={44} onClick={closeDetail}><IconArrowLeft size={24} /></ActionIcon>
        <Box><Title order={2}>{academyClass?.label || 'Attendance'}</Title><Text c="dimmed" size="sm">{mode === 'history' ? 'Past Records' : session ? dayjs(session.session_date).format('dddd, D MMMM YYYY') : 'Today'}</Text></Box>
      </Box>

      {mode === 'history' && sessions.length > 0 && <Box className="attendance-date-pills">{[...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date)).map((item) => <button type="button" key={item.id} className={session?.id === item.id ? 'active' : ''} aria-pressed={session?.id === item.id} disabled={mutationPending} onClick={() => selectSession(item)}>{dayjs(item.session_date).format('D MMM YYYY')}</button>)}</Box>}

      {loading ? <PageLoader label="Loading attendance…" /> : loadError ? <Alert color="red" title="Could not load attendance">{loadError}<Button mt="md" size="xs" onClick={() => setReloadRequest((current) => current + 1)}>Retry</Button></Alert> : session ? <Stack gap="md">
        <SimpleGrid cols={2} spacing="sm" className="attendance-summary-grid">
          <Paper className="attendance-summary-card present" p="lg" radius="lg"><Text className="attendance-summary-value">{countedAttendance}</Text><Text size="xs" c="dimmed">Counted attendance</Text><Group justify="center" gap="xs" mt="xs"><Text size="xs">All present <b>{present.length}</b></Text><Text size="xs" c="orange">Trial <b>{trialCount}</b></Text></Group></Paper>
          <Paper className="attendance-summary-card" p="lg" radius="lg"><Text className="attendance-summary-value">{notMarked}</Text><Text size="xs" c="dimmed">Not marked</Text></Paper>
        </SimpleGrid>

        <Box>
          <Text className="attendance-section-label">Coaches present</Text>
          {coachRecords.length ? <Group gap="xs" mb="sm">{coachRecords.map((item) => <Badge key={item.id} size="lg" variant="light" rightSection={<ActionIcon aria-label="Remove coach" variant="transparent" color="gray" size="xs" disabled={coachPending} onClick={() => deletePresentCoach(item.coach_id)}><IconTrash size={12} /></ActionIcon>}>{data.coaches.find((coach) => coach.id === item.coach_id)?.name || 'Coach'} · {item.hours}h</Badge>)}</Group> : <Text size="sm" c="dimmed" mb="sm">None marked yet</Text>}
          <Group wrap="nowrap"><Select aria-label="Coach to add" placeholder="-- Add coach --" value={coachId} onChange={setCoachId} data={data.coaches.filter((coach) => !coachRecords.some((item) => item.coach_id === coach.id)).map((coach) => ({ value: String(coach.id), label: coach.name }))} flex={1} /><Button variant="light" onClick={addCoach} loading={coachPending} disabled={!coachId || coachPending}>Add</Button></Group>
        </Box>

        <Group className="attendance-tools" wrap="wrap"><TextInput aria-label="Search enrolled students" leftSection={<IconSearch size={16} />} placeholder="Search students" value={search} onChange={(event) => setSearch(event.currentTarget.value)} flex={1} /><Select aria-label="Filter enrolled students by level" value={level} onChange={setLevel} data={['All', 'Beginner', 'Intermediate', 'Advanced']} w={150} /><Button leftSection={<IconCheck size={16} />} variant="light" onClick={markAll} loading={bulkPending} disabled={mutationPending}>All present</Button></Group>

        <Box>
          <Text className="attendance-section-label">Enrolled students</Text>
          {groupedStudents.length ? groupedStudents.map(([group, students]) => <Box key={group} mb="lg"><Group gap="xs" mb="xs"><Text className="attendance-level-label">{group}</Text><Badge size="sm" color="gray" variant="light">{students.length}</Badge></Group><Stack gap="xs">{students.map((student) => <AttendanceStudentCard key={`${session.id}-${student.id}`} student={student} present={records.find((record) => record.student_id === student.id)?.status === 'Present'} remarks={remarkDrafts[student.id] ?? records.find((record) => record.student_id === student.id)?.remarks ?? ''} isTrial={Boolean(records.find((record) => record.student_id === student.id)?.is_trial)} onToggle={() => toggle(student)} onTrial={(checked) => updateTrial(student, checked)} onRemarkChange={(value) => setRemarkDrafts((current) => ({ ...current, [student.id]: value }))} onRemark={(value) => updateRemark(student, value)} onPhoto={() => setPhotoView({ src: publicImageUrl('student-photos', student.photo_path), name: student.name })} disabled={bulkPending || pendingStudents.has(student.id)} />)}</Stack></Box>) : <Text c="dimmed" py="md">No students match this filter.</Text>}
        </Box>

        <Box>
          <Group justify="space-between" mb="xs"><Text className="attendance-section-label" mb={0}>Walk-ins</Text><Button size="xs" leftSection={<IconUserPlus size={15} />} onClick={openWalkinPicker}>Add walk-in</Button></Group>
          {walkins.length ? <Stack gap="xs">{walkins.map((student) => <AttendanceStudentCard key={`${session.id}-${student.id}`} student={student} present={records.find((record) => record.student_id === student.id)?.status === 'Present'} remarks={remarkDrafts[student.id] ?? records.find((record) => record.student_id === student.id)?.remarks ?? ''} isTrial={Boolean(records.find((record) => record.student_id === student.id)?.is_trial)} onToggle={() => toggle(student)} onTrial={(checked) => updateTrial(student, checked)} onRemarkChange={(value) => setRemarkDrafts((current) => ({ ...current, [student.id]: value }))} onRemark={(value) => updateRemark(student, value)} onPhoto={() => setPhotoView({ src: publicImageUrl('student-photos', student.photo_path), name: student.name })} onDelete={() => deleteWalkin(student.id)} disabled={bulkPending || pendingStudents.has(student.id)} />)}</Stack> : <Text size="sm" c="dimmed">No walk-ins recorded.</Text>}
        </Box>
      </Stack> : <EmptyState title="No sessions recorded" message="Create or generate a session from Classes, then return here." icon={IconUsers} />}

      <Modal opened={walkinOpened} onClose={walkinModal.close} title="Add walk-in" size="md" centered><Stack gap="sm"><TextInput aria-label="Search walk-in students" leftSection={<IconSearch size={17} />} placeholder="Search by name or phone…" value={walkinSearch} onChange={(event) => setWalkinSearch(event.currentTarget.value)} /><Box className="walkin-level-filters">{['All', 'Beginner', 'Intermediate', 'Advanced'].map((item) => <button type="button" key={item} className={walkinLevel === item ? 'active' : ''} onClick={() => setWalkinLevel(item)}>{item}</button>)}</Box><ScrollArea h={310} type="auto" offsetScrollbars><Stack gap={4} pr="xs">{filteredWalkins.length ? filteredWalkins.map((student) => {
        const selected = walkinId === String(student.id)
        return <button type="button" key={student.id} className={`walkin-student-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => setWalkinId(String(student.id))}><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={46} /><Box flex={1} ta="left" style={{ minWidth: 0 }}><Text fw={700} size="sm" truncate>{student.name}</Text><Text size="xs" c="dimmed" truncate>{student.level || student.status}{student.student_phone ? ` · ${student.student_phone}` : ''}</Text></Box><Badge color={student.status === 'Trial' ? 'orange' : 'green'} variant="light">{student.status}</Badge></button>
      }) : <Text c="dimmed" size="sm" ta="center" py="xl">No students match this search and level.</Text>}</Stack></ScrollArea><Button onClick={addWalkin} disabled={!walkinId || walkinPending} loading={walkinPending}>Add selected student</Button><Divider label="Student not listed?" /><Paper className="walkin-registration-handoff" p="md" radius="md" withBorder><Text fw={700}>Register a complete student profile</Text><Text size="sm" c="dimmed" mt={3}>Collect photo, identity, contacts, guardian details, school, level, monthly fee, and optional class enrollment. After saving, return here and select the student.</Text><Button mt="md" fullWidth variant="light" leftSection={<IconUserPlus size={16} />} onClick={() => { walkinModal.close(); onRegisterStudent() }}>Open student registration</Button></Paper><Button variant="default" onClick={walkinModal.close}>Cancel</Button></Stack></Modal>
      <PhotoLightbox src={photoView?.src || null} name={photoView?.name || 'Student photo'} opened={Boolean(photoView)} onClose={() => setPhotoView(null)} />
    </>
  )
}

function AttendanceHub({ data, todayClasses, isAdmin, onToday, onHistory }: { data: BootstrapData; todayClasses: AcademyClass[]; isAdmin: boolean; onToday: (item: AcademyClass) => void; onHistory: (item: AcademyClass) => void }) {
  return <>
    <PageHeader title="Attendance" description="Select a session to take or review attendance" />
    <Text className="attendance-section-label">Today’s sessions</Text>
    {todayClasses.length ? <Stack gap="sm" mb="xl">{todayClasses.map((item) => <AttendanceClassCard key={item.id} item={item} enrolled={new Set(data.enrollments.filter((entry) => entry.class_id === item.id && !entry.end_date).map((entry) => entry.student_id)).size} action="Take" onClick={() => onToday(item)} />)}</Stack> : <Text c="dimmed" size="sm" mb="xl">No classes today</Text>}
    {isAdmin && <><Text className="attendance-section-label">Review past attendance</Text><Stack gap="sm">{data.classes.map((item) => <AttendanceClassCard key={item.id} item={item} enrolled={new Set(data.enrollments.filter((entry) => entry.class_id === item.id && !entry.end_date).map((entry) => entry.student_id)).size} action="View" onClick={() => onHistory(item)} />)}</Stack></>}
  </>
}

function AttendanceClassCard({ item, enrolled, action, onClick }: { item: AcademyClass; enrolled: number; action: string; onClick: () => void }) {
  return <Paper component="button" type="button" className="attendance-class-card" p="md" radius="lg" withBorder onClick={onClick}><Box><Text fw={800}>{item.label}</Text><Text c="dimmed" size="sm" mt={3}>{item.day_of_week} · {formatTime(item.start_time)} – {formatTime(item.end_time)}</Text></Box><Box ta="right"><Text className="attendance-card-action">{action} <IconChevronRight size={14} /></Text><Text c="dimmed" size="xs">{enrolled} enrolled</Text></Box></Paper>
}

function AttendanceStudentCard({ student, present, remarks, isTrial, disabled, onToggle, onTrial, onRemarkChange, onRemark, onPhoto, onDelete }: { student: Student; present: boolean; remarks: string; isTrial: boolean; disabled: boolean; onToggle: () => void; onTrial: (checked: boolean) => void; onRemarkChange: (value: string) => void; onRemark: (value: string) => void; onPhoto: () => void; onDelete?: () => void }) {
  return <Paper className={`attendance-student-card ${present ? 'present' : ''} ${isTrial ? 'trial' : ''}`} p="md" radius="lg" withBorder><Group wrap="nowrap"><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={64} onClick={onPhoto} /><Box flex={1} style={{ minWidth: 0 }}><Text fw={750} truncate>{student.name}</Text><Text size="xs" c="dimmed">{student.status}</Text></Box><Button className="attendance-present-button" aria-pressed={present} aria-label={`Mark ${student.name} ${present ? 'not present' : 'present'}`} color={present ? 'green' : 'gray'} variant={present ? 'filled' : 'default'} disabled={disabled} loading={disabled} onClick={onToggle}>{present ? 'Present ✓' : 'Mark present'}</Button>{onDelete && <ActionIcon aria-label={`Remove ${student.name}`} color="red" variant="subtle" disabled={disabled} onClick={onDelete}><IconTrash size={17} /></ActionIcon>}</Group>{present && <Button className="attendance-trial-toggle" mt="sm" size="xs" color="orange" variant={isTrial ? 'filled' : 'light'} aria-pressed={isTrial} aria-label={`${isTrial ? 'Remove trial tag from' : 'Mark'} ${student.name}${isTrial ? '' : ' as a trial session'}`} title="Trial sessions are excluded from counted attendance" disabled={disabled} onClick={() => onTrial(!isTrial)}>{isTrial ? 'Trial session ✓' : 'Mark trial'}</Button>}<TextInput aria-label={`Remarks for ${student.name}`} value={remarks} disabled={disabled} onChange={(event) => onRemarkChange(event.currentTarget.value)} onBlur={(event) => onRemark(event.currentTarget.value)} placeholder="Remarks (optional)" mt="sm" /></Paper>
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

function announceLocation(url: string) {
  window.dispatchEvent(new CustomEvent('titan-location-change', { detail: url }))
}

function attendanceRoute() {
  const params = new URLSearchParams(window.location.search)
  const classId = Number(params.get('attendanceClass'))
  return {
    classId: Number.isInteger(classId) && classId > 0 ? classId : null,
    mode: params.get('attendanceMode') === 'history' ? 'history' as const : 'today' as const,
  }
}

function attendanceUrl(classId: number | null, mode: 'today' | 'history') {
  const url = new URL(window.location.href)
  if (classId) {
    url.searchParams.set('attendanceClass', String(classId))
    url.searchParams.set('attendanceMode', mode)
  } else {
    url.searchParams.delete('attendanceClass')
    url.searchParams.delete('attendanceMode')
  }
  return `${url.pathname}${url.search}${url.hash}`
}
