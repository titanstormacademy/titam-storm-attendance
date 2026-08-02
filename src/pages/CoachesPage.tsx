import { useRef, useState } from 'react'
import dayjs from 'dayjs'
import { ActionIcon, Alert, Badge, Box, Button, Checkbox, FileButton, Grid, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea, ThemeIcon } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconCamera, IconCash, IconClock, IconEdit, IconMessageCircle, IconPlus, IconReceiptRefund, IconTrash, IconUserStar } from '@tabler/icons-react'
import { deleteCoach, getCoachPayments, getCommission, recordCoachPayout, removeUploadedImage, saveCoach, undoCoachPayout, uploadImage } from '../lib/api'
import { EmptyState, PageHeader, PersonAvatar, PhotoLightbox } from '../components/ui'
import { publicImageUrl } from '../lib/supabase'
import { useNavigationGuard } from '../contexts/useNavigationGuard'
import type { BootstrapData, Coach, CoachPayment, CommissionSummary } from '../types/models'

const blankCoach: Partial<Coach> & { name: string } = { name: '', phone: '', coach_type: 'Head', hourly_rate: 0, status: 'Active', photo_path: null }

export function CoachesPage({ branchId, data, onChanged }: { branchId: number; data: BootstrapData; onChanged: () => Promise<unknown> }) {
  const [formOpened, formModal] = useDisclosure(false)
  const [payoutOpened, payoutModal] = useDisclosure(false)
  const [form, setForm] = useState(blankCoach)
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoView, setPhotoView] = useState<{ src: string | null; name: string } | null>(null)
  const [coach, setCoach] = useState<Coach | null>(null)
  const [commission, setCommission] = useState<CommissionSummary | null>(null)
  const [history, setHistory] = useState<CoachPayment[]>([])
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'))
  const [payoutAmount, setPayoutAmount] = useState<number | string>('')
  const [payoutDate, setPayoutDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [payoutRemarks, setPayoutRemarks] = useState('')
  const [zeroAmountReviewed, setZeroAmountReviewed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formBaseline, setFormBaseline] = useState('')
  const [payoutBaseline, setPayoutBaseline] = useState('')
  const payoutRequest = useRef(0)
  const submitLock = useRef(false)
  const payoutLock = useRef(false)
  const formDirty = formOpened && (Boolean(photo) || JSON.stringify(form) !== formBaseline)
  const payoutDirty = payoutOpened && commission != null && JSON.stringify([payoutAmount, payoutDate, payoutRemarks, month]) !== payoutBaseline
  const { confirmDiscard } = useNavigationGuard('coach-editors', { dirty: formDirty || payoutDirty, pending: loading })

  function edit(item?: Coach) {
    const next = item ? { ...item } : { ...blankCoach }
    setForm(next)
    setFormBaseline(JSON.stringify(next))
    setPhoto(null)
    formModal.open()
  }

  async function save() {
    if (!form.name.trim() || submitLock.current) return
    submitLock.current = true
    setLoading(true)
    try {
      let saved = await saveCoach(branchId, form)
      setForm((current) => ({ ...current, id: saved.id }))
      let photoError: unknown = null
      if (photo) {
        const oldPhotoPath = saved.photo_path
        let path: string | null = null
        try {
          path = await uploadImage('coach-photos', branchId, photo, saved.id)
          saved = await saveCoach(branchId, { id: saved.id, name: saved.name, photo_path: path })
          if (oldPhotoPath && oldPhotoPath !== path) await removeUploadedImage('coach-photos', oldPhotoPath).catch(() => undefined)
        } catch (error) {
          if (path) await removeUploadedImage('coach-photos', path).catch(() => undefined)
          photoError = error
        }
      }
      notifications.show(photoError ? { color: 'orange', title: 'Coach saved without photo', message: errorMessage(photoError) } : { color: 'green', message: 'Coach saved' })
      setPhoto(null)
      setFormBaseline(JSON.stringify(saved))
      formModal.close()
      try { await onChanged() } catch (error) { notifications.show({ color: 'orange', title: 'Coach saved, refresh failed', message: errorMessage(error) }) }
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      submitLock.current = false
      setLoading(false)
    }
  }

  function closeForm() {
    if (confirmDiscard({ dirty: formDirty, pending: loading })) formModal.close()
  }

  function closePayout() {
    if (!confirmDiscard({ dirty: payoutDirty, pending: loading })) return
    payoutRequest.current += 1
    payoutModal.close()
  }

  async function remove(item: Coach) {
    if (!window.confirm(`Delete ${item.name}? Deactivate the coach instead if they have historical records.`)) return
    try {
      await deleteCoach(branchId, item.id)
      if (item.photo_path) await removeUploadedImage('coach-photos', item.photo_path).catch(() => undefined)
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', title: 'Coach cannot be deleted', message: `${errorMessage(error)} Deactivate the coach to preserve linked records.` })
    }
  }

  async function openPayout(item: Coach, selectedMonth = month) {
    const requestId = ++payoutRequest.current
    setCoach(item)
    setMonth(selectedMonth)
    setPayoutDate(dayjs().format('YYYY-MM-DD'))
    setZeroAmountReviewed(false)
    setCommission(null)
    setHistory([])
    setLoading(true)
    payoutModal.open()
    try {
      const [nextCommission, nextHistory] = await Promise.all([getCommission(item, branchId, selectedMonth), getCoachPayments(branchId, item.id)])
      if (requestId !== payoutRequest.current) return
      setCommission(nextCommission)
      setHistory(nextHistory)
      const amount = item.coach_type === 'Head' ? nextCommission.commission || 0 : nextCommission.total || 0
      const date = dayjs().format('YYYY-MM-DD')
      const remarks = item.coach_type === 'Assistant' ? `${dayjs(`${selectedMonth}-01`).format('MMMM YYYY')} · ${nextCommission.hours || 0}h` : ''
      setPayoutAmount(amount)
      setPayoutDate(date)
      setPayoutRemarks(remarks)
      setPayoutBaseline(JSON.stringify([amount, date, remarks, selectedMonth]))
    } catch (error) {
      if (requestId === payoutRequest.current) notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      if (requestId === payoutRequest.current) setLoading(false)
    }
  }

  async function changeMonth(value: string | null) {
    if (!value || !coach) return
    setMonth(value)
    await openPayout(coach, value)
  }

  async function submitPayout() {
    if (!coach || !commission || payoutAmount === '' || !payoutDate || payoutLock.current) return
    const selectedCoach = coach
    const selectedMonth = month
    const eligibleUnits = coach.coach_type === 'Head' ? commission.units || 0 : commission.hours || 0
    if (Number(payoutAmount) === 0 && (!eligibleUnits || !zeroAmountReviewed)) return
    payoutLock.current = true
    setLoading(true)
    try {
      await recordCoachPayout({
        coachId: coach.id,
        amount: Number(payoutAmount),
        units: coach.coach_type === 'Head' ? commission.units || 0 : commission.hours || 0,
        rate: coach.coach_type === 'Assistant' ? commission.hourlyRate || 0 : 0,
        studentsCount: commission.students || 0,
        datePaid: payoutDate,
        remarks: payoutRemarks,
        payMonth: coach.coach_type === 'Assistant' ? month : null,
      })
      notifications.show({ color: 'green', message: 'Payout recorded and eligible commission units settled' })
      await openPayout(selectedCoach, selectedMonth)
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      payoutLock.current = false
      setLoading(false)
    }
  }

  async function undo(payment: CoachPayment) {
    if (payoutLock.current || !window.confirm('Undo this payout and reopen its settled units?')) return
    payoutLock.current = true
    setLoading(true)
    try {
      await undoCoachPayout(payment.id)
      if (coach) await openPayout(coach, month)
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      payoutLock.current = false
      setLoading(false)
    }
  }

  const eligibleUnits = coach?.coach_type === 'Head' ? commission?.units || 0 : commission?.hours || 0
  const zeroAmountNeedsReview = payoutAmount !== '' && Number(payoutAmount) === 0 && eligibleUnits > 0

  return (
    <>
      <PageHeader title="Coaches" description="Coach profiles, attendance hours, commission, and payouts" action={<Button leftSection={<IconPlus size={17} />} onClick={() => edit()}>Add coach</Button>} />
      {data.coaches.length ? <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
        {data.coaches.map((item) => <Paper key={item.id} p="lg" radius="lg" withBorder>
          <Group align="flex-start" wrap="nowrap">
            <PersonAvatar name={item.name} src={publicImageUrl('coach-photos', item.photo_path)} size={58} onClick={() => setPhotoView({ src: publicImageUrl('coach-photos', item.photo_path), name: item.name })} />
            <Stack gap={5} flex={1} style={{ minWidth: 0 }}><Group justify="space-between" wrap="nowrap"><Text fw={800} truncate>{item.name}</Text><Group gap={2} wrap="nowrap"><ActionIcon aria-label={`Edit ${item.name}`} size={44} variant="subtle" color="gray" onClick={() => edit(item)}><IconEdit size={17} /></ActionIcon><ActionIcon aria-label={`Delete ${item.name}`} size={44} variant="subtle" color="red" onClick={() => remove(item)}><IconTrash size={17} /></ActionIcon></Group></Group><Group gap={6}><Badge variant="light" color={item.coach_type === 'Head' ? 'orange' : 'blue'}>{item.coach_type}</Badge><Badge variant="outline" color={item.status === 'Active' ? 'green' : 'gray'}>{item.status}</Badge></Group><Group gap="xs"><Text c="dimmed" size="sm">{item.phone || 'No phone'}{item.coach_type === 'Assistant' ? ` · RM ${money(item.hourly_rate)}/h` : ''}</Text>{item.phone && <ActionIcon component="a" href={waUrl(item.phone)} target="_blank" aria-label={`WhatsApp ${item.name}`} variant="light" color="green" size={36}><IconMessageCircle size={17} /></ActionIcon>}</Group></Stack>
          </Group>
          <Button mt="lg" fullWidth variant="light" leftSection={<IconCash size={17} />} onClick={() => openPayout(item)}>View payout</Button>
        </Paper>)}
      </SimpleGrid> : <EmptyState title="No coaches yet" message="Add head and assistant coaches, then assign them to classes." icon={IconUserStar} />}

      <Modal opened={formOpened} onClose={closeForm} title={form.id ? `Edit ${form.name}` : 'Add coach'} centered>
        <Stack>
          <Group justify="center"><Box className="profile-photo-editor"><PersonAvatar name={form.name || 'New coach'} src={publicImageUrl('coach-photos', form.photo_path || null)} size={92} onClick={() => setPhotoView({ src: publicImageUrl('coach-photos', form.photo_path || null), name: form.name || 'Coach photo' })} /><FileButton onChange={setPhoto} accept="image/png,image/jpeg,image/webp">{(props) => <ActionIcon {...props} className="profile-camera-button" aria-label="Choose coach photo" color="orange" size={32} radius="xl"><IconCamera size={16} /></ActionIcon>}</FileButton></Box></Group>
          {photo && <Text size="xs" c="orange" ta="center">New photo selected · save to upload</Text>}
          <TextInput label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.currentTarget.value })} required />
          <TextInput label="Phone" value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.currentTarget.value })} />
          <Grid><Grid.Col span={{ base: 12, xs: 6 }}><Select label="Type" value={form.coach_type} onChange={(value) => setForm({ ...form, coach_type: value as Coach['coach_type'] })} data={[{ value: 'Head', label: 'Head coach' }, { value: 'Assistant', label: 'Assistant coach' }]} /></Grid.Col><Grid.Col span={{ base: 12, xs: 6 }}><Select label="Status" value={form.status} onChange={(value) => setForm({ ...form, status: value as Coach['status'] })} data={['Active', 'Inactive']} /></Grid.Col></Grid>
          {form.coach_type === 'Assistant' && <NumberInput label="Hourly rate (RM)" value={form.hourly_rate || 0} onChange={(value) => setForm({ ...form, hourly_rate: Number(value) })} min={0} decimalScale={2} />}
          <Group justify="flex-end"><Button variant="default" disabled={loading} onClick={closeForm}>Cancel</Button><Button onClick={save} loading={loading}>Save coach</Button></Group>
        </Stack>
      </Modal>

      <Modal opened={payoutOpened} onClose={closePayout} title={`${coach?.name || ''} payout`} size="xl" centered>
        <Stack>
          {coach?.coach_type === 'Assistant' && <Select label="Pay month" value={month} onChange={changeMonth} disabled={loading} data={Array.from({ length: 18 }, (_, index) => dayjs().subtract(index, 'month')).map((date) => ({ value: date.format('YYYY-MM'), label: date.format('MMMM YYYY') }))} w={{ base: '100%', sm: 220 }} allowDeselect={false} />}
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Summary label={coach?.coach_type === 'Head' ? 'Unsettled units' : 'Hours worked'} value={String(coach?.coach_type === 'Head' ? commission?.units || 0 : commission?.hours || 0)} icon={coach?.coach_type === 'Head' ? <IconReceiptRefund size={20} /> : <IconClock size={20} />} />
            <Summary label={coach?.coach_type === 'Head' ? 'Distinct students' : 'Hourly rate'} value={coach?.coach_type === 'Head' ? String(commission?.students || 0) : `RM ${money(commission?.hourlyRate || 0)}`} icon={<IconUserStar size={20} />} />
            <Summary label="Calculated payout" value={`RM ${money(coach?.coach_type === 'Head' ? commission?.commission || 0 : commission?.total || 0)}`} icon={<IconCash size={20} />} />
          </SimpleGrid>
          {(commission?.unmatched || 0) > 0 && <Alert color="orange" icon={<IconAlertTriangle size={18} />}>{commission?.unmatched} unit(s) have no student monthly fee or matching rate and currently pay RM0.</Alert>}
          {coach?.coach_type === 'Head' ? <HeadCommissionItems items={commission?.items || []} /> : <AssistantSessions sessions={commission?.sessions || []} />}
          <Paper p="md" radius="lg" withBorder>
            <Grid align="end">
              <Grid.Col span={{ base: 12, sm: 3 }}><TextInput type="date" label="Payout date" value={payoutDate} onChange={(event) => setPayoutDate(event.currentTarget.value)} required /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 3 }}><NumberInput label="Amount paid (RM)" value={payoutAmount} onChange={(value) => { setPayoutAmount(value); setZeroAmountReviewed(false) }} min={0} decimalScale={2} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 4 }}><Textarea label="Remarks" value={payoutRemarks} onChange={(event) => setPayoutRemarks(event.currentTarget.value)} autosize minRows={1} /></Grid.Col>
              <Grid.Col span={{ base: 12, sm: 2 }}><Button fullWidth onClick={submitPayout} loading={loading} disabled={payoutAmount === '' || !payoutDate || (Number(payoutAmount) === 0 && (!eligibleUnits || !zeroAmountReviewed))}>Record payout</Button></Grid.Col>
            </Grid>
            {zeroAmountNeedsReview && <Checkbox mt="md" checked={zeroAmountReviewed} onChange={(event) => setZeroAmountReviewed(event.currentTarget.checked)} label={`I reviewed this RM0 payout and understand it will settle ${eligibleUnits} eligible ${coach?.coach_type === 'Head' ? 'unit(s)' : 'hour(s)'}.`} />}
            {payoutAmount !== '' && Number(payoutAmount) === 0 && !eligibleUnits && <Text size="xs" c="dimmed" mt="sm">There are no eligible units to settle with a zero-amount payout.</Text>}
          </Paper>
          <Text fw={800}>Payout history</Text>
          <Paper radius="lg" withBorder>
            <Box visibleFrom="sm"><Table.ScrollContainer minWidth={720}><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Date</Table.Th><Table.Th>Type / period</Table.Th><Table.Th>Units / hours</Table.Th><Table.Th>Amount</Table.Th><Table.Th>Remarks</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{history.map((payment) => <Table.Tr key={payment.id}><Table.Td>{dayjs(payment.date_paid).format('D MMM YYYY')}</Table.Td><Table.Td><Text size="sm">{payment.payout_type}</Text><Text size="xs" c="dimmed">{payment.pay_month ? dayjs(payment.pay_month).format('MMMM YYYY') : 'Unsettled commission'}</Text></Table.Td><Table.Td>{payment.units}</Table.Td><Table.Td>RM {money(payment.amount)}</Table.Td><Table.Td>{payment.remarks || '—'}</Table.Td><Table.Td><Button size="xs" variant="subtle" color="red" onClick={() => undo(payment)}>Undo</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></Box>
            <Stack hiddenFrom="sm" p="sm" gap="sm">{history.length ? history.map((payment) => <Paper key={payment.id} p="md" radius="md" withBorder><Group justify="space-between" align="flex-start"><div><Text fw={750}>{dayjs(payment.date_paid).format('D MMM YYYY')}</Text><Text size="xs" c="dimmed">{payment.payout_type}{payment.pay_month ? ` · ${dayjs(payment.pay_month).format('MMMM YYYY')}` : ''}</Text></div><Text fw={800}>RM {money(payment.amount)}</Text></Group><Group gap="xs" mt="sm"><Badge variant="light">{payment.units} {payment.payout_type === 'Assistant' ? 'hours' : 'units'}</Badge>{payment.remarks && <Text size="sm" c="dimmed">{payment.remarks}</Text>}</Group><Button mt="sm" size="xs" variant="light" color="red" onClick={() => undo(payment)}>Undo payout</Button></Paper>) : <Text c="dimmed" size="sm" p="sm">No payout history.</Text>}</Stack>
          </Paper>
        </Stack>
      </Modal>
      <PhotoLightbox src={photoView?.src || null} name={photoView?.name || 'Coach photo'} opened={Boolean(photoView)} onClose={() => setPhotoView(null)} />
    </>
  )
}

function Summary({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <Paper p="lg" radius="lg" withBorder><Group><ThemeIcon variant="light" color="orange" size={40} radius="md">{icon}</ThemeIcon><div><Text size="xs" c="dimmed" fw={700}>{label}</Text><Text fw={850} size="xl">{value}</Text></div></Group></Paper>
}

function HeadCommissionItems({ items }: { items: NonNullable<CommissionSummary['items']> }) {
  const groups = new Map<string, typeof items>()
  items.forEach((item) => {
    const receivedMonth = item.receivedMonth || item.dateReceived?.slice(0, 7) || 'unrecorded'
    groups.set(receivedMonth, [...(groups.get(receivedMonth) || []), item])
  })
  const groupedItems = [...groups].sort(([a], [b]) => b.localeCompare(a))
  return <Stack gap="sm">
    <div><Text fw={800}>Eligible commission items</Text><Text size="sm" c="dimmed">Grouped by the month each student payment was received.</Text></div>
    {groupedItems.length ? groupedItems.map(([receivedMonth, monthItems]) => <Paper key={receivedMonth} radius="lg" withBorder>
      <Group justify="space-between" p="md"><Text fw={750}>{receivedMonth === 'unrecorded' ? 'Received date not recorded' : dayjs(`${receivedMonth}-01`).format('MMMM YYYY')}</Text><Group gap="xs"><Badge variant="light">{monthItems.length} unit{monthItems.length === 1 ? '' : 's'}</Badge><Badge color="green" variant="light">RM {money(monthItems.reduce((sum, item) => sum + Number(item.payout || 0), 0))}</Badge></Group></Group>
      <Table.ScrollContainer minWidth={650}><Table verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>Student</Table.Th><Table.Th>Fee month</Table.Th><Table.Th>Received</Table.Th><Table.Th>Monthly fee</Table.Th><Table.Th>Payout</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{monthItems.map((item) => {
        const unmatched = item.fee == null || Number(item.payout) === 0
        return <Table.Tr key={item.paymentId}><Table.Td><Text fw={650} size="sm">{item.studentName}</Text>{unmatched && <Badge mt={4} size="xs" color="orange" variant="light">Unmatched</Badge>}</Table.Td><Table.Td>{dayjs(item.feeMonth).format('MMM YYYY')}</Table.Td><Table.Td>{item.dateReceived ? dayjs(item.dateReceived).format('D MMM YYYY') : '—'}</Table.Td><Table.Td>{item.fee == null ? <Badge color="orange" variant="outline">No fee</Badge> : `RM ${money(item.fee)}`}</Table.Td><Table.Td><Badge color={unmatched ? 'orange' : 'green'} variant="light">RM {money(item.payout)}</Badge></Table.Td></Table.Tr>
      })}</Table.Tbody></Table></Table.ScrollContainer>
    </Paper>) : <Paper p="md" radius="lg" withBorder><Text size="sm" c="dimmed">No unsettled head coach commission items.</Text></Paper>}
  </Stack>
}

function AssistantSessions({ sessions }: { sessions: NonNullable<CommissionSummary['sessions']> }) {
  return <Paper radius="lg" withBorder>
    <Group justify="space-between" p="md"><div><Text fw={800}>Session and hour detail</Text><Text size="sm" c="dimmed">Coach attendance included in this pay month.</Text></div><Badge variant="light">{sessions.length} session{sessions.length === 1 ? '' : 's'}</Badge></Group>
    {sessions.length ? <Table.ScrollContainer minWidth={480}><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Date</Table.Th><Table.Th>Class</Table.Th><Table.Th>Hours</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[...sessions].sort((a, b) => a.date.localeCompare(b.date)).map((session, index) => <Table.Tr key={`${session.date}-${session.className}-${index}`}><Table.Td>{dayjs(session.date).format('D MMM YYYY')}</Table.Td><Table.Td>{session.className}</Table.Td><Table.Td><Badge color="blue" variant="light">{session.hours}h</Badge></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text p="md" size="sm" c="dimmed">No assistant coach attendance recorded for this month.</Text>}
  </Paper>
}

function money(value: number) {
  return Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function waUrl(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '60')}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
