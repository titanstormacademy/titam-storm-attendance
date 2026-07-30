import { useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Badge, Button, Grid, Group, Modal, NumberFormatter, Paper, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconBallBasketball, IconCalendarPlus, IconClock, IconEdit, IconPlus, IconTrash, IconUsers } from '@tabler/icons-react'
import { deleteClass, generateSessions, saveClass } from '../lib/api'
import { EmptyState, PageHeader } from '../components/ui'
import type { AcademyClass, BootstrapData } from '../types/models'

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const blankClass: Partial<AcademyClass> & { label: string; day_of_week: string } = { label: '', day_of_week: 'Saturday', start_time: '09:00', end_time: '10:30', coach_id: null }

export function ClassesPage({ branchId, data, onChanged }: { branchId: number; data: BootstrapData; onChanged: () => Promise<unknown> }) {
  const [formOpened, formModal] = useDisclosure(false)
  const [generateOpened, generateModal] = useDisclosure(false)
  const [form, setForm] = useState(blankClass)
  const [target, setTarget] = useState<AcademyClass | null>(null)
  const [fromDate, setFromDate] = useState(dayjs().startOf('month').format('YYYY-MM-DD'))
  const [toDate, setToDate] = useState(dayjs().add(3, 'month').endOf('month').format('YYYY-MM-DD'))
  const [saving, setSaving] = useState(false)

  function edit(item?: AcademyClass) {
    setForm(item ? { ...item } : { ...blankClass })
    formModal.open()
  }

  async function submit() {
    if (!form.label.trim()) return
    setSaving(true)
    try {
      await saveClass(branchId, form)
      notifications.show({ color: 'green', message: 'Class saved' })
      formModal.close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function remove(item: AcademyClass) {
    if (!window.confirm(`Delete ${item.label}, its sessions, enrollments, and attendance?`)) return
    try {
      await deleteClass(item.id)
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  async function runGenerator() {
    if (!target) return
    setSaving(true)
    try {
      const created = await generateSessions(target.id, fromDate, toDate)
      notifications.show({ color: 'green', title: 'Sessions generated', message: `${created} new session${created === 1 ? '' : 's'} created.` })
      generateModal.close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Classes" description="Weekly schedules, coach assignments, and session planning" action={<Button leftSection={<IconPlus size={17} />} onClick={() => edit()}>Add class</Button>} />
      {data.classes.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
          {data.classes.map((item) => {
            const enrolled = data.enrollments.filter((entry) => entry.class_id === item.id).length
            const upcoming = data.sessions.filter((session) => session.class_id === item.id && session.session_date >= dayjs().format('YYYY-MM-DD')).length
            return (
              <Paper key={item.id} p="lg" radius="lg" withBorder className="class-card">
                <Group justify="space-between" align="flex-start">
                  <ThemeIcon size={46} variant="light" color="orange" radius="md"><IconBallBasketball size={24} /></ThemeIcon>
                  <Group gap={5}><ActionIcon variant="subtle" onClick={() => { setTarget(item); generateModal.open() }}><IconCalendarPlus size={18} /></ActionIcon><ActionIcon variant="subtle" color="gray" onClick={() => edit(item)}><IconEdit size={18} /></ActionIcon><ActionIcon variant="subtle" color="red" onClick={() => remove(item)}><IconTrash size={18} /></ActionIcon></Group>
                </Group>
                <Text fw={800} size="lg" mt="md">{item.label}</Text>
                <Group gap={7} mt={8}><Badge variant="light">{item.day_of_week}</Badge><Badge variant="outline" color="gray" leftSection={<IconClock size={12} />}>{formatTime(item.start_time)} – {formatTime(item.end_time)}</Badge></Group>
                <Stack gap={7} mt="lg">
                  <Group justify="space-between"><Text size="sm" c="dimmed">Assigned coach</Text><Text size="sm" fw={650}>{item.coach?.name || 'Unassigned'}</Text></Group>
                  <Group justify="space-between"><Text size="sm" c="dimmed">Enrolled students</Text><Group gap={4}><IconUsers size={15} /><Text size="sm" fw={650}><NumberFormatter value={enrolled} /></Text></Group></Group>
                  <Group justify="space-between"><Text size="sm" c="dimmed">Upcoming sessions</Text><Text size="sm" fw={650}>{upcoming}</Text></Group>
                </Stack>
              </Paper>
            )
          })}
        </SimpleGrid>
      ) : <EmptyState title="No classes yet" message="Create a weekly class, assign a coach, then generate dated sessions." icon={IconBallBasketball} />}

      <Modal opened={formOpened} onClose={formModal.close} title={form.id ? 'Edit class' : 'Add class'} centered>
        <Stack>
          <TextInput label="Class name" placeholder="Saturday Morning Elite" value={form.label} onChange={(event) => setForm({ ...form, label: event.currentTarget.value })} required />
          <Select label="Day of week" data={days} value={form.day_of_week} onChange={(value) => setForm({ ...form, day_of_week: value || 'Saturday' })} />
          <Grid><Grid.Col span={6}><TextInput label="Start time" type="time" value={form.start_time || ''} onChange={(event) => setForm({ ...form, start_time: event.currentTarget.value })} /></Grid.Col><Grid.Col span={6}><TextInput label="End time" type="time" value={form.end_time || ''} onChange={(event) => setForm({ ...form, end_time: event.currentTarget.value })} /></Grid.Col></Grid>
          <Select label="Head coach" clearable value={form.coach_id ? String(form.coach_id) : null} onChange={(value) => setForm({ ...form, coach_id: value ? Number(value) : null })} data={data.coaches.filter((coach) => coach.status === 'Active' && coach.coach_type === 'Head').map((coach) => ({ value: String(coach.id), label: coach.name }))} />
          <Group justify="flex-end"><Button variant="default" onClick={formModal.close}>Cancel</Button><Button onClick={submit} loading={saving}>Save class</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={generateOpened} onClose={generateModal.close} title={`Generate ${target?.label || ''} sessions`} centered>
        <Stack>
          <Text size="sm" c="dimmed">Creates one session every {target?.day_of_week} and skips dates that already exist.</Text>
          <Grid><Grid.Col span={6}><TextInput label="From" type="date" value={fromDate} onChange={(event) => setFromDate(event.currentTarget.value)} /></Grid.Col><Grid.Col span={6}><TextInput label="To" type="date" value={toDate} onChange={(event) => setToDate(event.currentTarget.value)} /></Grid.Col></Grid>
          <Button leftSection={<IconCalendarPlus size={17} />} onClick={runGenerator} loading={saving}>Generate sessions</Button>
        </Stack>
      </Modal>
    </>
  )
}

function formatTime(value: string | null) {
  return value ? dayjs(`2000-01-01T${value}`).format('h:mm A') : 'TBC'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
