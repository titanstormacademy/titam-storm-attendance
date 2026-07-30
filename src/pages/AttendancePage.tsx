import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Box, Button, Checkbox, Divider, Grid, Group, Modal, Paper, Select, Stack, Text, TextInput, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconBallBasketball, IconCheck, IconClock, IconPlus, IconSearch, IconTrash, IconUserPlus, IconUsers } from '@tabler/icons-react'
import { addCoachAttendance, ensureTodaySession, getAttendance, getCoachAttendance, removeAttendance, removeCoachAttendance, saveAttendance, saveStudent } from '../lib/api'
import { EmptyState, PageHeader, PersonAvatar } from '../components/ui'
import type { Attendance, BootstrapData, CoachAttendance, Session, Student } from '../types/models'

export function AttendancePage({ branchId, data, onChanged }: { branchId: number; data: BootstrapData; onChanged: () => Promise<unknown> }) {
  const today = dayjs().format('YYYY-MM-DD')
  const todayClasses = data.classes.filter((item) => item.day_of_week === dayjs().format('dddd'))
  const [selectedClassId, setSelectedClassId] = useState<number | null>(todayClasses[0]?.id || null)
  const [session, setSession] = useState<Session | null>(null)
  const [records, setRecords] = useState<Attendance[]>([])
  const [coachRecords, setCoachRecords] = useState<CoachAttendance[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [walkinOpened, walkinModal] = useDisclosure(false)
  const [walkinId, setWalkinId] = useState<string | null>(null)
  const [quickName, setQuickName] = useState('')
  const [quickPhone, setQuickPhone] = useState('')
  const [coachId, setCoachId] = useState<string | null>(null)

  const academyClass = data.classes.find((item) => item.id === selectedClassId) || null
  const enrolledIds = useMemo(() => new Set(data.enrollments.filter((item) => item.class_id === selectedClassId).map((item) => item.student_id)), [data.enrollments, selectedClassId])
  const enrolled = data.students.filter((student) => enrolledIds.has(student.id) && student.status !== 'Inactive' && student.name.toLowerCase().includes(search.toLowerCase()))
  const walkins = data.students.filter((student) => !enrolledIds.has(student.id) && records.some((record) => record.student_id === student.id))
  const possibleWalkins = data.students.filter((student) => !enrolledIds.has(student.id) && student.status !== 'Inactive')
  const presentCount = records.filter((record) => record.status === 'Present').length

  useEffect(() => {
    if (!academyClass) {
      setSession(null)
      setRecords([])
      return
    }
    let active = true
    setLoading(true)
    ensureTodaySession(academyClass)
      .then(async (nextSession) => {
        const [nextRecords, nextCoaches] = await Promise.all([getAttendance(nextSession.id), getCoachAttendance(nextSession.id)])
        if (active) {
          setSession(nextSession)
          setRecords(nextRecords)
          setCoachRecords(nextCoaches)
        }
      })
      .catch((error) => notifications.show({ color: 'red', message: errorMessage(error) }))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [academyClass])

  async function toggle(student: Student) {
    if (!session || !academyClass) return
    const existing = records.find((record) => record.student_id === student.id)
    const nextStatus = existing?.status === 'Present' ? '' : 'Present'
    const optimistic: Attendance = {
      student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId,
      attendance_date: today, status: nextStatus, remarks: existing?.remarks || '',
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
        student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId,
        attendance_date: today, status: existing?.status || '', remarks,
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
      await Promise.all(enrolled.map((student) => saveAttendance({
        student_id: student.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId,
        attendance_date: today, status: 'Present', remarks: records.find((record) => record.student_id === student.id)?.remarks || '',
      })))
      setRecords(await getAttendance(session.id))
      notifications.show({ color: 'green', message: `${enrolled.length} students marked present` })
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function addWalkin(student?: Student) {
    if (!session || !academyClass) return
    setLoading(true)
    try {
      let nextStudent = student || data.students.find((item) => String(item.id) === walkinId)
      if (!nextStudent && quickName.trim()) {
        nextStudent = await saveStudent(branchId, { name: quickName.trim(), student_phone: quickPhone.trim(), status: 'Trial' })
        await onChanged()
      }
      if (!nextStudent) return
      await saveAttendance({ student_id: nextStudent.id, session_id: session.id, class_id: academyClass.id, branch_id: branchId, attendance_date: today, status: 'Present', remarks: '' })
      setRecords(await getAttendance(session.id))
      setWalkinId(null); setQuickName(''); setQuickPhone(''); walkinModal.close()
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

  return (
    <>
      <PageHeader title="Attendance" description={`${dayjs().format('dddd, D MMMM')} · present-only attendance`} />
      {todayClasses.length ? (
        <Grid gutter="xl">
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Paper p="md" radius="lg" withBorder className="attendance-class-list">
              <Text size="xs" fw={800} c="dimmed" tt="uppercase" mb="sm">Today’s classes</Text>
              <Stack gap={8}>
                {todayClasses.map((item) => {
                  const count = data.enrollments.filter((enrollment) => enrollment.class_id === item.id).length
                  return <button key={item.id} className={`class-picker ${selectedClassId === item.id ? 'active' : ''}`} onClick={() => setSelectedClassId(item.id)}><ThemeIcon variant={selectedClassId === item.id ? 'filled' : 'light'} color="orange" radius="md"><IconBallBasketball size={19} /></ThemeIcon><span><strong>{item.label}</strong><small>{formatTime(item.start_time)} · {count} students</small></span></button>
                })}
              </Stack>
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 8 }}>
            {academyClass && <Stack>
              <Paper p="lg" radius="lg" withBorder>
                <Group justify="space-between" align="flex-start"><div><Text fw={800} size="lg">{academyClass.label}</Text><Group gap={8} mt={5}><Badge leftSection={<IconClock size={12} />} variant="light">{formatTime(academyClass.start_time)} – {formatTime(academyClass.end_time)}</Badge><Badge color="green" variant="light">{presentCount} present</Badge></Group></div><Button leftSection={<IconCheck size={16} />} variant="light" onClick={markAll} loading={loading}>All present</Button></Group>
                <Divider my="md" />
                <Text size="xs" fw={800} c="dimmed" tt="uppercase" mb={8}>Coaches present</Text>
                <Group gap="xs">
                  {coachRecords.map((item) => <Badge key={item.id} size="lg" variant="light" rightSection={<ActionIcon variant="transparent" color="gray" size="xs" onClick={() => deletePresentCoach(item.coach_id)}><IconTrash size={12} /></ActionIcon>}>{data.coaches.find((coach) => coach.id === item.coach_id)?.name || 'Coach'} · {item.hours}h</Badge>)}
                  <Select placeholder="Add coach" value={coachId} onChange={setCoachId} data={data.coaches.filter((coach) => !coachRecords.some((item) => item.coach_id === coach.id)).map((coach) => ({ value: String(coach.id), label: coach.name }))} w={180} size="xs" />
                  <ActionIcon variant="light" size="lg" onClick={addCoach} disabled={!coachId}><IconPlus size={17} /></ActionIcon>
                </Group>
              </Paper>
              <Paper p="md" radius="lg" withBorder>
                <Group justify="space-between" mb="md"><TextInput leftSection={<IconSearch size={16} />} placeholder="Search students" value={search} onChange={(event) => setSearch(event.currentTarget.value)} flex={1} /><Button variant="default" leftSection={<IconUserPlus size={16} />} onClick={walkinModal.open}>Walk-in</Button></Group>
                <Stack gap={0}>
                  {enrolled.map((student) => <AttendanceRow key={student.id} student={student} present={records.find((record) => record.student_id === student.id)?.status === 'Present'} remarks={records.find((record) => record.student_id === student.id)?.remarks || ''} onToggle={() => toggle(student)} onRemark={(value) => updateRemark(student, value)} />)}
                  {walkins.length > 0 && <><Divider label="Walk-ins" labelPosition="left" my="md" />{walkins.map((student) => <AttendanceRow key={student.id} student={student} present remarks={records.find((record) => record.student_id === student.id)?.remarks || ''} onToggle={() => toggle(student)} onRemark={(value) => updateRemark(student, value)} onDelete={() => deleteWalkin(student.id)} />)}</>}
                </Stack>
              </Paper>
            </Stack>}
          </Grid.Col>
        </Grid>
      ) : <EmptyState title="No classes scheduled today" message="Classes assigned to today will appear here automatically." icon={IconUsers} />}

      <Modal opened={walkinOpened} onClose={walkinModal.close} title="Add walk-in" centered>
        <Stack>
          <Select label="Existing student" placeholder="Search student" searchable value={walkinId} onChange={setWalkinId} data={possibleWalkins.map((student) => ({ value: String(student.id), label: `${student.name} · ${student.status}` }))} />
          <Button onClick={() => addWalkin()} disabled={!walkinId} loading={loading}>Mark selected student present</Button>
          <Divider label="or register a trial student" />
          <TextInput label="Student name" value={quickName} onChange={(event) => setQuickName(event.currentTarget.value)} />
          <TextInput label="Phone (optional)" value={quickPhone} onChange={(event) => setQuickPhone(event.currentTarget.value)} />
          <Button variant="light" onClick={() => addWalkin()} disabled={!quickName.trim()} loading={loading}>Register and mark present</Button>
        </Stack>
      </Modal>
    </>
  )
}

function AttendanceRow({ student, present, remarks, onToggle, onRemark, onDelete }: { student: Student; present: boolean; remarks: string; onToggle: () => void; onRemark: (value: string) => void; onDelete?: () => void }) {
  return (
    <Box className={`attendance-row ${present ? 'present' : ''}`}>
      <Group wrap="nowrap">
        <Checkbox checked={present} onChange={onToggle} size="lg" color="green" />
        <PersonAvatar name={student.name} size={40} />
        <Box flex={1}><Text fw={700}>{student.name}</Text><Text size="xs" c="dimmed">{student.level || student.status}</Text></Box>
        <TextInput defaultValue={remarks} onBlur={(event) => onRemark(event.currentTarget.value)} placeholder="Remarks" className="attendance-remark" />
        {onDelete && <ActionIcon color="red" variant="subtle" onClick={onDelete}><IconTrash size={17} /></ActionIcon>}
      </Group>
    </Box>
  )
}

function formatTime(value: string | null) {
  return value ? dayjs(`2000-01-01T${value}`).format('h:mm A') : 'Time TBC'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
