import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Alert, Badge, Box, Button, FileInput, Grid, Group, Modal, MultiSelect, NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Textarea } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconAlertCircle, IconCash, IconCheck, IconEdit, IconEye, IconHistory, IconPlus, IconReceipt, IconRobot, IconTrash } from '@tabler/icons-react'
import { recordStudentPayment, scanReceipt, uploadImage } from '../lib/api'
import { deletePayment, findDuplicateReference, openReceipt, updatePayment } from '../lib/paymentOperations'
import { PageHeader, PersonAvatar, StatCard } from '../components/ui'
import { publicImageUrl } from '../lib/supabase'
import type { BootstrapData, Payment, PaymentMethod, PaymentStatus, Student } from '../types/models'

const methods: PaymentMethod[] = ['Cash', 'Bank Transfer', "Touch 'n Go eWallet", 'Online', 'Others']
const statuses: PaymentStatus[] = ['Paid', 'Partial', 'Unpaid']

export function PaymentsPage({ branchId, data, onChanged }: { branchId: number; data: BootstrapData; onChanged: () => Promise<unknown> }) {
  const [formOpened, formModal] = useDisclosure(false)
  const [historyOpened, historyModal] = useDisclosure(false)
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [paymentId, setPaymentId] = useState<number | null>(null)
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
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [ocrMessage, setOcrMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [periodMode, setPeriodMode] = useState<'month' | 'year'>('month')
  const [period, setPeriod] = useState(dayjs().format('YYYY-MM'))
  const [year, setYear] = useState(dayjs().format('YYYY'))

  const periodPayments = data.payments.filter((payment) => periodMode === 'month' ? payment.fee_month.startsWith(period) : payment.fee_month.startsWith(year))
  const collected = periodPayments.filter((payment) => payment.status !== 'Unpaid').reduce((sum, payment) => sum + Number(payment.amount), 0)
  const paidIds = new Set(periodPayments.filter((payment) => payment.status === 'Paid').map((payment) => payment.student_id))
  const enrolledIds = new Set(data.enrollments.map((item) => item.student_id))
  const activeEnrolled = data.students.filter((student) => student.status === 'Active' && enrolledIds.has(student.id))
  const arrears = useMemo(() => calculateArrears(data), [data])
  const outstandingStudents = activeEnrolled.filter((student) => (arrears.get(student.id)?.months.length || 0) > 0)
  const outstandingAmount = outstandingStudents.reduce((sum, student) => sum + (arrears.get(student.id)?.amount || 0), 0)
  const months = useMemo(() => Array.from({ length: 24 }, (_, index) => dayjs().subtract(15, 'month').add(index, 'month')).map((date) => ({ value: date.format('YYYY-MM'), label: date.format('MMMM YYYY') })).reverse(), [])
  const years = Array.from({ length: 6 }, (_, index) => String(dayjs().year() - index))
  const history = selectedStudent ? data.payments.filter((payment) => payment.student_id === selectedStudent.id).sort((a, b) => b.fee_month.localeCompare(a.fee_month) || b.id - a.id) : []

  function defaultCoach(nextStudentId: number) {
    const enrollment = data.enrollments.find((item) => item.student_id === nextStudentId)
    return data.classes.find((item) => item.id === enrollment?.class_id)?.coach_id || null
  }

  function resetForm(nextStudent?: Student) {
    setPaymentId(null)
    setStudentId(nextStudent ? String(nextStudent.id) : null)
    setFeeMonths([dayjs().format('YYYY-MM')])
    setAmount(nextStudent?.monthly_fee || '')
    setCoachId(nextStudent ? String(defaultCoach(nextStudent.id) || '') || null : null)
    setMethod('Bank Transfer'); setStatus('Paid'); setDateReceived(dayjs().format('YYYY-MM-DD')); setReferenceNo(''); setRemarks(''); setReceipt(null); setReceiptPath(null); setOcrMessage('')
  }

  function openNew(student?: Student) {
    resetForm(student)
    formModal.open()
  }

  function editPayment(payment: Payment) {
    setPaymentId(payment.id); setStudentId(String(payment.student_id)); setFeeMonths([payment.fee_month.slice(0, 7)]); setAmount(Number(payment.amount)); setMethod(payment.method || 'Others'); setStatus(payment.status); setDateReceived(payment.date_received || dayjs().format('YYYY-MM-DD')); setReferenceNo(payment.reference_no || ''); setCoachId(payment.coach_id ? String(payment.coach_id) : null); setRemarks(payment.remarks || ''); setReceipt(null); setReceiptPath(payment.receipt_path); setOcrMessage('')
    formModal.open()
  }

  function showHistory(student: Student) {
    setSelectedStudent(student)
    historyModal.open()
  }

  async function handleReceipt(file: File | null) {
    setReceipt(file); setOcrMessage('')
    if (!file) return
    setSaving(true)
    try {
      const result = await scanReceipt(file)
      if (result.amount != null) setAmount(result.amount)
      if (result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) setDateReceived(result.date)
      if (result.method) setMethod(result.method)
      if (result.reference) setReferenceNo(result.reference)
      setOcrMessage(result.confidence != null ? `Receipt read with ${Math.round(result.confidence * 100)}% confidence. Verify every field before saving.` : 'Receipt read. Verify every field before saving.')
    } catch (error) {
      setOcrMessage(`OCR unavailable: ${errorMessage(error)}. Enter the details manually.`)
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    if (!studentId || !feeMonths.length || amount === '' || !method || !status || !dateReceived) return
    setSaving(true)
    try {
      const duplicate = await findDuplicateReference(branchId, referenceNo, paymentId || undefined)
      if (duplicate && !window.confirm(`Reference already exists for ${duplicate.student?.name || 'another student'} (${dayjs(duplicate.fee_month).format('MMM YYYY')}). Save anyway?`)) return
      const nextReceiptPath = receipt ? await uploadImage('payment-receipts', branchId, receipt, Number(studentId)) : receiptPath
      if (paymentId) {
        await updatePayment(paymentId, { student_id: Number(studentId), fee_month: feeMonths[0], amount: Number(amount), method, status, date_received: dateReceived, remarks, reference_no: referenceNo, coach_id: coachId ? Number(coachId) : null, receipt_path: nextReceiptPath })
      } else {
        await recordStudentPayment({ studentId: Number(studentId), feeMonths, amount: Number(amount), method, status, dateReceived, remarks, referenceNo, coachId: coachId ? Number(coachId) : null, receiptPath: nextReceiptPath })
      }
      notifications.show({ color: 'green', title: paymentId ? 'Payment updated' : 'Payment recorded', message: paymentId ? 'The payment correction was saved.' : `${feeMonths.length} fee month${feeMonths.length > 1 ? 's' : ''} updated.` })
      formModal.close()
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', title: 'Could not save payment', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function remove(payment: Payment) {
    if (!window.confirm(`Delete the ${dayjs(payment.fee_month).format('MMMM YYYY')} payment?`)) return
    try {
      await deletePayment(payment)
      notifications.show({ color: 'green', message: 'Payment deleted' })
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', title: 'Payment cannot be deleted', message: errorMessage(error) })
    }
  }

  return (
    <>
      <PageHeader title="Payments" description="Student fees, receipts, payment history, and outstanding months" action={<Group><SegmentedControl value={periodMode} onChange={(value) => setPeriodMode(value as 'month' | 'year')} data={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />{periodMode === 'month' ? <Select value={period} onChange={(value) => setPeriod(value || dayjs().format('YYYY-MM'))} data={months} w={180} /> : <Select value={year} onChange={(value) => setYear(value || dayjs().format('YYYY'))} data={years} w={120} />}<Button leftSection={<IconPlus size={17} />} onClick={() => openNew()}>Record payment</Button></Group>} />
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} mb="xl">
        <StatCard label="Collected" value={`RM ${money(collected)}`} detail={periodMode === 'month' ? dayjs(`${period}-01`).format('MMMM YYYY') : year} icon={IconCash} color="green" />
        <StatCard label="Fully paid" value={paidIds.size} detail={`${activeEnrolled.length} active enrolled students`} icon={IconCheck} color="blue" />
        <StatCard label="All-time outstanding" value={`RM ${money(outstandingAmount)}`} detail={`${outstandingStudents.length} students · from enrollment start`} icon={IconAlertCircle} color="red" />
      </SimpleGrid>

      <Paper radius="lg" withBorder>
        <Group justify="space-between" p="lg"><Box><Text fw={800} size="lg">Student collection status</Text><Text c="dimmed" size="sm">Open a student to review or correct every payment.</Text></Box><Badge variant="light" size="lg">{periodMode === 'month' ? dayjs(`${period}-01`).format('MMM YYYY') : year}</Badge></Group>
        <Stack hiddenFrom="md" p="md" gap="sm">{activeEnrolled.map((student) => <PaymentCard key={student.id} student={student} payments={periodPayments.filter((payment) => payment.student_id === student.id)} arrears={arrears.get(student.id)} onHistory={() => showHistory(student)} onAdd={() => openNew(student)} />)}</Stack>
        <Box visibleFrom="md"><Table.ScrollContainer minWidth={820}><Table verticalSpacing="sm" horizontalSpacing="lg" highlightOnHover><Table.Thead><Table.Tr><Table.Th>Student</Table.Th><Table.Th>Monthly fee</Table.Th><Table.Th>Status</Table.Th><Table.Th>Received</Table.Th><Table.Th>Method / reference</Table.Th><Table.Th>Outstanding</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{activeEnrolled.map((student) => {
          const rows = periodPayments.filter((payment) => payment.student_id === student.id); const best = bestPayment(rows); const total = rows.filter((payment) => payment.status !== 'Unpaid').reduce((sum, payment) => sum + Number(payment.amount), 0); const due = arrears.get(student.id)
          return <Table.Tr key={student.id} onClick={() => showHistory(student)} style={{ cursor: 'pointer' }}><Table.Td><Group wrap="nowrap"><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={42} /><Box><Text fw={700}>{student.name}</Text><Text size="xs" c="dimmed">{student.student_phone || student.parent_contact || 'No phone'}</Text></Box></Group></Table.Td><Table.Td>RM {money(student.monthly_fee || 0)}</Table.Td><Table.Td><StatusBadge status={best?.status} /></Table.Td><Table.Td><Text fw={650}>RM {money(total)}</Text><Text size="xs" c="dimmed">{best?.date_received ? dayjs(best.date_received).format('D MMM YYYY') : '—'}</Text></Table.Td><Table.Td><Text size="sm">{best?.method || '—'}</Text><Text size="xs" c="dimmed">{best?.reference_no || 'No reference'}</Text></Table.Td><Table.Td><Text fw={650}>{due?.months.length || 0} months</Text><Text size="xs" c="dimmed">RM {money(due?.amount || 0)}</Text></Table.Td><Table.Td><Button variant="light" size="xs" onClick={(event) => { event.stopPropagation(); openNew(student) }}>Add</Button></Table.Td></Table.Tr>
        })}</Table.Tbody></Table></Table.ScrollContainer></Box>
      </Paper>

      <Modal opened={historyOpened} onClose={historyModal.close} title={`${selectedStudent?.name || ''} payment history`} size="lg" centered>
        <Stack>{history.length ? history.map((payment) => <Paper key={payment.id} p="md" radius="md" withBorder><Group justify="space-between" align="flex-start"><Box><Group gap="xs"><Text fw={800}>{dayjs(payment.fee_month).format('MMMM YYYY')}</Text><StatusBadge status={payment.status} />{payment.commission_settled && <Badge color="violet" variant="light">Commission settled</Badge>}</Group><Text size="sm" c="dimmed" mt={4}>{payment.method || 'No method'} · {payment.date_received ? dayjs(payment.date_received).format('D MMM YYYY') : 'No received date'}</Text></Box><Text fw={850}>RM {money(payment.amount)}</Text></Group><Text size="sm" mt="sm">Reference: {payment.reference_no || '—'}</Text>{payment.remarks && <Text size="sm" c="dimmed">{payment.remarks}</Text>}<Group mt="md"><Button variant="light" leftSection={<IconEdit size={16} />} onClick={() => editPayment(payment)}>Edit</Button>{payment.receipt_path && <Button variant="light" color="blue" leftSection={<IconEye size={16} />} onClick={() => openReceipt(payment.receipt_path!)}>Receipt</Button>}<Button variant="light" color="red" leftSection={<IconTrash size={16} />} onClick={() => remove(payment)}>Delete</Button></Group></Paper>) : <Text c="dimmed" ta="center" py="xl">No payments recorded.</Text>}<Button leftSection={<IconPlus size={16} />} onClick={() => selectedStudent && openNew(selectedStudent)}>Add payment</Button></Stack>
      </Modal>

      <Modal opened={formOpened} onClose={formModal.close} title={paymentId ? 'Edit payment' : 'Record student payment'} size="lg" centered>
        <Stack>
          <Select label="Student" searchable required value={studentId} onChange={(value) => { setStudentId(value); const student = data.students.find((item) => String(item.id) === value); setAmount(student?.monthly_fee || ''); setCoachId(student ? String(defaultCoach(student.id) || '') || null : null) }} data={activeEnrolled.map((student) => ({ value: String(student.id), label: student.name }))} />
          {paymentId ? <Select label="Fee month" value={feeMonths[0]} onChange={(value) => setFeeMonths(value ? [value] : [])} data={months} /> : <MultiSelect label="Fee month(s)" required value={feeMonths} onChange={setFeeMonths} data={months} searchable />}
          <Grid><Grid.Col span={{ base: 12, xs: 6 }}><NumberInput label="Amount received (RM)" value={amount} onChange={setAmount} min={0} decimalScale={2} required /></Grid.Col><Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Date received" type="date" value={dateReceived} onChange={(event) => setDateReceived(event.currentTarget.value)} required /></Grid.Col></Grid>
          <Grid><Grid.Col span={{ base: 12, xs: 6 }}><Select label="Method" value={method} onChange={(value) => setMethod(value as PaymentMethod)} data={methods} required /></Grid.Col><Grid.Col span={{ base: 12, xs: 6 }}><Select label="Status" value={status} onChange={(value) => setStatus(value as PaymentStatus)} data={statuses} required /></Grid.Col></Grid>
          <Grid><Grid.Col span={{ base: 12, xs: 6 }}><TextInput label="Reference number" value={referenceNo} onChange={(event) => setReferenceNo(event.currentTarget.value)} /></Grid.Col><Grid.Col span={{ base: 12, xs: 6 }}><Select label="Coach for commission" clearable value={coachId} onChange={setCoachId} data={data.coaches.filter((coach) => coach.coach_type === 'Head').map((coach) => ({ value: String(coach.id), label: coach.name }))} /></Grid.Col></Grid>
          <Textarea label="Remarks" description="Include registration fees or adjustments here." value={remarks} onChange={(event) => setRemarks(event.currentTarget.value)} />
          <FileInput label="Receipt" accept="image/png,image/jpeg,image/webp" value={receipt} onChange={handleReceipt} leftSection={<IconReceipt size={16} />} clearable />
          {receiptPath && !receipt && <Button variant="light" leftSection={<IconEye size={16} />} onClick={() => openReceipt(receiptPath)}>View current receipt</Button>}
          {ocrMessage && <Alert icon={<IconRobot size={17} />} color={ocrMessage.startsWith('OCR unavailable') ? 'orange' : 'blue'}>{ocrMessage}</Alert>}
          {!paymentId && feeMonths.length > 1 && <Alert color="blue">The latest month stores the full amount and reference. Earlier months remain separate Paid commission units.</Alert>}
          {paymentId && data.payments.find((payment) => payment.id === paymentId)?.commission_settled && <Alert color="violet">This payment is linked to a settled coach payout. Editing it does not recalculate historical payout lines.</Alert>}
          <Group className="modal-actions" justify="flex-end"><Button variant="default" onClick={formModal.close}>Cancel</Button><Button onClick={submit} loading={saving} disabled={!studentId || !feeMonths.length || amount === ''}>Save payment</Button></Group>
        </Stack>
      </Modal>
    </>
  )
}

function PaymentCard({ student, payments, arrears, onHistory, onAdd }: { student: Student; payments: Payment[]; arrears?: { months: string[]; amount: number }; onHistory: () => void; onAdd: () => void }) {
  const best = bestPayment(payments); const total = payments.filter((payment) => payment.status !== 'Unpaid').reduce((sum, payment) => sum + Number(payment.amount), 0)
  return <Paper p="md" radius="md" withBorder><Group justify="space-between" align="flex-start" wrap="nowrap"><Group wrap="nowrap"><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={48} /><Box><Text fw={800}>{student.name}</Text><Text size="xs" c="dimmed">{student.student_phone || student.parent_contact || 'No phone'}</Text><Text size="xs" c="dimmed">RM {money(student.monthly_fee || 0)} / month</Text></Box></Group><StatusBadge status={best?.status} /></Group><SimpleGrid cols={2} mt="md"><Box><Text size="xs" c="dimmed">Received</Text><Text fw={700}>RM {money(total)}</Text></Box><Box><Text size="xs" c="dimmed">Outstanding</Text><Text fw={700}>{arrears?.months.length || 0} months</Text><Text size="xs" c="dimmed">RM {money(arrears?.amount || 0)}</Text></Box></SimpleGrid><Group grow mt="md"><Button variant="light" leftSection={<IconHistory size={16} />} onClick={onHistory}>History</Button><Button leftSection={<IconPlus size={16} />} onClick={onAdd}>Add</Button></Group></Paper>
}

function StatusBadge({ status }: { status?: PaymentStatus }) {
  return <Badge color={status === 'Paid' ? 'green' : status === 'Partial' ? 'orange' : 'red'} variant="light">{status || 'Outstanding'}</Badge>
}

function bestPayment(rows: Payment[]) {
  return rows.find((payment) => payment.status === 'Paid') || rows.find((payment) => payment.status === 'Partial') || rows[0]
}

function calculateArrears(data: BootstrapData) {
  const result = new Map<number, { months: string[]; amount: number }>()
  const current = dayjs().startOf('month')
  data.students.forEach((student) => {
    const starts = data.enrollments.filter((item) => item.student_id === student.id).map((item) => dayjs(item.start_date).startOf('month')).filter((date) => date.isValid())
    if (!starts.length) return
    let cursor = starts.sort((a, b) => a.valueOf() - b.valueOf())[0]
    const paid = new Set(data.payments.filter((payment) => payment.student_id === student.id && payment.status === 'Paid').map((payment) => payment.fee_month.slice(0, 7)))
    const unpaid: string[] = []
    while (cursor.isBefore(current) || cursor.isSame(current, 'month')) { const value = cursor.format('YYYY-MM'); if (!paid.has(value)) unpaid.push(value); cursor = cursor.add(1, 'month') }
    result.set(student.id, { months: unpaid, amount: unpaid.length * Number(student.monthly_fee || 0) })
  })
  return result
}

function money(value: number) {
  return Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
