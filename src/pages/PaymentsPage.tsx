import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Alert, Badge, Button, FileInput, Grid, Group, Modal, MultiSelect, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconAlertCircle, IconCash, IconCheck, IconPlus, IconReceipt, IconRobot } from '@tabler/icons-react'
import { recordStudentPayment, scanReceipt, uploadImage } from '../lib/api'
import { PageHeader, StatCard } from '../components/ui'
import type { BootstrapData, PaymentMethod, PaymentStatus } from '../types/models'

const methods: PaymentMethod[] = ['Cash', 'Bank Transfer', "Touch 'n Go eWallet", 'Online', 'Others']
const statuses: PaymentStatus[] = ['Paid', 'Partial', 'Unpaid']

export function PaymentsPage({ branchId, data, onChanged }: { branchId: number; data: BootstrapData; onChanged: () => Promise<unknown> }) {
  const [opened, modal] = useDisclosure(false)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [feeMonths, setFeeMonths] = useState<string[]>([dayjs().format('YYYY-MM')])
  const [amount, setAmount] = useState<number | string>('')
  const [method, setMethod] = useState<PaymentMethod | null>('Bank Transfer')
  const [status, setStatus] = useState<PaymentStatus | null>('Paid')
  const [dateReceived, setDateReceived] = useState(dayjs().format('YYYY-MM-DD'))
  const [referenceNo, setReferenceNo] = useState('')
  const [coachId, setCoachId] = useState<string | null>(null)
  const [remarks, setRemarks] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [ocrMessage, setOcrMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [period, setPeriod] = useState(dayjs().format('YYYY-MM'))

  const periodPayments = data.payments.filter((payment) => payment.fee_month.startsWith(period))
  const collected = periodPayments.filter((payment) => payment.status !== 'Unpaid').reduce((sum, payment) => sum + Number(payment.amount), 0)
  const paidIds = new Set(periodPayments.filter((payment) => payment.status === 'Paid').map((payment) => payment.student_id))
  const enrolledIds = new Set(data.enrollments.map((item) => item.student_id))
  const activeEnrolled = data.students.filter((student) => student.status === 'Active' && enrolledIds.has(student.id))
  const outstanding = activeEnrolled.filter((student) => !paidIds.has(student.id))
  const outstandingAmount = outstanding.reduce((sum, student) => sum + Number(student.monthly_fee || 0), 0)
  const months = useMemo(() => Array.from({ length: 18 }, (_, index) => dayjs().subtract(12, 'month').add(index, 'month')).map((date) => ({ value: date.format('YYYY-MM'), label: date.format('MMMM YYYY') })).reverse(), [])

  function openForStudent(id?: number) {
    const value = id ? String(id) : null
    setStudentId(value)
    setFeeMonths([dayjs().format('YYYY-MM')])
    const student = data.students.find((item) => item.id === id)
    setAmount(student?.monthly_fee || '')
    const enrollment = data.enrollments.find((item) => item.student_id === id)
    const academyClass = data.classes.find((item) => item.id === enrollment?.class_id)
    setCoachId(academyClass?.coach_id ? String(academyClass.coach_id) : null)
    setMethod('Bank Transfer'); setStatus('Paid'); setDateReceived(dayjs().format('YYYY-MM-DD')); setReferenceNo(''); setRemarks(''); setReceipt(null); setOcrMessage('')
    modal.open()
  }

  async function runOcr() {
    if (!receipt) return
    setSaving(true)
    try {
      const result = await scanReceipt(receipt)
      if (result.amount != null && amount === '') setAmount(result.amount)
      if (result.date) setDateReceived(result.date)
      if (result.method) setMethod(result.method)
      if (result.reference) setReferenceNo(result.reference)
      setOcrMessage(result.confidence != null ? `Receipt read with ${Math.round(result.confidence * 100)}% confidence. Please verify every field.` : 'Receipt read. Please verify every field.')
    } catch (error) {
      setOcrMessage(`OCR unavailable: ${errorMessage(error)}. You can still enter the payment manually.`)
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!studentId || !feeMonths.length || amount === '' || !method || !status) return
    setSaving(true)
    try {
      const receiptPath = receipt ? await uploadImage('payment-receipts', branchId, receipt, Number(studentId)) : null
      await recordStudentPayment({
        studentId: Number(studentId), feeMonths, amount: Number(amount), method, status, dateReceived,
        remarks, referenceNo, coachId: coachId ? Number(coachId) : null, receiptPath,
      })
      notifications.show({ color: 'green', title: 'Payment recorded', message: `${feeMonths.length} fee month${feeMonths.length > 1 ? 's' : ''} updated.` })
      modal.close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', title: 'Could not record payment', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader title="Payments" description="Student fees, receipts, and collection status" action={<Group><Select value={period} onChange={(value) => setPeriod(value || dayjs().format('YYYY-MM'))} data={months} w={180} /><Button leftSection={<IconPlus size={17} />} onClick={() => openForStudent()}>Record payment</Button></Group>} />
      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="xl">
        <StatCard label="Collected" value={`RM ${money(collected)}`} detail={dayjs(`${period}-01`).format('MMMM YYYY')} icon={IconCash} color="green" />
        <StatCard label="Fully paid" value={paidIds.size} detail={`${activeEnrolled.length} active enrolled students`} icon={IconCheck} color="blue" />
        <StatCard label="Estimated outstanding" value={`RM ${money(outstandingAmount)}`} detail={`${outstanding.length} student${outstanding.length === 1 ? '' : 's'} without a Paid record`} icon={IconAlertCircle} color="red" />
      </SimpleGrid>

      <Paper radius="lg" withBorder>
        <Group justify="space-between" p="lg"><div><Text fw={800} size="lg">Student collection status</Text><Text c="dimmed" size="sm">A Paid record clears the selected fee month.</Text></div><Badge variant="light" size="lg">{dayjs(`${period}-01`).format('MMMM YYYY')}</Badge></Group>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm" horizontalSpacing="lg" highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>Student</Table.Th><Table.Th>Monthly fee</Table.Th><Table.Th>Status</Table.Th><Table.Th>Received</Table.Th><Table.Th>Method / reference</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {activeEnrolled.map((student) => {
                const rows = periodPayments.filter((payment) => payment.student_id === student.id)
                const best = rows.find((payment) => payment.status === 'Paid') || rows.find((payment) => payment.status === 'Partial') || rows[0]
                const total = rows.filter((payment) => payment.status !== 'Unpaid').reduce((sum, payment) => sum + Number(payment.amount), 0)
                return <Table.Tr key={student.id}><Table.Td><Text fw={700}>{student.name}</Text><Text size="xs" c="dimmed">{student.parent_contact || student.student_phone || 'No contact'}</Text></Table.Td><Table.Td>RM {money(student.monthly_fee || 0)}</Table.Td><Table.Td><Badge color={best?.status === 'Paid' ? 'green' : best?.status === 'Partial' ? 'orange' : 'red'} variant="light">{best?.status || 'Outstanding'}</Badge></Table.Td><Table.Td><Text fw={650}>RM {money(total)}</Text><Text size="xs" c="dimmed">{best?.date_received ? dayjs(best.date_received).format('D MMM YYYY') : '—'}</Text></Table.Td><Table.Td><Text size="sm">{best?.method || '—'}</Text><Text size="xs" c="dimmed">{best?.reference_no || 'No reference'}</Text></Table.Td><Table.Td><Button variant="subtle" size="xs" onClick={() => openForStudent(student.id)}>Add</Button></Table.Td></Table.Tr>
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Modal opened={opened} onClose={modal.close} title="Record student payment" size="lg" centered>
        <Stack>
          <Select label="Student" searchable required value={studentId} onChange={(value) => { setStudentId(value); const student = data.students.find((item) => String(item.id) === value); setAmount(student?.monthly_fee || '') }} data={activeEnrolled.map((student) => ({ value: String(student.id), label: student.name }))} />
          <MultiSelect label="Fee month(s)" required value={feeMonths} onChange={setFeeMonths} data={months} searchable />
          <Grid><Grid.Col span={6}><NumberInput label="Amount received (RM)" value={amount} onChange={setAmount} min={0} decimalScale={2} required /></Grid.Col><Grid.Col span={6}><TextInput label="Date received" type="date" value={dateReceived} onChange={(event) => setDateReceived(event.currentTarget.value)} /></Grid.Col></Grid>
          <Grid><Grid.Col span={6}><Select label="Method" value={method} onChange={(value) => setMethod(value as PaymentMethod)} data={methods} required /></Grid.Col><Grid.Col span={6}><Select label="Status" value={status} onChange={(value) => setStatus(value as PaymentStatus)} data={statuses} required /></Grid.Col></Grid>
          <Grid><Grid.Col span={6}><TextInput label="Reference number" value={referenceNo} onChange={(event) => setReferenceNo(event.currentTarget.value)} /></Grid.Col><Grid.Col span={6}><Select label="Coach for commission" clearable value={coachId} onChange={setCoachId} data={data.coaches.filter((coach) => coach.coach_type === 'Head').map((coach) => ({ value: String(coach.id), label: coach.name }))} /></Grid.Col></Grid>
          <Textarea label="Remarks" description="Include registration fees or special adjustments here." value={remarks} onChange={(event) => setRemarks(event.currentTarget.value)} />
          <FileInput label="Receipt" accept="image/png,image/jpeg,image/webp" value={receipt} onChange={(file) => { setReceipt(file); setOcrMessage('') }} leftSection={<IconReceipt size={16} />} clearable />
          {receipt && <Button variant="light" leftSection={<IconRobot size={17} />} onClick={runOcr} loading={saving}>Read receipt with Gemini</Button>}
          {ocrMessage && <Alert icon={<IconRobot size={17} />} color={ocrMessage.startsWith('OCR unavailable') ? 'orange' : 'blue'}>{ocrMessage}</Alert>}
          {feeMonths.length > 1 && <Alert color="blue" variant="light">The full amount and reference are stored on the latest selected month. Earlier months receive RM0 records marked “Paid in latest month”, preserving the current commission-unit behavior.</Alert>}
          <Group justify="flex-end"><Button variant="default" onClick={modal.close}>Cancel</Button><Button onClick={submit} loading={saving} disabled={!studentId || !feeMonths.length || amount === ''}>Save payment</Button></Group>
        </Stack>
      </Modal>
    </>
  )
}

function money(value: number) {
  return Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
