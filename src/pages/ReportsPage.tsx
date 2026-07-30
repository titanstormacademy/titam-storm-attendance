import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Badge, Box, Button, Grid, Group, Paper, Progress, SegmentedControl, Select, SimpleGrid, Stack, Table, Tabs, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBallBasketball, IconCalendarStats, IconChartBar, IconClipboard, IconUsers } from '@tabler/icons-react'
import { getAttendanceReport } from '../lib/api'
import { PageHeader, StatCard } from '../components/ui'
import type { Attendance, BootstrapData, Student, AcademyClass } from '../types/models'

type ReportRecord = Attendance & { student: Pick<Student, 'id' | 'name' | 'status' | 'gender' | 'level'>; class: Pick<AcademyClass, 'id' | 'label'> }
type ReportRow = {
  id: number
  name: string
  level: string
  total: number
  classes: Map<string, { count: number; walkIns: number }>
  dates: Map<string, Array<{ className: string; walkIn: boolean }>>
}

export function ReportsPage({ branchId, data }: { branchId: number; data: BootstrapData }) {
  const [rangeMode, setRangeMode] = useState<'month' | 'year'>('month')
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'))
  const [year, setYear] = useState(dayjs().format('YYYY'))
  const [view, setView] = useState<'summary' | 'grid'>('summary')
  const [records, setRecords] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)

  const period = useMemo(() => {
    const start = rangeMode === 'month' ? dayjs(`${month}-01`) : dayjs(`${year}-01-01`)
    const end = rangeMode === 'month' ? start.endOf('month') : start.endOf('year')
    return { start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD'), label: rangeMode === 'month' ? start.format('MMMM YYYY') : year }
  }, [month, rangeMode, year])

  useEffect(() => {
    let active = true
    setLoading(true)
    getAttendanceReport(branchId, period.start, period.end)
      .then((nextRecords) => { if (active) setRecords(nextRecords) })
      .catch((error) => { if (active) notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not load report' }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [branchId, period.end, period.start])

  const enrolledStudentIds = useMemo(() => new Set(data.enrollments
    .filter((enrollment) => enrollment.start_date <= period.end)
    .map((enrollment) => enrollment.student_id)), [data.enrollments, period.end])

  const rows = useMemo(() => {
    const byStudent = new Map<number, ReportRow>()
    data.students
      .filter((student) => student.status === 'Active' && enrolledStudentIds.has(student.id))
      .forEach((student) => byStudent.set(student.id, { id: student.id, name: student.name, level: student.level, total: 0, classes: new Map(), dates: new Map() }))

    records.forEach((record) => {
      const item = byStudent.get(record.student_id) || {
        id: record.student_id,
        name: record.student.name,
        level: record.student.level,
        total: 0,
        classes: new Map(),
        dates: new Map(),
      }
      const isWalkIn = !data.enrollments.some((enrollment) => enrollment.student_id === record.student_id && enrollment.class_id === record.class_id && enrollment.start_date <= record.attendance_date)
      const classItem = item.classes.get(record.class.label) || { count: 0, walkIns: 0 }
      classItem.count += 1
      if (isWalkIn) classItem.walkIns += 1
      item.classes.set(record.class.label, classItem)
      item.dates.set(record.attendance_date, [...(item.dates.get(record.attendance_date) || []), { className: record.class.label, walkIn: isWalkIn }])
      item.total += 1
      byStudent.set(record.student_id, item)
    })
    return [...byStudent.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [data.enrollments, data.students, enrolledStudentIds, records])

  const dates = useMemo(() => [...new Set([
    ...data.sessions.filter((session) => session.session_date >= period.start && session.session_date <= period.end).map((session) => session.session_date),
    ...records.map((record) => record.attendance_date),
  ])].sort(), [data.sessions, period.end, period.start, records])
  const classCounts = useMemo(() => {
    const counts = new Map<string, number>()
    records.forEach((record) => counts.set(record.class.label, (counts.get(record.class.label) || 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [records])
  const activeEnrolledStudents = rows.filter((row) => enrolledStudentIds.has(row.id)).length
  const attendedStudents = new Set(records.map((record) => record.student_id)).size
  const average = attendedStudents ? records.length / attendedStudents : 0
  const maxTotal = Math.max(1, ...rows.map((row) => row.total))
  const months = Array.from({ length: 36 }, (_, index) => dayjs().subtract(index, 'month')).map((date) => ({ value: date.format('YYYY-MM'), label: date.format('MMMM YYYY') }))
  const years = Array.from({ length: 8 }, (_, index) => String(dayjs().year() - index))

  async function copyReport() {
    const heading = view === 'summary'
      ? ['Student', 'Level', 'Total', 'Exact dates and classes', 'Class breakdown']
      : ['Student', ...dates.map((date) => dayjs(date).format('D MMM YYYY')), 'Total']
    const body = rows.map((row) => view === 'summary'
      ? [row.name, row.level || 'No level', row.total, dateDetails(row), classDetails(row)]
      : [row.name, ...dates.map((date) => cellDetails(row, date)), row.total])
    const text = [heading, ...body].map((cells) => cells.map(tsvCell).join('\t')).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      notifications.show({ color: 'green', message: `${period.label} ${view} report copied to clipboard` })
    } catch {
      notifications.show({ color: 'red', message: 'Clipboard access was not available' })
    }
  }

  return (
    <>
      <PageHeader title="Reports" description="Present attendance, including enrolled students with zero attendance and walk-ins" action={
        <Group align="flex-end" wrap="wrap">
          <SegmentedControl value={rangeMode} onChange={(value) => setRangeMode(value as 'month' | 'year')} data={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]} />
          {rangeMode === 'month'
            ? <Select value={month} onChange={(value) => setMonth(value || dayjs().format('YYYY-MM'))} data={months} w={190} allowDeselect={false} />
            : <Select value={year} onChange={(value) => setYear(value || dayjs().format('YYYY'))} data={years} w={120} allowDeselect={false} />}
          <Button variant="light" leftSection={<IconClipboard size={17} />} onClick={copyReport}>Copy</Button>
        </Group>
      } />
      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="xl">
        <StatCard label="Attendance entries" value={records.length} detail={period.label} icon={IconCalendarStats} color="violet" />
        <StatCard label="Students attended" value={attendedStudents} detail={`${activeEnrolledStudents} active enrolled students`} icon={IconUsers} color="blue" />
        <StatCard label="Average sessions" value={average.toFixed(1)} detail="Per attending student" icon={IconChartBar} color="green" />
      </SimpleGrid>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Paper radius="lg" withBorder>
            <Group justify="space-between" p="lg" align="flex-start"><div><Text fw={800} size="lg">Student attendance</Text><Text c="dimmed" size="sm">Active enrolled students are retained when their total is zero.</Text></div><Badge variant="light">{rows.length} students</Badge></Group>
            <Tabs value={view} onChange={(value) => setView((value as 'summary' | 'grid') || 'summary')}>
              <Tabs.List px="lg"><Tabs.Tab value="summary">Summary</Tabs.Tab><Tabs.Tab value="grid">Student × dates</Tabs.Tab></Tabs.List>
              <Tabs.Panel value="summary">
                <Box visibleFrom="sm">
                  <Table.ScrollContainer minWidth={760}>
                    <Table verticalSpacing="sm" horizontalSpacing="lg" highlightOnHover>
                      <Table.Thead><Table.Tr><Table.Th>Student</Table.Th><Table.Th>Exact dates / classes</Table.Th><Table.Th>Class breakdown</Table.Th><Table.Th>Total</Table.Th><Table.Th>Activity</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>{rows.map((row) => <Table.Tr key={row.id}><Table.Td><StudentName row={row} /></Table.Td><Table.Td><DateBadges row={row} /></Table.Td><Table.Td><ClassBadges row={row} /></Table.Td><Table.Td><Text fw={800}>{row.total}</Text></Table.Td><Table.Td w={130}><Progress value={(row.total / maxTotal) * 100} radius="xl" /></Table.Td></Table.Tr>)}</Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Box>
                <Stack hiddenFrom="sm" p="md" gap="sm">{rows.map((row) => <StudentCard key={row.id} row={row} mode="summary" />)}</Stack>
              </Tabs.Panel>
              <Tabs.Panel value="grid">
                <Box visibleFrom="sm">
                  <Table.ScrollContainer minWidth={Math.max(680, dates.length * 150 + 240)}>
                    <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover withColumnBorders>
                      <Table.Thead><Table.Tr><Table.Th>Student</Table.Th>{dates.map((date) => <Table.Th key={date}>{dayjs(date).format('D MMM YYYY')}</Table.Th>)}<Table.Th>Total</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>{rows.map((row) => <Table.Tr key={row.id}><Table.Td><StudentName row={row} /></Table.Td>{dates.map((date) => <Table.Td key={date}><AttendanceCell row={row} date={date} /></Table.Td>)}<Table.Td><Text fw={800}>{row.total}</Text></Table.Td></Table.Tr>)}</Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Box>
                <Stack hiddenFrom="sm" p="md" gap="sm">{rows.map((row) => <StudentCard key={row.id} row={row} mode="grid" />)}</Stack>
              </Tabs.Panel>
            </Tabs>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Paper p="lg" radius="lg" withBorder>
            <Group mb="lg"><IconBallBasketball size={21} /><Text fw={800} size="lg">Attendance by class</Text></Group>
            {classCounts.length ? classCounts.map(([label, count]) => <Box key={label} mb="md"><Group justify="space-between"><Text size="sm" fw={650}>{label}</Text><Text size="sm" fw={800}>{count}</Text></Group><Progress mt={7} value={(count / Math.max(1, classCounts[0][1])) * 100} color="orange" radius="xl" /></Box>) : <Text c="dimmed" size="sm">No attendance recorded in this period.</Text>}
          </Paper>
        </Grid.Col>
      </Grid>
      {loading && <Text c="dimmed" mt="md">Refreshing report…</Text>}
    </>
  )
}

function StudentName({ row }: { row: ReportRow }) {
  return <><Text fw={700}>{row.name}</Text><Text size="xs" c="dimmed">{row.level || 'No level'}</Text></>
}

function ClassBadges({ row }: { row: ReportRow }) {
  if (!row.classes.size) return <Text size="sm" c="dimmed">No attendance</Text>
  return <Group gap={5}>{[...row.classes].map(([label, item]) => <Badge key={label} variant="light" color={item.walkIns ? 'orange' : 'gray'}>{label} · {item.count}{item.walkIns ? ` · ${item.walkIns} walk-in` : ''}</Badge>)}</Group>
}

function DateBadges({ row }: { row: ReportRow }) {
  if (!row.dates.size) return <Text size="sm" c="dimmed">—</Text>
  return <Stack gap={5}>{[...row.dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => <Group key={date} gap={5} wrap="wrap"><Text size="xs" fw={700}>{dayjs(date).format('D MMM YYYY')}</Text>{items.map((item, index) => <Badge key={`${item.className}-${index}`} size="xs" variant="outline" color={item.walkIn ? 'orange' : 'blue'}>{item.className}{item.walkIn ? ' · Walk-in' : ''}</Badge>)}</Group>)}</Stack>
}

function AttendanceCell({ row, date }: { row: ReportRow; date: string }) {
  const items = row.dates.get(date)
  if (!items?.length) return <Text c="dimmed" ta="center">—</Text>
  return <Stack gap={4}>{items.map((item, index) => <Badge key={`${item.className}-${index}`} size="xs" variant="light" color={item.walkIn ? 'orange' : 'blue'}>{item.className}{item.walkIn ? ' · Walk-in' : ''}</Badge>)}</Stack>
}

function StudentCard({ row, mode }: { row: ReportRow; mode: 'summary' | 'grid' }) {
  return <Paper p="md" radius="md" withBorder><Group justify="space-between" align="flex-start"><StudentName row={row} /><Badge size="lg" variant="light">{row.total}</Badge></Group><Text size="xs" c="dimmed" fw={700} mt="md" mb={6}>{mode === 'grid' ? 'ATTENDED DATES' : 'EXACT DATES / CLASSES'}</Text><DateBadges row={row} />{mode === 'summary' && <><Text size="xs" c="dimmed" fw={700} mt="md" mb={6}>CLASS BREAKDOWN</Text><ClassBadges row={row} /></>}</Paper>
}

function cellDetails(row: ReportRow, date: string) {
  return (row.dates.get(date) || []).map((item) => `${item.className}${item.walkIn ? ' (Walk-in)' : ''}`).join('; ')
}

function dateDetails(row: ReportRow) {
  return [...row.dates].sort(([a], [b]) => a.localeCompare(b)).map(([date]) => `${dayjs(date).format('D MMM YYYY')}: ${cellDetails(row, date)}`).join('; ')
}

function classDetails(row: ReportRow) {
  return [...row.classes].map(([label, item]) => `${label}: ${item.count}${item.walkIns ? ` (${item.walkIns} walk-in)` : ''}`).join('; ')
}

function tsvCell(value: string | number) {
  return String(value).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}
