import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Alert, Badge, Box, Button, Grid, Group, Paper, SegmentedControl, Select, Stack, Table, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconCheck, IconChevronDown, IconClipboard, IconSearch } from '@tabler/icons-react'
import { getAttendanceReport } from '../lib/api'
import { PageHeader, PageLoader } from '../components/ui'
import type { AcademyClass, Attendance, BootstrapData, Student } from '../types/models'

type ReportRecord = Attendance & { student: Pick<Student, 'id' | 'name' | 'status' | 'gender' | 'level'>; class: Pick<AcademyClass, 'id' | 'label'> }
type ReportRow = {
  id: number
  name: string
  level: string
  age: number | null
  total: number
  trialCount: number
  enrolledClasses: Array<{ id: number; label: string }>
  classes: Map<number, { label: string; dates: Array<{ date: string; trial: boolean }>; walkIns: number; trials: number }>
  dates: Map<string, Array<{ classId: number; className: string; walkIn: boolean; trial: boolean }>>
}

const classColors = ['#ef3340', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']
const monthOptions = [{ value: 'All', label: 'All months' }, ...Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1).padStart(2, '0'), label: dayjs(`2026-${String(index + 1).padStart(2, '0')}-01`).format('MMMM') }))]

export function ReportsPage({ branchId, data }: { branchId: number; data: BootstrapData }) {
  const [year, setYear] = useState(dayjs().format('YYYY'))
  const [month, setMonth] = useState(dayjs().format('MM'))
  const [view, setView] = useState<'summary' | 'grid'>('summary')
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState<string | null>('All')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set())
  const [records, setRecords] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadRequest, setReloadRequest] = useState(0)

  const period = useMemo(() => {
    const start = month === 'All' ? dayjs(`${year}-01-01`) : dayjs(`${year}-${month}-01`)
    const end = month === 'All' ? start.endOf('year') : start.endOf('month')
    return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD'), label: month === 'All' ? year : start.format('MMMM YYYY') }
  }, [month, year])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    setRecords([])
    setExpandedRows(new Set())
    getAttendanceReport(branchId, period.start, period.end)
      .then((next) => { if (active) setRecords(next) })
      .catch((error) => { if (active) setLoadError(error instanceof Error ? error.message : 'Could not load report') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [branchId, period.end, period.start, reloadRequest])

  const selectedClassId = classFilter === 'All' ? null : Number(classFilter)
  const reportRecords = useMemo(() => records.filter((record) => selectedClassId == null || record.class_id === selectedClassId), [records, selectedClassId])

  const rows = useMemo(() => {
    const byStudent = new Map<number, ReportRow>()
    data.students.filter((student) => student.status === 'Active' && data.enrollments.some((entry) => entry.student_id === student.id && (selectedClassId == null || entry.class_id === selectedClassId) && entry.start_date <= period.end && (!entry.end_date || entry.end_date >= period.start))).forEach((student) => {
      const enrolledClasses = [...new Map(data.enrollments.filter((entry) => entry.student_id === student.id && (selectedClassId == null || entry.class_id === selectedClassId) && entry.start_date <= period.end && (!entry.end_date || entry.end_date >= period.start)).map((entry) => data.classes.find((item) => item.id === entry.class_id)).filter((item): item is AcademyClass => Boolean(item)).map((item) => [item.id, { id: item.id, label: item.label }])).values()]
      byStudent.set(student.id, { id: student.id, name: student.name, level: student.level, age: student.date_of_birth ? dayjs().diff(dayjs(student.date_of_birth), 'year') : null, total: 0, trialCount: 0, enrolledClasses, classes: new Map(), dates: new Map() })
    })
    reportRecords.forEach((record) => {
      const student = data.students.find((item) => item.id === record.student_id)
      const row = byStudent.get(record.student_id) || { id: record.student_id, name: record.student.name, level: record.student.level, age: student?.date_of_birth ? dayjs().diff(dayjs(student.date_of_birth), 'year') : null, total: 0, trialCount: 0, enrolledClasses: [], classes: new Map(), dates: new Map() }
      const walkIn = !data.enrollments.some((entry) => entry.student_id === record.student_id && entry.class_id === record.class_id && entry.start_date <= record.attendance_date && (!entry.end_date || entry.end_date >= record.attendance_date))
      const trial = Boolean(record.is_trial)
      const classEntry = row.classes.get(record.class_id) || { label: record.class.label, dates: [], walkIns: 0, trials: 0 }
      classEntry.dates.push({ date: record.attendance_date, trial })
      if (walkIn) classEntry.walkIns += 1
      if (trial) classEntry.trials += 1
      row.classes.set(record.class_id, classEntry)
      row.dates.set(record.attendance_date, [...(row.dates.get(record.attendance_date) || []), { classId: record.class_id, className: record.class.label, walkIn, trial }])
      if (trial) row.trialCount += 1
      else row.total += 1
      byStudent.set(record.student_id, row)
    })
    return [...byStudent.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [data.classes, data.enrollments, data.students, period.end, period.start, reportRecords, selectedClassId])

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => !needle || row.name.toLowerCase().includes(needle))
  }, [rows, search])

  const dates = useMemo(() => [...new Set([...data.sessions.filter((item) => (selectedClassId == null || item.class_id === selectedClassId) && item.session_date >= period.start && item.session_date <= period.end).map((item) => item.session_date), ...reportRecords.map((item) => item.attendance_date)])].sort(), [data.sessions, period.end, period.start, reportRecords, selectedClassId])
  const classesInReport = useMemo(() => [...new Map(reportRecords.map((record) => [record.class_id, record.class.label])).entries()], [reportRecords])
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
    const heading = view === 'summary' ? ['Student', 'Enrolled classes', 'Counted sessions', 'Trial sessions', 'Attendance detail'] : ['Student', 'Counted', 'Trials', ...dates]
    const body = filteredRows.map((row) => view === 'summary'
      ? [row.name, row.enrolledClasses.map((item) => item.label).join('; '), row.total, row.trialCount, [...row.classes.values()].map((item) => `${item.label}: ${item.dates.map((entry) => `${entry.date}${entry.trial ? ' (Trial)' : ''}`).join(', ')}`).join('; ')]
      : [row.name, row.total, row.trialCount, ...dates.map((date) => (row.dates.get(date) || []).map((item) => `${item.className}${item.trial ? ' (Trial)' : ''}`).join('; '))])
    try {
      await navigator.clipboard.writeText([heading, ...body].map((cells) => cells.map((cell) => String(cell).replace(/\t|\r?\n/g, ' ')).join('\t')).join('\n'))
      notifications.show({ color: 'green', message: `${period.label} report copied` })
    } catch {
      notifications.show({ color: 'red', message: 'Clipboard access was not available' })
    }
  }

  return <>
    <PageHeader title="Reports" description="Student attendance overview" action={<Button variant="light" leftSection={<IconClipboard size={17} />} onClick={copyReport} disabled={loading || Boolean(loadError) || filteredRows.length === 0}>Copy</Button>} />
    <SegmentedControl value={view} onChange={(value) => { const nextView = value as 'summary' | 'grid'; setView(nextView); if (nextView === 'grid' && month === 'All') setMonth(dayjs().format('MM')) }} data={[{ value: 'summary', label: 'Summary' }, { value: 'grid', label: 'Grid' }]} mb="md" />
    <Paper p="md" radius="lg" withBorder mb="md"><Grid gutter="sm" align="flex-end"><Grid.Col span={{ base: 12, md: 6 }}><TextInput label="Student" aria-label="Search report students" leftSection={<IconSearch size={17} />} placeholder="Search by student name…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></Grid.Col><Grid.Col span={{ base: 12, xs: 6, md: 2 }}><Select label="Class" aria-label="Filter report students by class" value={classFilter} onChange={setClassFilter} data={[{ value: 'All', label: 'All classes' }, ...data.classes.map((item) => ({ value: String(item.id), label: item.label }))]} allowDeselect={false} /></Grid.Col><Grid.Col span={{ base: 6, md: 2 }}><Select label="Year" value={year} onChange={(value) => setYear(value || dayjs().format('YYYY'))} data={years} allowDeselect={false} /></Grid.Col><Grid.Col span={{ base: 6, md: 2 }}><Select label="Month" value={month} onChange={(value) => setMonth(value || 'All')} data={monthOptions} allowDeselect={false} /></Grid.Col></Grid></Paper>
    {!loading && !loadError && rows.length > 0 && <Text size="xs" c="dimmed" mb="xs" px={4}>{filteredRows.length === rows.length ? `${rows.length} students` : `${filteredRows.length} of ${rows.length} students`}</Text>}

    {loading ? <PageLoader label="Loading report…" /> : loadError ? <Alert color="red" title="Could not load report">{loadError}<Button mt="md" size="xs" onClick={() => setReloadRequest((current) => current + 1)}>Retry</Button></Alert> : rows.length === 0 ? <Paper p="xl" radius="lg" withBorder><Text c="dimmed" ta="center">No attendance records for {period.label}.</Text></Paper> : filteredRows.length === 0 ? <Paper p="xl" radius="lg" withBorder><Text c="dimmed" ta="center">No students match the current report filters.</Text></Paper> : view === 'summary' ? <Stack gap="sm">{filteredRows.map((row) => {
      const expanded = expandedRows.has(row.id)
      return <Paper key={row.id} className="report-student-summary" radius="lg" withBorder><Box component="button" type="button" className="report-summary-toggle" aria-expanded={expanded} onClick={() => toggleRow(row.id)}><Group justify="space-between" align="flex-start" wrap="nowrap"><Box><Text fw={800}>{row.name}</Text><Text size="xs" c="dimmed">{row.enrolledClasses.length} class{row.enrolledClasses.length === 1 ? '' : 'es'} enrolled</Text></Box><Group gap="sm" wrap="nowrap"><Group gap="xs" wrap="nowrap"><Box ta="center"><Text className="report-total">{row.total}</Text><Text size="xs" c="dimmed">counted</Text></Box>{row.trialCount > 0 && <Box ta="center"><Text fw={800} c="orange">{row.trialCount}</Text><Text size="xs" c="dimmed">trial</Text></Box>}</Group><IconChevronDown className={expanded ? 'expanded' : ''} size={20} /></Group></Group><Group gap={5} mt="xs">{row.enrolledClasses.map((item) => <Badge key={item.id} size="sm" variant="light" color="blue">{item.label}</Badge>)}</Group></Box>{expanded && <Box className="report-summary-detail"><DividerLine /><Group justify="space-between" mb="sm"><Text fw={750} size="sm">{period.label}</Text><Text fw={750} size="sm">{row.total} counted sessions</Text></Group>{row.classes.size ? <Stack gap="md">{[...row.classes].map(([classId, item]) => <Box key={classId}><Group justify="space-between" wrap="nowrap"><Group gap="xs" wrap="nowrap"><span className="report-class-dot" style={{ background: colorFor(classId) }} /><Text size="sm" c="dimmed">{item.label}{item.walkIns ? ` · ${item.walkIns} walk-in` : ''}{item.trials ? ` · ${item.trials} trial` : ''}</Text></Group><Text size="sm" fw={700}>{item.dates.length}</Text></Group><Stack gap={4} mt={5} ml="md">{item.dates.sort((a, b) => a.date.localeCompare(b.date)).map((entry) => <Group key={`${entry.date}-${entry.trial}`} gap="xs"><IconCheck size={14} color={entry.trial ? '#f59e0b' : '#22c55e'} /><Text size="xs" c="dimmed">{dayjs(entry.date).format('D MMM YYYY')}</Text>{entry.trial && <Badge size="xs" color="orange" variant="light">Trial</Badge>}</Group>)}</Stack></Box>)}</Stack> : <Text size="sm" c="dimmed">No attendance in this period.</Text>}</Box>}</Paper>
    })}</Stack> : <>
      <Group gap="md" mb="sm" wrap="wrap">{classesInReport.map(([id, label]) => <Group key={id} gap={5}><span className="report-class-dot" style={{ background: colorFor(id) }} /><Text size="xs" c="dimmed">{label}</Text></Group>)}</Group>
      <Paper radius="lg" withBorder className="report-grid-card"><Table.ScrollContainer minWidth={Math.max(680, 220 + dates.length * 44)}><Table className="attendance-grid-table" withColumnBorders striped><Table.Thead><Table.Tr><Table.Th className="report-sticky-name">Name</Table.Th><Table.Th>Counted</Table.Th><Table.Th>Trial</Table.Th>{dates.map((date) => <Table.Th key={date} ta="center"><Text size="xs" fw={700}>{dayjs(date).format('MMM YYYY')}</Text><Text size="xs">{dayjs(date).format('D')}</Text></Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{filteredRows.map((row) => <Table.Tr key={row.id}><Table.Td className="report-sticky-name"><Group gap={4} wrap="nowrap"><Group gap={2}>{row.enrolledClasses.map((item) => <span key={item.id} className="report-class-dot" style={{ background: colorFor(item.id) }} />)}</Group><Text size="sm" fw={650}>{row.name}{row.age != null ? <Text span c="dimmed" size="xs"> ({row.age})</Text> : null}</Text></Group></Table.Td><Table.Td fw={700}>{row.total}</Table.Td><Table.Td fw={700} c="orange">{row.trialCount || '—'}</Table.Td>{dates.map((date) => <Table.Td key={date} ta="center"><Group gap={2} justify="center" wrap="nowrap">{(row.dates.get(date) || []).map((item, index) => <Text key={`${item.classId}-${index}`} span fw={800} aria-label={`${item.trial ? 'Trial session' : 'Present'} for ${item.className}${item.walkIn ? ' as walk-in' : ''}`} title={`${item.className}${item.trial ? ' · Trial' : ''}${item.walkIn ? ' · walk-in' : ''}`} style={{ color: item.trial ? '#f59e0b' : colorFor(item.classId) }}>{item.trial ? 'T' : '✓'}</Text>)}</Group></Table.Td>)}</Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></Paper>
    </>}
  </>
}

function DividerLine() {
  return <Box my="md" style={{ borderTop: '1px solid #e5e8ee' }} />
}
