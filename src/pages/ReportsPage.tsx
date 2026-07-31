import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Badge, Box, Button, Group, Paper, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconChevronDown, IconClipboard } from '@tabler/icons-react'
import { getAttendanceReport } from '../lib/api'
import { PageHeader } from '../components/ui'
import type { AcademyClass, Attendance, BootstrapData, Student } from '../types/models'

type ReportRecord = Attendance & { student: Pick<Student, 'id' | 'name' | 'status' | 'gender' | 'level'>; class: Pick<AcademyClass, 'id' | 'label'> }
type ReportRow = {
  id: number
  name: string
  level: string
  age: number | null
  total: number
  enrolledClasses: Array<{ id: number; label: string }>
  classes: Map<number, { label: string; dates: string[]; walkIns: number }>
  dates: Map<string, Array<{ classId: number; className: string; walkIn: boolean }>>
}

const classColors = ['#ef3340', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']
const monthOptions = [{ value: 'All', label: 'All months' }, ...Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1).padStart(2, '0'), label: dayjs(`2026-${String(index + 1).padStart(2, '0')}-01`).format('MMMM') }))]

export function ReportsPage({ branchId, data }: { branchId: number; data: BootstrapData }) {
  const [year, setYear] = useState(dayjs().format('YYYY'))
  const [month, setMonth] = useState(dayjs().format('MM'))
  const [view, setView] = useState<'summary' | 'grid'>('summary')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set())
  const [records, setRecords] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)

  const period = useMemo(() => {
    const start = month === 'All' ? dayjs(`${year}-01-01`) : dayjs(`${year}-${month}-01`)
    const end = month === 'All' ? start.endOf('year') : start.endOf('month')
    return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD'), label: month === 'All' ? year : start.format('MMMM YYYY') }
  }, [month, year])

  useEffect(() => {
    let active = true
    setLoading(true)
    getAttendanceReport(branchId, period.start, period.end)
      .then((next) => { if (active) setRecords(next) })
      .catch((error) => { if (active) notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not load report' }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [branchId, period.end, period.start])

  const rows = useMemo(() => {
    const byStudent = new Map<number, ReportRow>()
    data.students.filter((student) => student.status === 'Active' && data.enrollments.some((entry) => entry.student_id === student.id && entry.start_date <= period.end)).forEach((student) => {
      const enrolledClasses = data.enrollments.filter((entry) => entry.student_id === student.id && entry.start_date <= period.end).map((entry) => data.classes.find((item) => item.id === entry.class_id)).filter((item): item is AcademyClass => Boolean(item)).map((item) => ({ id: item.id, label: item.label }))
      byStudent.set(student.id, { id: student.id, name: student.name, level: student.level, age: student.date_of_birth ? dayjs().diff(dayjs(student.date_of_birth), 'year') : null, total: 0, enrolledClasses, classes: new Map(), dates: new Map() })
    })
    records.forEach((record) => {
      const student = data.students.find((item) => item.id === record.student_id)
      const row = byStudent.get(record.student_id) || { id: record.student_id, name: record.student.name, level: record.student.level, age: student?.date_of_birth ? dayjs().diff(dayjs(student.date_of_birth), 'year') : null, total: 0, enrolledClasses: [], classes: new Map(), dates: new Map() }
      const walkIn = !data.enrollments.some((entry) => entry.student_id === record.student_id && entry.class_id === record.class_id && entry.start_date <= record.attendance_date)
      const classEntry = row.classes.get(record.class_id) || { label: record.class.label, dates: [], walkIns: 0 }
      classEntry.dates.push(record.attendance_date)
      if (walkIn) classEntry.walkIns += 1
      row.classes.set(record.class_id, classEntry)
      row.dates.set(record.attendance_date, [...(row.dates.get(record.attendance_date) || []), { classId: record.class_id, className: record.class.label, walkIn }])
      row.total += 1
      byStudent.set(record.student_id, row)
    })
    return [...byStudent.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [data.classes, data.enrollments, data.students, period.end, records])

  const dates = useMemo(() => [...new Set([...data.sessions.filter((item) => item.session_date >= period.start && item.session_date <= period.end).map((item) => item.session_date), ...records.map((item) => item.attendance_date)])].sort(), [data.sessions, period.end, period.start, records])
  const classesInReport = useMemo(() => [...new Map(records.map((record) => [record.class_id, record.class.label])).entries()], [records])
  const colorFor = (classId: number) => classColors[Math.abs(classId) % classColors.length]
  const years = Array.from({ length: 8 }, (_, index) => String(dayjs().year() - index))

  function toggleRow(studentId: number) {
    setExpandedRows((current) => {
      const next = new Set(current)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  async function copyReport() {
    const heading = view === 'summary' ? ['Student', 'Enrolled classes', 'Total', 'Attendance detail'] : ['Student', 'Total', ...dates]
    const body = rows.map((row) => view === 'summary'
      ? [row.name, row.enrolledClasses.map((item) => item.label).join('; '), row.total, [...row.classes.values()].map((item) => `${item.label}: ${item.dates.join(', ')}`).join('; ')]
      : [row.name, row.total, ...dates.map((date) => (row.dates.get(date) || []).map((item) => item.className).join('; '))])
    try {
      await navigator.clipboard.writeText([heading, ...body].map((cells) => cells.map((cell) => String(cell).replace(/\t|\r?\n/g, ' ')).join('\t')).join('\n'))
      notifications.show({ color: 'green', message: `${period.label} report copied` })
    } catch {
      notifications.show({ color: 'red', message: 'Clipboard access was not available' })
    }
  }

  return <>
    <PageHeader title="Reports" description="Student attendance overview" action={<Button variant="light" leftSection={<IconClipboard size={17} />} onClick={copyReport}>Copy</Button>} />
    <SegmentedControl value={view} onChange={(value) => setView(value as 'summary' | 'grid')} data={[{ value: 'summary', label: 'Summary' }, { value: 'grid', label: 'Grid' }]} mb="md" />
    <Group grow mb="md" align="flex-end"><Select label="Year" value={year} onChange={(value) => setYear(value || dayjs().format('YYYY'))} data={years} allowDeselect={false} /><Select label="Month" value={month} onChange={(value) => setMonth(value || 'All')} data={monthOptions} allowDeselect={false} /></Group>

    {view === 'summary' ? <Stack gap="sm">{rows.map((row) => {
      const expanded = expandedRows.has(row.id)
      return <Paper key={row.id} className="report-student-summary" radius="lg" withBorder><Box component="button" type="button" className="report-summary-toggle" aria-expanded={expanded} onClick={() => toggleRow(row.id)}><Group justify="space-between" align="flex-start" wrap="nowrap"><Box><Text fw={800}>{row.name}</Text><Text size="xs" c="dimmed">{row.enrolledClasses.length} class{row.enrolledClasses.length === 1 ? '' : 'es'} enrolled</Text></Box><Group gap="sm" wrap="nowrap"><Box ta="center"><Text className="report-total">{row.total}</Text><Text size="xs" c="dimmed">classes</Text></Box><IconChevronDown className={expanded ? 'expanded' : ''} size={20} /></Group></Group><Group gap={5} mt="xs">{row.enrolledClasses.map((item) => <Badge key={item.id} size="sm" variant="light" color="blue">{item.label}</Badge>)}</Group></Box>{expanded && <Box className="report-summary-detail"><DividerLine /><Group justify="space-between" mb="sm"><Text fw={750} size="sm">{period.label}</Text><Text fw={750} size="sm">{row.total} classes</Text></Group>{row.classes.size ? <Stack gap="md">{[...row.classes].map(([classId, item]) => <Box key={classId}><Group justify="space-between" wrap="nowrap"><Group gap="xs" wrap="nowrap"><span className="report-class-dot" style={{ background: colorFor(classId) }} /><Text size="sm" c="dimmed">{item.label}{item.walkIns ? ` · ${item.walkIns} walk-in` : ''}</Text></Group><Text size="sm" fw={700}>{item.dates.length}</Text></Group><Stack gap={4} mt={5} ml="md">{item.dates.sort().map((attendanceDate) => <Group key={attendanceDate} gap="xs"><IconCheck size={14} color="#22c55e" /><Text size="xs" c="dimmed">{dayjs(attendanceDate).format('D MMM YYYY')}</Text></Group>)}</Stack></Box>)}</Stack> : <Text size="sm" c="dimmed">No attendance in this period.</Text>}</Box>}</Paper>
    })}</Stack> : <>
      <Group gap="md" mb="sm" wrap="wrap">{classesInReport.map(([id, label]) => <Group key={id} gap={5}><span className="report-class-dot" style={{ background: colorFor(id) }} /><Text size="xs" c="dimmed">{label}</Text></Group>)}</Group>
      <Paper radius="lg" withBorder className="report-grid-card"><Table.ScrollContainer minWidth={Math.max(680, 220 + dates.length * 44)}><Table className="attendance-grid-table" withColumnBorders striped><Table.Thead><Table.Tr><Table.Th className="report-sticky-name">Name</Table.Th><Table.Th>Total</Table.Th>{dates.map((date) => <Table.Th key={date} ta="center"><Text size="xs" fw={700}>{dayjs(date).format('MMM YYYY')}</Text><Text size="xs">{dayjs(date).format('D')}</Text></Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.map((row) => <Table.Tr key={row.id}><Table.Td className="report-sticky-name"><Group gap={4} wrap="nowrap"><Group gap={2}>{row.enrolledClasses.map((item) => <span key={item.id} className="report-class-dot" style={{ background: colorFor(item.id) }} />)}</Group><Text size="sm" fw={650}>{row.name}{row.age != null ? <Text span c="dimmed" size="xs"> ({row.age})</Text> : null}</Text></Group></Table.Td><Table.Td fw={700}>{row.total}</Table.Td>{dates.map((date) => <Table.Td key={date} ta="center"><Group gap={2} justify="center" wrap="nowrap">{(row.dates.get(date) || []).map((item, index) => <Text key={`${item.classId}-${index}`} span fw={800} style={{ color: colorFor(item.classId) }}>✓</Text>)}</Group></Table.Td>)}</Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></Paper>
    </>}
    {loading && <Text c="dimmed" mt="md">Refreshing report…</Text>}
  </>
}

function DividerLine() {
  return <Box my="md" style={{ borderTop: '1px solid #e5e8ee' }} />
}
