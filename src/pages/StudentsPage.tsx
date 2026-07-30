import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Box, Button, FileInput, Grid, Group, Menu, Modal, MultiSelect, NumberInput, Paper, Select, SimpleGrid, Stack, Tabs, Text, TextInput, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconCalendarCheck, IconDots, IconEdit, IconMessageCircle, IconPlus, IconSearch, IconTrash, IconUserOff, IconUsers } from '@tabler/icons-react'
import { deleteStudent, reconcileStudentEnrollments, saveStudent, uploadImage } from '../lib/api'
import { getStudentAttendance, type StudentAttendanceEntry } from '../lib/studentOperations'
import { publicImageUrl } from '../lib/supabase'
import { EmptyState, PageHeader, PersonAvatar } from '../components/ui'
import type { BootstrapData, Student } from '../types/models'

const blankStudent: Partial<Student> & { name: string } = {
  name: '', nric: '', gender: '', date_of_birth: null, height: '', school: '', tshirt_size: '', student_phone: '', parent_name: '', parent_contact: '', email: '', father_height: '', mother_height: '', monthly_fee: null, level: '', status: 'Active',
}

export function StudentsPage({ branchId, data, isAdmin, onChanged }: { branchId: number; data: BootstrapData; isAdmin: boolean; onChanged: () => Promise<unknown> }) {
  const [opened, { open, close }] = useDisclosure(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string | null>('All')
  const [level, setLevel] = useState<string | null>('All')
  const [classFilter, setClassFilter] = useState<string | null>('All')
  const [form, setForm] = useState(blankStudent)
  const [classIds, setClassIds] = useState<string[]>([])
  const [enrollmentDates, setEnrollmentDates] = useState<Record<string, string>>({})
  const [attendance, setAttendance] = useState<StudentAttendanceEntry[]>([])
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => data.students.filter((student) => {
    const needle = search.toLowerCase()
    const classMatch = classFilter === 'All' || data.enrollments.some((item) => item.student_id === student.id && String(item.class_id) === classFilter)
    return (!needle || [student.name, student.student_phone, student.parent_contact].some((value) => value?.toLowerCase().includes(needle)))
      && (status === 'All' || student.status === status)
      && (level === 'All' || student.level === level)
      && classMatch
  }), [classFilter, data.enrollments, data.students, level, search, status])

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
      try {
        setAttendance(await getStudentAttendance(student.id))
      } catch (error) {
        notifications.show({ color: 'red', message: errorMessage(error) })
      }
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
      notifications.show({ color: 'green', title: 'Student saved', message: `${saved.name}'s profile is up to date.` })
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

  return (
    <>
      <PageHeader title="Students" description={`${data.students.length} student profiles in this branch`} action={isAdmin ? <Button leftSection={<IconPlus size={17} />} onClick={() => showProfile()}>Add student</Button> : undefined} />
      <Paper p="md" radius="lg" withBorder mb="lg">
        <Grid align="end">
          <Grid.Col span={{ base: 12, md: 5 }}><TextInput leftSection={<IconSearch size={17} />} placeholder="Search name, phone, or parent contact" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 12, xs: 4, md: 2 }}><Select label="Status" value={status} onChange={setStatus} data={['All', 'Active', 'Trial', 'Inactive']} /></Grid.Col>
          <Grid.Col span={{ base: 12, xs: 4, md: 2 }}><Select label="Level" value={level} onChange={setLevel} data={['All', 'Beginner', 'Intermediate', 'Advanced']} /></Grid.Col>
          <Grid.Col span={{ base: 12, xs: 4, md: 3 }}><Select label="Class" value={classFilter} onChange={setClassFilter} data={[{ value: 'All', label: 'All classes' }, ...data.classes.map((item) => ({ value: String(item.id), label: item.label }))]} /></Grid.Col>
        </Grid>
      </Paper>

      {filtered.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
          {filtered.map((student) => {
            const enrollments = data.enrollments.filter((item) => item.student_id === student.id)
            return (
              <Paper key={student.id} role="button" tabIndex={0} p={{ base: 'md', sm: 'lg' }} radius="lg" withBorder className="student-card student-card-button" onClick={() => showProfile(student)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') showProfile(student) }}>
                <Group align="flex-start" wrap="nowrap">
                  <PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={52} />
                  <Stack gap={5} flex={1} style={{ minWidth: 0 }}>
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={750} truncate>{student.name}</Text>
                      {isAdmin && <Menu position="bottom-end" shadow="md"><Menu.Target><ActionIcon aria-label={`Actions for ${student.name}`} size={44} variant="subtle" color="gray" onClick={(event) => event.stopPropagation()}><IconDots size={18} /></ActionIcon></Menu.Target><Menu.Dropdown onClick={(event) => event.stopPropagation()}><Menu.Item leftSection={<IconEdit size={15} />} onClick={() => showProfile(student)}>Edit profile</Menu.Item><Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={() => remove(student)}>Delete</Menu.Item></Menu.Dropdown></Menu>}
                    </Group>
                    <Group gap={6}><Badge variant="light" color={statusColor(student.status)}>{student.status}</Badge>{student.level && <Badge variant="outline" color="gray">{student.level}</Badge>}</Group>
                    <Text size="sm" c="dimmed">{enrollments.length ? `${enrollments.length} class${enrollments.length > 1 ? 'es' : ''}` : 'Not enrolled'} · {student.student_phone || 'No phone'}</Text>
                    {student.monthly_fee != null && isAdmin && <Text size="sm" fw={650}>RM {Number(student.monthly_fee).toFixed(2)} / month</Text>}
                  </Stack>
                </Group>
              </Paper>
            )
          })}
        </SimpleGrid>
      ) : <EmptyState title="No students found" message="Try changing the filters or add your first student." icon={status === 'Inactive' ? IconUserOff : IconUsers} />}

      <Modal opened={opened} onClose={close} title={form.id ? form.name : 'Add student'} size="lg" centered>
        <Stack>
          {form.id && <Group wrap="nowrap"><PersonAvatar name={form.name} src={photoUrl} size={72} /><Box flex={1} style={{ minWidth: 0 }}><Text fw={800} size="xl" truncate>{form.name}</Text><Text c="dimmed" size="sm">{age != null ? `${age} years old · ` : ''}{form.level || 'No level'} · {attendance.length} attendances</Text><Group mt="xs" gap="xs">{form.student_phone && <Button component="a" href={waUrl(form.student_phone)} target="_blank" size="xs" variant="light" color="green" leftSection={<IconMessageCircle size={15} />}>Student WhatsApp</Button>}{form.parent_contact && <Button component="a" href={waUrl(form.parent_contact)} target="_blank" size="xs" variant="light" color="green" leftSection={<IconMessageCircle size={15} />}>Parent WhatsApp</Button>}</Group></Box></Group>}
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
              {isAdmin && <Grid.Col span={12}><FileInput label="Profile photo" accept="image/png,image/jpeg,image/webp" value={photo} onChange={setPhoto} clearable /></Grid.Col>}
            </Grid></Tabs.Panel>
            <Tabs.Panel value="classes" pt="md"><Stack>
              <MultiSelect label="Class enrollment" placeholder="Select classes" value={classIds} disabled={!isAdmin} onChange={(values) => { setClassIds(values); setEnrollmentDates((current) => Object.fromEntries(values.map((id) => [id, current[id] || dayjs().format('YYYY-MM-DD')]))) }} data={data.classes.map((item) => ({ value: String(item.id), label: item.label }))} searchable />
              {classIds.map((id) => <Paper key={id} p="md" radius="md" withBorder><Group justify="space-between" align="end"><Box flex={1}><Text fw={700}>{data.classes.find((item) => String(item.id) === id)?.label || 'Class'}</Text><Text size="xs" c="dimmed">Enrollment start date</Text></Box><TextInput aria-label="Enrollment start date" type="date" value={enrollmentDates[id] || ''} disabled={!isAdmin} onChange={(event) => setEnrollmentDates({ ...enrollmentDates, [id]: event.currentTarget.value })} /></Group></Paper>)}
            </Stack></Tabs.Panel>
            {form.id && <Tabs.Panel value="attendance" pt="md"><Stack>{attendance.length ? attendance.slice(0, 20).map((entry, index) => <Paper key={`${entry.attendance_date}-${index}`} p="md" radius="md" withBorder><Group justify="space-between"><Group><ThemeIcon variant="light" color="green"><IconCalendarCheck size={17} /></ThemeIcon><Box><Text fw={700}>{entry.class?.label || 'Class'}</Text><Text size="xs" c="dimmed">{dayjs(entry.attendance_date).format('D MMMM YYYY')}</Text></Box></Group>{entry.remarks && <Text size="sm" c="dimmed">{entry.remarks}</Text>}</Group></Paper>) : <Text c="dimmed" ta="center" py="xl">No attendance recorded yet.</Text>}</Stack></Tabs.Panel>}
          </Tabs>
          {isAdmin && <Group className="modal-actions" justify="space-between"><Button variant="subtle" color="red" disabled={!form.id} onClick={() => form.id && remove(form as Student)}>Delete</Button><Group><Button variant="default" onClick={close}>Cancel</Button><Button loading={saving} onClick={submit}>Save student</Button></Group></Group>}
        </Stack>
      </Modal>
    </>
  )
}

function statusColor(status: Student['status']) {
  return status === 'Active' ? 'green' : status === 'Trial' ? 'orange' : 'gray'
}

function waUrl(phone: string) {
  const digits = phone.replace(/\D/g, '').replace(/^0/, '60')
  return `https://wa.me/${digits}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
