import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Button, FileInput, Grid, Group, Menu, Modal, MultiSelect, NumberInput, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconDots, IconEdit, IconPlus, IconSearch, IconTrash, IconUserOff, IconUsers } from '@tabler/icons-react'
import { deleteEnrollment, deleteStudent, saveEnrollment, saveStudent, uploadImage } from '../lib/api'
import { publicImageUrl } from '../lib/supabase'
import { EmptyState, PageHeader, PersonAvatar } from '../components/ui'
import type { BootstrapData, Student } from '../types/models'

const blankStudent: Partial<Student> & { name: string } = {
  name: '', nric: '', gender: '', date_of_birth: null, school: '', student_phone: '', parent_name: '', parent_contact: '', email: '', monthly_fee: null, level: '', status: 'Active',
}

export function StudentsPage({ branchId, data, isAdmin, onChanged }: { branchId: number; data: BootstrapData; isAdmin: boolean; onChanged: () => Promise<unknown> }) {
  const [opened, { open, close }] = useDisclosure(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string | null>('All')
  const [level, setLevel] = useState<string | null>('All')
  const [form, setForm] = useState(blankStudent)
  const [classIds, setClassIds] = useState<string[]>([])
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => data.students.filter((student) => {
    const needle = search.toLowerCase()
    return (!needle || [student.name, student.student_phone, student.parent_contact].some((value) => value?.toLowerCase().includes(needle)))
      && (status === 'All' || student.status === status)
      && (level === 'All' || student.level === level)
  }), [data.students, level, search, status])

  function edit(student?: Student) {
    const next = student || blankStudent
    setForm({ ...next })
    setClassIds(student ? data.enrollments.filter((item) => item.student_id === student.id).map((item) => String(item.class_id)) : [])
    setPhoto(null)
    open()
  }

  async function submit() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      let saved = await saveStudent(branchId, form)
      if (photo) {
        const photoPath = await uploadImage('student-photos', branchId, photo, saved.id)
        saved = await saveStudent(branchId, { id: saved.id, name: saved.name, photo_path: photoPath })
      }
      const existing = new Set(data.enrollments.filter((item) => item.student_id === saved.id).map((item) => String(item.class_id)))
      const selected = new Set(classIds)
      await Promise.all([
        ...classIds.filter((id) => !existing.has(id)).map((id) => saveEnrollment(saved.id, Number(id), dayjs().format('YYYY-MM-DD'))),
        ...[...existing].filter((id) => !selected.has(id)).map((id) => deleteEnrollment(saved.id, Number(id))),
      ])
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
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  return (
    <>
      <PageHeader title="Students" description={`${data.students.length} student profiles in this branch`} action={isAdmin ? <Button leftSection={<IconPlus size={17} />} onClick={() => edit()}>Add student</Button> : undefined} />
      <Paper p="md" radius="lg" withBorder mb="lg">
        <Grid align="end">
          <Grid.Col span={{ base: 12, md: 6 }}><TextInput leftSection={<IconSearch size={17} />} placeholder="Search name, phone, or parent contact" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}><Select label="Status" value={status} onChange={setStatus} data={['All', 'Active', 'Trial', 'Inactive']} /></Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}><Select label="Level" value={level} onChange={setLevel} data={['All', 'Beginner', 'Intermediate', 'Advanced']} /></Grid.Col>
        </Grid>
      </Paper>

      {filtered.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
          {filtered.map((student) => {
            const enrollments = data.enrollments.filter((item) => item.student_id === student.id)
            return (
              <Paper key={student.id} p="lg" radius="lg" withBorder className="student-card">
                <Group align="flex-start" wrap="nowrap">
                  <PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={52} />
                  <Stack gap={5} flex={1} style={{ minWidth: 0 }}>
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={750} truncate>{student.name}</Text>
                      {isAdmin && <Menu position="bottom-end" shadow="md"><Menu.Target><ActionIcon variant="subtle" color="gray"><IconDots size={18} /></ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item leftSection={<IconEdit size={15} />} onClick={() => edit(student)}>Edit profile</Menu.Item><Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={() => remove(student)}>Delete</Menu.Item></Menu.Dropdown></Menu>}
                    </Group>
                    <Group gap={6}><Badge variant="light" color={statusColor(student.status)}>{student.status}</Badge>{student.level && <Badge variant="outline" color="gray">{student.level}</Badge>}</Group>
                    <Text size="sm" c="dimmed">{enrollments.length ? `${enrollments.length} class${enrollments.length > 1 ? 'es' : ''}` : 'Not enrolled'} · {student.student_phone || 'No phone'}</Text>
                    {student.monthly_fee != null && <Text size="sm" fw={650}>RM {Number(student.monthly_fee).toFixed(2)} / month</Text>}
                  </Stack>
                </Group>
              </Paper>
            )
          })}
        </SimpleGrid>
      ) : <EmptyState title="No students found" message="Try changing the filters or add your first student." icon={status === 'Inactive' ? IconUserOff : IconUsers} />}

      <Modal opened={opened} onClose={close} title={form.id ? `Edit ${form.name}` : 'Add student'} size="lg" centered>
        <Stack>
          <Grid>
            <Grid.Col span={{ base: 12, sm: 8 }}><TextInput label="Full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} required /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}><Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value as Student['status'] })} data={['Active', 'Trial', 'Inactive']} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="NRIC" value={form.nric || ''} onChange={(event) => setForm({ ...form, nric: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}><Select label="Gender" value={form.gender} onChange={(value) => setForm({ ...form, gender: (value || '') as Student['gender'] })} data={['Male', 'Female']} clearable /></Grid.Col>
            <Grid.Col span={{ base: 6, sm: 3 }}><TextInput label="Date of birth" type="date" value={form.date_of_birth || ''} onChange={(event) => setForm({ ...form, date_of_birth: event.currentTarget.value || null })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Student phone" value={form.student_phone || ''} onChange={(event) => setForm({ ...form, student_phone: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="School" value={form.school || ''} onChange={(event) => setForm({ ...form, school: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Parent / guardian" value={form.parent_name || ''} onChange={(event) => setForm({ ...form, parent_name: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><TextInput label="Parent contact" value={form.parent_contact || ''} onChange={(event) => setForm({ ...form, parent_contact: event.currentTarget.value })} /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><Select label="Level" value={form.level} onChange={(value) => setForm({ ...form, level: (value || '') as Student['level'] })} data={['Beginner', 'Intermediate', 'Advanced']} clearable /></Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}><NumberInput label="Monthly fee (RM)" value={form.monthly_fee ?? ''} min={0} decimalScale={2} onChange={(value) => setForm({ ...form, monthly_fee: value === '' ? null : Number(value) })} /></Grid.Col>
          </Grid>
          <MultiSelect label="Class enrollment" placeholder="Select classes" value={classIds} onChange={setClassIds} data={data.classes.map((item) => ({ value: String(item.id), label: item.label }))} searchable />
          <FileInput label="Profile photo" accept="image/png,image/jpeg,image/webp" value={photo} onChange={setPhoto} clearable />
          <Textarea label="Email" value={form.email || ''} onChange={(event) => setForm({ ...form, email: event.currentTarget.value })} autosize minRows={1} />
          <Group justify="flex-end"><Button variant="default" onClick={close}>Cancel</Button><Button loading={saving} onClick={submit}>Save student</Button></Group>
        </Stack>
      </Modal>
    </>
  )
}

function statusColor(status: Student['status']) {
  return status === 'Active' ? 'green' : status === 'Trial' ? 'orange' : 'gray'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
