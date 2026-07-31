import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Box, Button, Checkbox, FileButton, Grid, Group, Modal, NumberInput, Paper, SegmentedControl, Select, Stack, Tabs, Text, TextInput, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconCalendarCheck, IconCamera, IconMessageCircle, IconPlus, IconSearch, IconTrash, IconUserOff, IconUsers } from '@tabler/icons-react'
import { deleteStudent, reconcileStudentEnrollments, saveStudent, uploadImage } from '../lib/api'
import { getStudentAttendance, type StudentAttendanceEntry } from '../lib/studentOperations'
import { publicImageUrl } from '../lib/supabase'
import { EmptyState, PageHeader, PersonAvatar, PhotoLightbox } from '../components/ui'
import type { BootstrapData, Student } from '../types/models'

const blankStudent: Partial<Student> & { name: string } = {
  name: '', nric: '', gender: '', date_of_birth: null, height: '', school: '', tshirt_size: '', student_phone: '', parent_name: '', parent_contact: '', email: '', father_height: '', mother_height: '', monthly_fee: null, level: '', status: 'Active',
}

export function StudentsPage({ branchId, data, isAdmin, createRequest, onCreateHandled, onChanged }: { branchId: number; data: BootstrapData; isAdmin: boolean; createRequest: number; onCreateHandled: () => void; onChanged: () => Promise<unknown> }) {
  const [opened, { open, close }] = useDisclosure(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('All')
  const [level, setLevel] = useState<string | null>('All')
  const [classFilter, setClassFilter] = useState<string | null>('All')
  const [form, setForm] = useState(blankStudent)
  const [classIds, setClassIds] = useState<string[]>([])
  const [enrollmentDates, setEnrollmentDates] = useState<Record<string, string>>({})
  const [attendance, setAttendance] = useState<StudentAttendanceEntry[]>([])
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoView, setPhotoView] = useState<{ src: string | null; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const handledCreateRequest = useRef(0)

  useEffect(() => {
    if (!isAdmin || createRequest <= handledCreateRequest.current) return
    handledCreateRequest.current = createRequest
    setForm({ ...blankStudent, status: 'Trial' })
    setClassIds([])
    setEnrollmentDates({})
    setAttendance([])
    setPhoto(null)
    open()
    onCreateHandled()
  }, [createRequest, isAdmin, onCreateHandled, open])

  const filtered = useMemo(() => data.students.filter((student) => {
    const needle = search.toLowerCase()
    const classMatch = classFilter === 'All' || data.enrollments.some((item) => item.student_id === student.id && String(item.class_id) === classFilter)
    return (!needle || [student.name, student.student_phone, student.parent_contact].some((value) => value?.toLowerCase().includes(needle)))
      && (status === 'All' || student.status === status)
      && (level === 'All' || student.level === level)
      && classMatch
  }).sort((a, b) => a.name.localeCompare(b.name)), [classFilter, data.enrollments, data.students, level, search, status])

  async function showProfile(student?: Student) {
    const next = student || blankStudent
    const enrollments = student ? data.enrollments.filter((item) => item.student_id === student.id) : []
    setForm({ ...next })
    setClassIds(enrollments.map((item) => String(item.class_id)))
    setEnrollmentDates(Object.fromEntries(enrollments.map((item) => [String(item.class_id), item.start_date])))
    setAttendance([])
    setPhoto(null)
    open()
    if (student) {
      try { setAttendance(await getStudentAttendance(student.id)) }
      catch (error) { notifications.show({ color: 'red', message: errorMessage(error) }) }
    }
  }

  function toggleClass(classId: string, checked: boolean) {
    if (checked) {
      setClassIds((current) => current.includes(classId) ? current : [...current, classId])
      setEnrollmentDates((current) => ({ ...current, [classId]: current[classId] || dayjs().format('YYYY-MM-DD') }))
    } else {
      setClassIds((current) => current.filter((id) => id !== classId))
    }
  }

  async function submit() {
    if (!isAdmin || !form.name.trim()) return
    setSaving(true)
    try {
      let saved = await saveStudent(branchId, form)
      setForm((current) => ({ ...current, id: saved.id }))
      if (photo) {
        const photoPath = await uploadImage('student-photos', branchId, photo, saved.id)
        saved = await saveStudent(branchId, { id: saved.id, name: saved.name, photo_path: photoPath })
      }
      await reconcileStudentEnrollments(saved.id, classIds.map((id) => ({ class_id: Number(id), start_date: enrollmentDates[id] || dayjs().format('YYYY-MM-DD') })))
      notifications.show({ color: 'green', title: 'Student saved', message: `${saved.name}'s profile and classes are up to date.` })
      close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', title: 'Could not save student', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function remove(student: Student) {
    if (!window.confirm(`Delete ${student.name} and all linked attendance and payment records?`)) return
    try {
      await deleteStudent(student.id)
      notifications.show({ color: 'green', message: 'Student deleted' })
      close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  const photoUrl = form.photo_path ? publicImageUrl('student-photos', form.photo_path) : null
  const age = form.date_of_birth ? dayjs().diff(dayjs(form.date_of_birth), 'year') : null

  return <>
    <PageHeader title="Students" description="Search, review, and manage student profiles" />
    <Paper className="student-filter-panel" p="md" radius="lg" withBorder mb="sm">
      <Stack gap="sm">
        <TextInput leftSection={<IconSearch size={18} />} placeholder="Search by name or phone…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        <SegmentedControl className="student-status-filter" fullWidth value={status} onChange={setStatus} data={['All', 'Active', 'Trial', 'Inactive']} />
        <Grid gutter="xs"><Grid.Col span={6}><Select value={level} onChange={setLevel} data={[{ value: 'All', label: 'All Levels' }, 'Beginner', 'Intermediate', 'Advanced']} allowDeselect={false} /></Grid.Col><Grid.Col span={6}><Select value={classFilter} onChange={setClassFilter} data={[{ value: 'All', label: 'All Classes' }, ...data.classes.map((item) => ({ value: String(item.id), label: item.label }))]} allowDeselect={false} /></Grid.Col></Grid>
      </Stack>
    </Paper>
    <Text size="xs" c="dimmed" mb="xs" px={4}>{filtered.length} students total</Text>

    {filtered.length ? <Box className="student-directory-grid">{filtered.map((student) => {
      const enrollmentCount = data.enrollments.filter((item) => item.student_id === student.id).length
      const src = publicImageUrl('student-photos', student.photo_path)
      return <Paper key={student.id} role="button" tabIndex={0} className="student-directory-card" p="sm" radius="lg" withBorder onClick={() => showProfile(student)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') showProfile(student) }}><PersonAvatar name={student.name} src={src} size={68} /><Text className="student-directory-name" fw={700} size="sm" mt="xs" lineClamp={2}>{student.name}</Text><Text size="xs" c="dimmed" mt={3}>{enrollmentCount ? `${enrollmentCount} class${enrollmentCount > 1 ? 'es' : ''}` : 'No class'}</Text><Badge mt="xs" size="sm" variant="light" color={statusColor(student.status)}>{student.status}</Badge></Paper>
    })}</Box> : <EmptyState title="No students found" message="Try changing the filters or add your first student." icon={status === 'Inactive' ? IconUserOff : IconUsers} />}

    {isAdmin && <ActionIcon className="student-fab" aria-label="Add student" size={58} radius="xl" color="orange" onClick={() => showProfile()}><IconPlus size={26} /></ActionIcon>}

    <Modal opened={opened} onClose={close} title={form.id ? form.name : 'Add student'} size="lg" centered>
      <Stack>
        <Group wrap="nowrap" className="student-profile-hero">
          <Box className="profile-photo-editor">
            <PersonAvatar name={form.name || 'New student'} src={photoUrl} size={82} onClick={() => setPhotoView({ src: photoUrl, name: form.name || 'Student photo' })} />
            {isAdmin && <FileButton onChange={setPhoto} accept="image/png,image/jpeg,image/webp">{(props) => <ActionIcon {...props} className="profile-camera-button" aria-label="Choose profile photo" color="orange" size={30} radius="xl"><IconCamera size={15} /></ActionIcon>}</FileButton>}
          </Box>
          <Box flex={1} style={{ minWidth: 0 }}><Text fw={800} size="xl" truncate>{form.name || 'New student'}</Text><Text c="dimmed" size="sm">{age != null ? `${age} years old · ` : ''}{form.level || 'No level'}{form.id ? ` · ${attendance.length} attendances` : ''}</Text><Group mt="xs" gap="xs">{form.student_phone && <Button component="a" href={waUrl(form.student_phone)} target="_blank" size="xs" variant="light" color="green" leftSection={<IconMessageCircle size={15} />}>Student WhatsApp</Button>}{form.parent_contact && <Button component="a" href={waUrl(form.parent_contact)} target="_blank" size="xs" variant="light" color="green" leftSection={<IconMessageCircle size={15} />}>Parent WhatsApp</Button>}</Group>{photo && <Text size="xs" c="orange" mt={5}>New photo selected · save to upload</Text>}</Box>
        </Group>

        <Tabs defaultValue="profile">
          <Tabs.List grow><Tabs.Tab value="profile">Profile</Tabs.Tab><Tabs.Tab value="classes">Classes</Tabs.Tab>{form.id && <Tabs.Tab value="attendance">Attendance</Tabs.Tab>}</Tabs.List>
          <Tabs.Panel value="profile" pt="md"><Grid>
            <Grid.Col span={{ base: 12, sm: 8 }}><TextInput label="Full name" value={form.name} disabled={!isAdmin} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} required /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}><Select label="Status" value={form.status} disabled={!isAdmin} onChange={(value) => setForm({ ...form, status: value as Student['status'] })} data={['Active', 'Trial', 'Inactive']} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="NRIC" value={form.nric || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, nric: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6, sm: 3 }}><Select label="Gender" value={form.gender} disabled={!isAdmin} onChange={(value) => setForm({ ...form, gender: (value || '') as Student['gender'] })} data={['Male', 'Female']} clearable /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6, sm: 3 }}><TextInput label="Date of birth" type="date" value={form.date_of_birth || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, date_of_birth: event.currentTarget.value || null })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Student phone" type="tel" value={form.student_phone || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, student_phone: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="School" value={form.school || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, school: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Parent / guardian" value={form.parent_name || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, parent_name: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Parent contact" type="tel" value={form.parent_contact || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, parent_contact: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><Select label="Level" value={form.level} disabled={!isAdmin} onChange={(value) => setForm({ ...form, level: (value || '') as Student['level'] })} data={['Beginner', 'Intermediate', 'Advanced']} clearable /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><NumberInput label="Monthly fee (RM)" value={form.monthly_fee ?? ''} disabled={!isAdmin} min={0} decimalScale={2} onChange={(value) => setForm({ ...form, monthly_fee: value === '' ? null : Number(value) })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Height" value={form.height || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, height: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="T-shirt size" value={form.tshirt_size || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, tshirt_size: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Father height" value={form.father_height || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, father_height: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Mother height" value={form.mother_height || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, mother_height: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={12}><TextInput label="Email" type="email" value={form.email || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, email: event.currentTarget.value })} /></Grid.Col>
          </Grid></Tabs.Panel>

          <Tabs.Panel value="classes" pt="md"><Stack gap="sm"><Text fw={700}>Class enrollment</Text><Text size="sm" c="dimmed">Select each class and set the date this student started.</Text>{data.classes.length ? data.classes.map((item) => {
            const id = String(item.id); const checked = classIds.includes(id)
            return <Paper key={item.id} className={`student-enrollment-row ${checked ? 'selected' : ''}`} p="md" radius="md" withBorder><Checkbox checked={checked} disabled={!isAdmin} onChange={(event) => toggleClass(id, event.currentTarget.checked)} label={<Box><Text fw={700} size="sm">{item.label}</Text><Text size="xs" c="dimmed">{item.day_of_week} · {item.start_time?.slice(0, 5) || 'Time TBC'}</Text></Box>} />{checked && <TextInput mt="sm" label="Start date" type="date" value={enrollmentDates[id] || ''} disabled={!isAdmin} onChange={(event) => setEnrollmentDates((current) => ({ ...current, [id]: event.currentTarget.value }))} required />}</Paper>
          }) : <Text c="dimmed">No classes are configured for this branch.</Text>}</Stack></Tabs.Panel>

          {form.id && <Tabs.Panel value="attendance" pt="md"><Stack>{attendance.length ? attendance.slice(0, 20).map((entry, index) => <Paper key={`${entry.attendance_date}-${index}`} p="md" radius="md" withBorder><Group justify="space-between"><Group><ThemeIcon variant="light" color="green"><IconCalendarCheck size={17} /></ThemeIcon><Box><Text fw={700}>{entry.class?.label || 'Class'}</Text><Text size="xs" c="dimmed">{dayjs(entry.attendance_date).format('D MMMM YYYY')}</Text></Box></Group>{entry.remarks && <Text size="sm" c="dimmed">{entry.remarks}</Text>}</Group></Paper>) : <Text c="dimmed" ta="center" py="xl">No attendance recorded yet.</Text>}</Stack></Tabs.Panel>}
        </Tabs>
        {isAdmin && <Group className="modal-actions" justify="space-between"><Button variant="subtle" color="red" disabled={!form.id} onClick={() => form.id && remove(form as Student)} leftSection={<IconTrash size={16} />}>Delete</Button><Group><Button variant="default" onClick={close}>Cancel</Button><Button loading={saving} onClick={submit}>Save student</Button></Group></Group>}
      </Stack>
    </Modal>
    <PhotoLightbox src={photoView?.src || null} name={photoView?.name || 'Student photo'} opened={Boolean(photoView)} onClose={() => setPhotoView(null)} />
  </>
}

function statusColor(status: Student['status']) {
  return status === 'Active' ? 'green' : status === 'Trial' ? 'orange' : 'gray'
}

function waUrl(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '60')}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
