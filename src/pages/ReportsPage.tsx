import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Badge, Grid, Group, Paper, Progress, Select, SimpleGrid, Table, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconBallBasketball, IconCalendarStats, IconChartBar, IconUsers } from '@tabler/icons-react'
import { getAttendanceReport } from '../lib/api'
import { PageHeader, StatCard } from '../components/ui'
import type { Attendance, BootstrapData, Student, AcademyClass } from '../types/models'

type ReportRecord = Attendance & { student: Pick<Student, 'id' | 'name' | 'status' | 'gender' | 'level'>; class: Pick<AcademyClass, 'id' | 'label'> }

export function ReportsPage({ branchId, data }: { branchId: number; data: BootstrapData }) {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'))
  const [records, setRecords] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getAttendanceReport(branchId, `${month}-01`, dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD'))
      .then(setRecords)
      .catch((error) => notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not load report' }))
      .finally(() => setLoading(false))
  }, [branchId, month])

  const rows = useMemo(() => {
    const byStudent = new Map<number, { name: string; level: string; total: number; classes: Map<string, number> }>()
    records.forEach((record) => {
      const item = byStudent.get(record.student_id) || { name: record.student.name, level: record.student.level, total: 0, classes: new Map() }
      item.total += 1
      item.classes.set(record.class.label, (item.classes.get(record.class.label) || 0) + 1)
      byStudent.set(record.student_id, item)
    })
    return [...byStudent.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  }, [records])

  const classCounts = useMemo(() => {
    const counts = new Map<string, number>()
    records.forEach((record) => counts.set(record.class.label, (counts.get(record.class.label) || 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [records])
  const activeStudents = data.students.filter((student) => student.status === 'Active').length
  const attendedStudents = new Set(records.map((record) => record.student_id)).size
  const average = attendedStudents ? records.length / attendedStudents : 0
  const maxTotal = Math.max(1, ...rows.map((row) => row.total))
  const months = Array.from({ length: 24 }, (_, index) => dayjs().subtract(index, 'month')).map((date) => ({ value: date.format('YYYY-MM'), label: date.format('MMMM YYYY') }))

  return (
    <>
      <PageHeader title="Reports" description="Present-only attendance analysis by student and class" action={<Select value={month} onChange={(value) => setMonth(value || dayjs().format('YYYY-MM'))} data={months} w={190} />} />
      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="xl">
        <StatCard label="Attendance entries" value={records.length} detail={dayjs(`${month}-01`).format('MMMM YYYY')} icon={IconCalendarStats} color="violet" />
        <StatCard label="Students attended" value={attendedStudents} detail={`${activeStudents} active students in branch`} icon={IconUsers} color="blue" />
        <StatCard label="Average sessions" value={average.toFixed(1)} detail="Per attending student" icon={IconChartBar} color="green" />
      </SimpleGrid>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Paper radius="lg" withBorder>
            <Group justify="space-between" p="lg"><div><Text fw={800} size="lg">Student attendance</Text><Text c="dimmed" size="sm">All students with at least one Present record</Text></div><Badge variant="light">{rows.length} students</Badge></Group>
            <Table.ScrollContainer minWidth={680}>
              <Table verticalSpacing="sm" horizontalSpacing="lg" highlightOnHover>
                <Table.Thead><Table.Tr><Table.Th>Student</Table.Th><Table.Th>Class breakdown</Table.Th><Table.Th>Total</Table.Th><Table.Th>Activity</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{rows.map((row) => <Table.Tr key={row.name}><Table.Td><Text fw={700}>{row.name}</Text><Text size="xs" c="dimmed">{row.level || 'No level'}</Text></Table.Td><Table.Td><Group gap={5}>{[...row.classes].map(([label, count]) => <Badge key={label} variant="light" color="gray">{label} · {count}</Badge>)}</Group></Table.Td><Table.Td><Text fw={800}>{row.total}</Text></Table.Td><Table.Td w={150}><Progress value={(row.total / maxTotal) * 100} radius="xl" /></Table.Td></Table.Tr>)}</Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Paper p="lg" radius="lg" withBorder>
            <Group mb="lg"><IconBallBasketball size={21} /><Text fw={800} size="lg">Attendance by class</Text></Group>
            {classCounts.length ? classCounts.map(([label, count]) => <div key={label} className="report-class-row"><Group justify="space-between"><Text size="sm" fw={650}>{label}</Text><Text size="sm" fw={800}>{count}</Text></Group><Progress mt={7} value={(count / Math.max(1, classCounts[0][1])) * 100} color="orange" radius="xl" /></div>) : <Text c="dimmed" size="sm">No attendance recorded in this period.</Text>}
          </Paper>
        </Grid.Col>
      </Grid>
      {loading && <Text c="dimmed" mt="md">Refreshing report…</Text>}
    </>
  )
}
