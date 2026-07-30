import { useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Alert, Badge, Button, FileInput, Grid, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconCash, IconClock, IconEdit, IconPlus, IconReceiptRefund, IconTrash, IconUserStar } from '@tabler/icons-react'
import { deleteCoach, getCoachPayments, getCommission, recordCoachPayout, saveCoach, undoCoachPayout, uploadImage } from '../lib/api'
import { EmptyState, PageHeader, PersonAvatar } from '../components/ui'
import { publicImageUrl } from '../lib/supabase'
import type { BootstrapData, Coach, CoachPayment, CommissionSummary } from '../types/models'

const blankCoach: Partial<Coach> & { name: string } = { name: '', phone: '', coach_type: 'Head', hourly_rate: 0, status: 'Active', photo_path: null }

export function CoachesPage({ branchId, data, onChanged }: { branchId: number; data: BootstrapData; onChanged: () => Promise<unknown> }) {
  const [formOpened, formModal] = useDisclosure(false)
  const [payoutOpened, payoutModal] = useDisclosure(false)
  const [form, setForm] = useState(blankCoach)
  const [photo, setPhoto] = useState<File | null>(null)
  const [coach, setCoach] = useState<Coach | null>(null)
  const [commission, setCommission] = useState<CommissionSummary | null>(null)
  const [history, setHistory] = useState<CoachPayment[]>([])
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'))
  const [payoutAmount, setPayoutAmount] = useState<number | string>('')
  const [payoutRemarks, setPayoutRemarks] = useState('')
  const [loading, setLoading] = useState(false)

  function edit(item?: Coach) {
    setForm(item ? { ...item } : { ...blankCoach })
    setPhoto(null)
    formModal.open()
  }

  async function save() {
    if (!form.name.trim()) return
    setLoading(true)
    try {
      let saved = await saveCoach(branchId, form)
      if (photo) {
        const path = await uploadImage('coach-photos', branchId, photo, saved.id)
        saved = await saveCoach(branchId, { id: saved.id, name: saved.name, photo_path: path })
      }
      notifications.show({ color: 'green', message: 'Coach saved' })
      formModal.close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function remove(item: Coach) {
    if (!window.confirm(`Delete ${item.name}? Deactivate the coach instead if they have historical records.`)) return
    try {
      await deleteCoach(item.id)
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', title: 'Coach cannot be deleted', message: `${errorMessage(error)} Deactivate the coach to preserve linked records.` })
    }
  }

  async function openPayout(item: Coach, selectedMonth = month) {
    setCoach(item)
    setLoading(true)
    payoutModal.open()
    try {
      const [nextCommission, nextHistory] = await Promise.all([getCommission(item, branchId, selectedMonth), getCoachPayments(item.id)])
      setCommission(nextCommission)
      setHistory(nextHistory)
      const amount = item.coach_type === 'Head' ? nextCommission.commission || 0 : nextCommission.total || 0
      setPayoutAmount(amount)
      setPayoutRemarks(item.coach_type === 'Assistant' ? `${dayjs(`${selectedMonth}-01`).format('MMMM YYYY')} · ${nextCommission.hours || 0}h` : '')
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function changeMonth(value: string | null) {
    if (!value || !coach) return
    setMonth(value)
    await openPayout(coach, value)
  }

  async function submitPayout() {
    if (!coach || !commission || payoutAmount === '') return
    setLoading(true)
    try {
      await recordCoachPayout({
        coachId: coach.id,
        amount: Number(payoutAmount),
        units: coach.coach_type === 'Head' ? commission.units || 0 : commission.hours || 0,
        rate: coach.coach_type === 'Assistant' ? commission.hourlyRate || 0 : 0,
        studentsCount: commission.students || 0,
        datePaid: dayjs().format('YYYY-MM-DD'),
        remarks: payoutRemarks,
        payMonth: coach.coach_type === 'Assistant' ? month : null,
      })
      notifications.show({ color: 'green', message: 'Payout recorded and eligible commission units settled' })
      await openPayout(coach)
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setLoading(false)
    }
  }

  async function undo(payment: CoachPayment) {
    if (!window.confirm('Undo this payout and reopen its settled student-payment units?')) return
    try {
      await undoCoachPayout(payment.id)
      if (coach) await openPayout(coach)
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    }
  }

  return (
    <>
      <PageHeader title="Coaches" description="Coach profiles, attendance hours, commission, and payouts" action={<Button leftSection={<IconPlus size={17} />} onClick={() => edit()}>Add coach</Button>} />
      {data.coaches.length ? <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
        {data.coaches.map((item) => <Paper key={item.id} p="lg" radius="lg" withBorder>
          <Group align="flex-start" wrap="nowrap">
            <PersonAvatar name={item.name} src={publicImageUrl('coach-photos', item.photo_path)} size={58} />
            <Stack gap={5} flex={1}><Group justify="space-between"><Text fw={800}>{item.name}</Text><Group gap={2}><ActionIcon variant="subtle" color="gray" onClick={() => edit(item)}><IconEdit size={17} /></ActionIcon><ActionIcon variant="subtle" color="red" onClick={() => remove(item)}><IconTrash size={17} /></ActionIcon></Group></Group><Group gap={6}><Badge variant="light" color={item.coach_type === 'Head' ? 'orange' : 'blue'}>{item.coach_type}</Badge><Badge variant="outline" color={item.status === 'Active' ? 'green' : 'gray'}>{item.status}</Badge></Group><Text c="dimmed" size="sm">{item.phone || 'No phone'}{item.coach_type === 'Assistant' ? ` · RM ${money(item.hourly_rate)}/h` : ''}</Text></Stack>
          </Group>
          <Button mt="lg" fullWidth variant="light" leftSection={<IconCash size={17} />} onClick={() => openPayout(item)}>View payout</Button>
        </Paper>)}
      </SimpleGrid> : <EmptyState title="No coaches yet" message="Add head and assistant coaches, then assign them to classes." icon={IconUserStar} />}

      <Modal opened={formOpened} onClose={formModal.close} title={form.id ? `Edit ${form.name}` : 'Add coach'} centered>
        <Stack>
          <TextInput label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} required />
          <TextInput label="Phone" value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.currentTarget.value })} />
          <Grid><Grid.Col span={6}><Select label="Type" value={form.coach_type} onChange={(value) => setForm({ ...form, coach_type: value as Coach['coach_type'] })} data={[{ value: 'Head', label: 'Head coach' }, { value: 'Assistant', label: 'Assistant coach' }]} /></Grid.Col><Grid.Col span={6}><Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value as Coach['status'] })} data={['Active', 'Inactive']} /></Grid.Col></Grid>
          {form.coach_type === 'Assistant' && <NumberInput label="Hourly rate (RM)" value={form.hourly_rate || 0} onChange={(value) => setForm({ ...form, hourly_rate: Number(value) })} min={0} decimalScale={2} />}
          <FileInput label="Coach photo" accept="image/png,image/jpeg,image/webp" value={photo} onChange={setPhoto} />
          <Group justify="flex-end"><Button variant="default" onClick={formModal.close}>Cancel</Button><Button onClick={save} loading={loading}>Save coach</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={payoutOpened} onClose={payoutModal.close} title={`${coach?.name || ''} payout`} size="xl" centered>
        <Stack>
          {coach?.coach_type === 'Assistant' && <Select label="Pay month" value={month} onChange={changeMonth} data={Array.from({ length: 18 }, (_, index) => dayjs().subtract(index, 'month')).map((date) => ({ value: date.format('YYYY-MM'), label: date.format('MMMM YYYY') }))} w={220} />}
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Summary label={coach?.coach_type === 'Head' ? 'Unsettled units' : 'Hours worked'} value={String(coach?.coach_type === 'Head' ? commission?.units || 0 : commission?.hours || 0)} icon={coach?.coach_type === 'Head' ? <IconReceiptRefund size={20} /> : <IconClock size={20} />} />
            <Summary label={coach?.coach_type === 'Head' ? 'Distinct students' : 'Hourly rate'} value={coach?.coach_type === 'Head' ? String(commission?.students || 0) : `RM ${money(commission?.hourlyRate || 0)}`} icon={<IconUserStar size={20} />} />
            <Summary label="Calculated payout" value={`RM ${money(coach?.coach_type === 'Head' ? commission?.commission || 0 : commission?.total || 0)}`} icon={<IconCash size={20} />} />
          </SimpleGrid>
          {(commission?.unmatched || 0) > 0 && <Alert color="orange" icon={<IconAlertTriangle size={18} />}>{commission?.unmatched} unit(s) have no student monthly fee or matching rate and currently pay RM0.</Alert>}
          <Paper p="md" radius="lg" withBorder>
            <Grid align="end"><Grid.Col span={{ base: 12, sm: 4 }}><NumberInput label="Amount paid (RM)" value={payoutAmount} onChange={setPayoutAmount} min={0} decimalScale={2} /></Grid.Col><Grid.Col span={{ base: 12, sm: 5 }}><Textarea label="Remarks" value={payoutRemarks} onChange={(event) => setPayoutRemarks(event.currentTarget.value)} autosize minRows={1} /></Grid.Col><Grid.Col span={{ base: 12, sm: 3 }}><Button fullWidth onClick={submitPayout} loading={loading} disabled={Number(payoutAmount) === 0}>Record payout</Button></Grid.Col></Grid>
          </Paper>
          <Text fw={800}>Payout history</Text>
          <Table><Table.Thead><Table.Tr><Table.Th>Date</Table.Th><Table.Th>Type</Table.Th><Table.Th>Amount</Table.Th><Table.Th>Remarks</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{history.map((payment) => <Table.Tr key={payment.id}><Table.Td>{dayjs(payment.date_paid).format('D MMM YYYY')}</Table.Td><Table.Td>{payment.payout_type}</Table.Td><Table.Td>RM {money(payment.amount)}</Table.Td><Table.Td>{payment.remarks || '—'}</Table.Td><Table.Td><Button size="xs" variant="subtle" color="red" onClick={() => undo(payment)}>Undo</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table>
        </Stack>
      </Modal>
    </>
  )
}

function Summary({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <Paper p="lg" radius="lg" withBorder><Group><ThemeIcon variant="light" color="orange" size={40} radius="md">{icon}</ThemeIcon><div><Text size="xs" c="dimmed" fw={700}>{label}</Text><Text fw={850} size="xl">{value}</Text></div></Group></Paper>
}

function money(value: number) {
  return Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
