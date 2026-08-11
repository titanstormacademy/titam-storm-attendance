import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Box, Button, Checkbox, FileButton, Grid, Group, NumberInput, Paper, SegmentedControl, Select, Stack, Tabs, Text, TextInput, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconCalendarCheck, IconCamera, IconMessageCircle, IconPlus, IconSearch, IconTrash, IconUserOff, IconUsers } from '@tabler/icons-react'
import { deleteStudent, removeReceiptIfUnreferenced, removeUploadedImage, saveStudent, saveStudentWithEnrollments, uploadImage } from '../lib/api'
import { getStudentAttendance, type StudentAttendanceEntry } from '../lib/studentOperations'
import { publicImageUrl } from '../lib/supabase'
import { EmptyState, PageHeader, PersonAvatar, PhotoLightbox, ResponsiveModal } from '../components/ui'
import { useNavigationGuard } from '../contexts/useNavigationGuard'
import type { BootstrapData, Student } from '../types/models'

const blankStudent: Partial<Student> & { name: string } = {
  name: '', nric: '', gender: '', date_of_birth: null, age: null, height: '', school: '', tshirt_size: '', student_phone: '', parent_name: '', parent_contact: '', email: '', father_height: '', mother_height: '', monthly_fee: null, level: '', status: 'Active',
}

export function StudentsPage({ branchId, data, isAdmin, createRequest, onCreateHandled, onChanged }: { branchId: number; data: BootstrapData; isAdmin: boolean; createRequest: number; onCreateHandled: () => void; onChanged: () => Promise<unknown> }) {
  const [opened, { open, close }] = useDisclosure(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string>('All')
  const [level, setLevel] = useState<string | null>('All')
  const [classFilter, setClassFilter] = useState<string | null>('All')
  const [form, setForm] = useState(blankStudent)
  const [ageMode, setAgeMode] = useState<'manual' | 'dob'>('manual')
  const [classIds, setClassIds] = useState<string[]>([])
  const [enrollmentDates, setEnrollmentDates] = useState<Record<string, string>>({})
  const [withdrawalDates, setWithdrawalDates] = useState<Record<string, string>>({})
  const [attendance, setAttendance] = useState<StudentAttendanceEntry[]>([])
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [photoView, setPhotoView] = useState<{ src: string | null; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [baseline, setBaseline] = useState('')
  const handledCreateRequest = useRef(0)
  const profileRequest = useRef(0)
  const submitLock = useRef(false)
  const currentSnapshot = studentSnapshot(form, classIds, enrollmentDates, withdrawalDates)
  const dirty = opened && (Boolean(photo) || currentSnapshot !== baseline)
  const { confirmDiscard } = useNavigationGuard('student-editor', { dirty, pending: saving })

  useEffect(() => {
    if (!photo) { setPhotoPreviewUrl(null); return }
    const url = URL.createObjectURL(photo)
    setPhotoPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  useEffect(() => {
    if (!isAdmin || createRequest <= handledCreateRequest.current) return
    handledCreateRequest.current = createRequest
    const nextForm = { ...blankStudent, status: 'Trial' } as Partial<Student> & { name: string }
    setForm(nextForm)
    setAgeMode('manual')
    setClassIds([])
    setEnrollmentDates({})
    setWithdrawalDates({})
    setAttendance([])
    setPhoto(null)
    setPhotoPreviewUrl(null)
    setBaseline(studentSnapshot(nextForm, [], {}, {}))
    open()
    onCreateHandled()
  }, [createRequest, isAdmin, onCreateHandled, open])

  const filtered = useMemo(() => data.students.filter((student) => {
    const needle = search.toLowerCase()
    const classMatch = classFilter === 'All' || data.enrollments.some((item) => item.student_id === student.id && String(item.class_id) === classFilter && !item.end_date)
    return (!needle || [student.name, student.student_phone, student.parent_contact].some((value) => value?.toLowerCase().includes(needle)))
      && (status === 'All' || student.status === status)
      && (level === 'All' || student.level === level)
      && classMatch
  }).sort((a, b) => a.name.localeCompare(b.name)), [classFilter, data.enrollments, data.students, level, search, status])

  async function showProfile(student?: Student) {
    if (opened && !confirmDiscard({ dirty, pending: saving })) return
    const requestId = ++profileRequest.current
    const next = student || blankStudent
    const nextForm = { ...next, age: next.age ?? null }
    const enrollments = student ? data.enrollments.filter((item) => item.student_id === student.id && !item.end_date) : []
    const nextClassIds = enrollments.map((item) => String(item.class_id))
    const nextDates = Object.fromEntries(enrollments.map((item) => [String(item.class_id), item.start_date]))
    setForm(nextForm)
    setAgeMode(next.date_of_birth ? 'dob' : 'manual')
    setClassIds(nextClassIds)
    setEnrollmentDates(nextDates)
    setWithdrawalDates({})
    setAttendance([])
    setAttendanceLoading(Boolean(student))
    setPhoto(null)
    setPhotoPreviewUrl(null)
    setBaseline(studentSnapshot(nextForm, nextClassIds, nextDates, {}))
    open()
    if (student) {
      try {
        const nextAttendance = await getStudentAttendance(student.id)
        if (requestId === profileRequest.current) setAttendance(nextAttendance)
      } catch (error) {
        if (requestId === profileRequest.current) notifications.show({ color: 'red', message: errorMessage(error) })
      } finally {
        if (requestId === profileRequest.current) setAttendanceLoading(false)
      }
    }
  }

  function guardedClose() {
    if (!confirmDiscard({ dirty, pending: saving })) return
    profileRequest.current += 1
    close()
  }

  function changeAgeMode(value: string) {
    const nextMode = value as 'manual' | 'dob'
    setAgeMode(nextMode)
    setForm((current) => nextMode === 'dob'
      ? { ...current, age: null }
      : { ...current, age: current.date_of_birth ? dayjs().diff(dayjs(current.date_of_birth), 'year') : current.age ?? null, date_of_birth: null })
  }

  function toggleClass(classId: string, checked: boolean) {
    if (checked) {
      setClassIds((current) => current.includes(classId) ? current : [...current, classId])
      setEnrollmentDates((current) => ({ ...current, [classId]: current[classId] || dayjs().format('YYYY-MM-DD') }))
      setWithdrawalDates((current) => { const next = { ...current }; delete next[classId]; return next })
    } else {
      setClassIds((current) => current.filter((id) => id !== classId))
      const activeEnrollment = form.id && data.enrollments.find((item) => item.student_id === form.id && String(item.class_id) === classId && !item.end_date)
      if (activeEnrollment) setWithdrawalDates((current) => ({ ...current, [classId]: dayjs().format('YYYY-MM-DD') }))
    }
  }

  async function submit() {
    if (!isAdmin || submitLock.current) return
    if (!form.name.trim()) {
      notifications.show({ color: 'red', message: 'Student name is required.' })
      return
    }
    if (classIds.some((id) => !enrollmentDates[id])) {
      notifications.show({ color: 'red', message: 'Choose a start date for every selected class.' })
      return
    }
    if (Object.values(withdrawalDates).some((date) => !date)) {
      notifications.show({ color: 'red', message: 'Choose the final enrolled date for every removed class.' })
      return
    }
    submitLock.current = true
    const requestId = profileRequest.current
    const enrollments = classIds.map((id) => ({ class_id: Number(id), start_date: enrollmentDates[id] }))
    const withdrawals = Object.entries(withdrawalDates).map(([id, end_date]) => ({ class_id: Number(id), end_date }))
    let uploadedPhotoPath: string | null = null
    setSaving(true)
    try {
      let payload = form
      if (photo && form.id) {
        uploadedPhotoPath = await uploadImage('student-photos', branchId, photo, form.id)
        payload = { ...form, photo_path: uploadedPhotoPath }
      }
      let saved: Student
      try {
        saved = await saveStudentWithEnrollments(branchId, payload, enrollments, withdrawals)
      } catch (error) {
        if (uploadedPhotoPath) await removeUploadedImage('student-photos', uploadedPhotoPath).catch(() => undefined)
        throw error
      }
      if (uploadedPhotoPath && form.photo_path && form.photo_path !== uploadedPhotoPath) await removeUploadedImage('student-photos', form.photo_path).catch(() => undefined)
      if (photo && !form.id) {
        const photoPath = await uploadImage('student-photos', branchId, photo, saved.id)
        try {
          saved = await saveStudent(branchId, { id: saved.id, name: saved.name, photo_path: photoPath })
        } catch (error) {
          await removeUploadedImage('student-photos', photoPath).catch(() => undefined)
          notifications.show({ color: 'orange', title: 'Student saved without photo', message: errorMessage(error) })
        }
      }
      notifications.show({ color: 'green', title: 'Student saved', message: `${saved.name}'s profile and classes are up to date.` })
      if (requestId === profileRequest.current) {
        setBaseline(studentSnapshot(saved, classIds, enrollmentDates, {}))
        setPhoto(null)
        close()
      }
      try { await onChanged() } catch (error) { notifications.show({ color: 'orange', title: 'Student saved, refresh failed', message: errorMessage(error) }) }
    } catch (error) {
      notifications.show({ color: 'red', title: 'Could not save student', message: errorMessage(error) })
    } finally {
      submitLock.current = false
      if (requestId === profileRequest.current) setSaving(false)
    }
  }

  async function remove(student: Student) {
    if (!window.confirm(`Delete ${student.name} and all linked attendance and payment records?`)) return
    try {
      const receiptPaths = [...new Set(data.payments.filter((payment) => payment.student_id === student.id && payment.receipt_path).map((payment) => payment.receipt_path!))]
      await deleteStudent(branchId, student.id)
      if (student.photo_path) await removeUploadedImage('student-photos', student.photo_path).catch(() => undefined)
      await Promise.all(receiptPaths.map((path) => removeReceiptIfUnreferenced(path).catch(() => undefined)))
      notifications.show({ color: 'green', message: 'Student deleted' })
      close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  const photoUrl = photoPreviewUrl || (form.photo_path ? publicImageUrl('student-photos', form.photo_path) : null)
  const displayAge = form.date_of_birth ? dayjs().diff(dayjs(form.date_of_birth), 'year') : form.age ?? null

  return <>
    <PageHeader title="Students" description="Search, review, and manage student profiles" />
    <Paper className="student-filter-panel" p="md" radius="lg" withBorder mb="sm">
      <Stack gap="sm">
        <TextInput aria-label="Search students" leftSection={<IconSearch size={18} />} placeholder="Search by name or phone…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        <SegmentedControl className="student-status-filter" fullWidth value={status} onChange={setStatus} data={['All', 'Active', 'Trial', 'Inactive']} />
        <Grid gutter="xs"><Grid.Col span={6}><Select aria-label="Filter students by level" value={level} onChange={setLevel} data={[{ value: 'All', label: 'All Levels' }, 'Beginner', 'Intermediate', 'Advanced']} allowDeselect={false} /></Grid.Col><Grid.Col span={6}><Select aria-label="Filter students by class" value={classFilter} onChange={setClassFilter} data={[{ value: 'All', label: 'All Classes' }, ...data.classes.map((item) => ({ value: String(item.id), label: item.label }))]} allowDeselect={false} /></Grid.Col></Grid>
      </Stack>
    </Paper>
    <Text size="xs" c="dimmed" mb="xs" px={4}>{filtered.length === data.students.length ? `${filtered.length} students` : `${filtered.length} of ${data.students.length} students`}</Text>

    {filtered.length ? <Box className="student-directory-grid">{filtered.map((student) => {
      const enrollmentCount = new Set(data.enrollments.filter((item) => item.student_id === student.id && !item.end_date).map((item) => item.class_id)).size
      const src = publicImageUrl('student-photos', student.photo_path)
      return <Paper key={student.id} component="button" type="button" className="student-directory-card" p="sm" radius="lg" withBorder onClick={() => showProfile(student)}><PersonAvatar name={student.name} src={src} size={68} /><Text className="student-directory-name" fw={700} size="sm" mt="xs" lineClamp={2}>{student.name}</Text><Text size="xs" c="dimmed" mt={3}>{enrollmentCount ? `${enrollmentCount} class${enrollmentCount > 1 ? 'es' : ''}` : 'No class'}</Text><Badge mt="xs" size="sm" variant="light" color={statusColor(student.status)}>{student.status}</Badge></Paper>
    })}</Box> : <EmptyState title="No students found" message="Try changing the filters or add your first student." icon={status === 'Inactive' ? IconUserOff : IconUsers} />}

    {isAdmin && <ActionIcon className="student-fab" aria-label="Add student" size={58} radius="xl" color="orange" onClick={() => showProfile()}><IconPlus size={26} /></ActionIcon>}

    <ResponsiveModal classNames={{ inner: 'student-profile-modal-inner', content: 'student-profile-modal-content', body: 'student-profile-modal-body' }} transitionProps={{ transition: 'fade', duration: 0 }} opened={opened} onClose={guardedClose} title={form.id ? form.name : 'Add student'} size="lg" centered closeOnClickOutside={!saving} closeOnEscape={!saving}>
      <Stack>
        <Group wrap="nowrap" className="student-profile-hero">
          <Box className="profile-photo-editor">
            <PersonAvatar name={form.name || 'New student'} src={photoUrl} size={82} onClick={() => setPhotoView({ src: photoUrl, name: form.name || 'Student photo' })} />
            {isAdmin && <FileButton onChange={setPhoto} accept="image/png,image/jpeg,image/webp">{(props) => <ActionIcon {...props} className="profile-camera-button" aria-label="Choose profile photo" color="orange" size={30} radius="xl"><IconCamera size={15} /></ActionIcon>}</FileButton>}
          </Box>
          <Box flex={1} style={{ minWidth: 0 }}><Text fw={800} size="xl" truncate>{form.name || 'New student'}</Text><Text c="dimmed" size="sm">{displayAge != null ? `${displayAge} years old · ` : ''}{form.level || 'No level'}{form.id ? ` · ${attendance.length} attendances` : ''}</Text><Group mt="xs" gap="xs">{form.student_phone && <Button component="a" href={waUrl(form.student_phone)} target="_blank" size="xs" variant="light" color="green" leftSection={<IconMessageCircle size={15} />}>Student WhatsApp</Button>}{form.parent_contact && <Button component="a" href={waUrl(form.parent_contact)} target="_blank" size="xs" variant="light" color="green" leftSection={<IconMessageCircle size={15} />}>Parent WhatsApp</Button>}</Group>{photo && <Text size="xs" c="orange" mt={5}>Photo preview · save to upload</Text>}</Box>
        </Group>

        <Tabs defaultValue="profile">
          <Tabs.List grow><Tabs.Tab value="profile">Profile</Tabs.Tab><Tabs.Tab value="classes">Classes</Tabs.Tab>{form.id && <Tabs.Tab value="attendance">Attendance</Tabs.Tab>}</Tabs.List>
          <Tabs.Panel value="profile" pt="md"><Grid gutter="sm" className="student-profile-form">
            <Grid.Col span={{ base: 12, xs: 8 }}><TextInput label="Full name" value={form.name} disabled={!isAdmin} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} required /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}><Select label="Status" value={form.status} disabled={!isAdmin} onChange={(value) => setForm({ ...form, status: value as Student['status'] })} data={['Active', 'Trial', 'Inactive']} comboboxProps={{ zIndex: 600 }} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 5 }}><TextInput label="NRIC" value={form.nric || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, nric: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 3 }}><Select label="Gender" value={form.gender} disabled={!isAdmin} onChange={(value) => setForm({ ...form, gender: (value || '') as Student['gender'] })} data={['Male', 'Female']} clearable comboboxProps={{ zIndex: 600 }} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}><Text size="sm" fw={500} mb={5}>Age entry</Text><SegmentedControl aria-label="Age entry" fullWidth value={ageMode} disabled={!isAdmin} onChange={changeAgeMode} data={[{ value: 'manual', label: 'Manual age' }, { value: 'dob', label: 'DOB' }]} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}>{ageMode === 'dob' ? <TextInput label="Date of birth" description={displayAge != null ? `Calculated age: ${displayAge}` : 'Age calculates automatically'} type="date" max={dayjs().format('YYYY-MM-DD')} value={form.date_of_birth || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, date_of_birth: event.currentTarget.value || null, age: null })} /> : <NumberInput label="Age" description="Enter age in years" value={form.age ?? ''} disabled={!isAdmin} min={0} max={120} allowDecimal={false} onChange={(value) => setForm({ ...form, age: value === '' ? null : Number(value), date_of_birth: null })} />}</Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}><TextInput label="Student phone" type="tel" value={form.student_phone || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, student_phone: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}><TextInput label="School" value={form.school || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, school: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Parent / guardian" value={form.parent_name || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, parent_name: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Parent contact" type="tel" value={form.parent_contact || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, parent_contact: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}><Select label="Level" value={form.level} disabled={!isAdmin} onChange={(value) => setForm({ ...form, level: (value || '') as Student['level'] })} data={['Beginner', 'Intermediate', 'Advanced']} clearable comboboxProps={{ zIndex: 600 }} /></Grid.Col>
            <Grid.Col span={{ base: 12, xs: 4 }}><NumberInput label="Monthly fee (RM)" value={form.monthly_fee ?? ''} disabled={!isAdmin} min={0} decimalScale={2} onChange={(value) => setForm({ ...form, monthly_fee: value === '' ? null : Number(value) })} /></Grid.Col>
            <Grid.Col span={{ base: 6, xs: 2 }}><TextInput label="Height" value={form.height || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, height: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 6, xs: 2 }}><TextInput label="T-shirt" value={form.tshirt_size || ''} disabled={!isAdmin} onChange={(event) => setForm({ ...form, tshirt_size: event.currentTarget.value })} /></Grid.Col>
          </Grid></Tabs.Panel>

          <Tabs.Panel value="classes" pt="md"><Stack gap="sm"><Text fw={700}>Class enrollment</Text><Text size="sm" c="dimmed">Select each class and set the date this student started.</Text>{data.classes.length ? data.classes.map((item) => {
            const id = String(item.id); const checked = classIds.includes(id)
            return <Paper key={item.id} className={`student-enrollment-row ${checked ? 'selected' : ''}`} p="md" radius="md" withBorder><Checkbox checked={checked} disabled={!isAdmin || saving} onChange={(event) => toggleClass(id, event.currentTarget.checked)} label={<Box><Text fw={700} size="sm">{item.label}</Text><Text size="xs" c="dimmed">{item.day_of_week} · {item.start_time?.slice(0, 5) || 'Time TBC'}</Text></Box>} />{checked && <TextInput mt="sm" label="Start date" type="date" value={enrollmentDates[id] || ''} disabled={!isAdmin || saving} onChange={(event) => setEnrollmentDates((current) => ({ ...current, [id]: event.currentTarget.value }))} required />}{!checked && withdrawalDates[id] != null && <TextInput mt="sm" label="Final enrolled date" description="Attendance through this date remains part of the enrollment history." type="date" value={withdrawalDates[id]} disabled={!isAdmin || saving} min={enrollmentDates[id]} max={dayjs().format('YYYY-MM-DD')} onChange={(event) => setWithdrawalDates((current) => ({ ...current, [id]: event.currentTarget.value }))} required />}</Paper>
          }) : <Text c="dimmed">No classes are configured for this branch.</Text>}</Stack></Tabs.Panel>

          {form.id && <Tabs.Panel value="attendance" pt="md"><Stack>{attendanceLoading ? <Text c="dimmed" ta="center" py="xl">Loading attendance…</Text> : attendance.length ? attendance.slice(0, 20).map((entry, index) => <Paper key={`${entry.attendance_date}-${index}`} p="md" radius="md" withBorder><Group justify="space-between"><Group><ThemeIcon variant="light" color="green"><IconCalendarCheck size={17} /></ThemeIcon><Box><Group gap="xs"><Text fw={700}>{entry.class?.label || 'Class'}</Text>{entry.is_trial && <Badge size="xs" color="orange" variant="light">Trial</Badge>}</Group><Text size="xs" c="dimmed">{dayjs(entry.attendance_date).format('D MMMM YYYY')}</Text></Box></Group>{entry.remarks && <Text size="sm" c="dimmed">{entry.remarks}</Text>}</Group></Paper>) : <Text c="dimmed" ta="center" py="xl">No attendance recorded yet.</Text>}</Stack></Tabs.Panel>}
        </Tabs>
        {isAdmin && <Group className="modal-actions" justify="space-between"><Button variant="subtle" color="red" disabled={!form.id || saving} onClick={() => form.id && remove(form as Student)} leftSection={<IconTrash size={16} />}>Delete</Button><Group><Button variant="default" disabled={saving} onClick={guardedClose}>Cancel</Button><Button loading={saving} onClick={submit}>Save student</Button></Group></Group>}
      </Stack>
    </ResponsiveModal>
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

function studentSnapshot(form: Partial<Student> & { name: string }, classIds: string[], enrollmentDates: Record<string, string>, withdrawalDates: Record<string, string>) {
  return JSON.stringify({ form, classIds: [...classIds].sort(), enrollmentDates, withdrawalDates })
}
