import dayjs, { type Dayjs } from 'dayjs'
import { Badge, Box, Grid, Group, Paper, Progress, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconAlertCircle, IconBallBasketball, IconCake, IconCheck, IconSchool, IconUsers } from '@tabler/icons-react'
import { PageHeader, PersonAvatar } from '../components/ui'
import { publicImageUrl } from '../lib/supabase'
import type { BootstrapData, Student } from '../types/models'

export function DashboardPage({ data, branchName, isAdmin }: { data: BootstrapData; branchName: string; isAdmin: boolean }) {
  const today = dayjs()
  const activeStudents = data.students.filter((student) => student.status === 'Active')
  const currentMonth = today.format('YYYY-MM')
  const paidStudents = activeStudents.filter((student) => data.payments.some((payment) => payment.student_id === student.id && payment.fee_month.startsWith(currentMonth) && payment.status === 'Paid')).length
  const unpaidStudents = activeStudents.length - paidStudents
  const collectionRate = activeStudents.length ? Math.round((paidStudents / activeStudents.length) * 100) : 0
  const birthdays = isAdmin ? nearbyBirthdays(data.students, today) : []

  return (
    <>
      <PageHeader title={`Good ${greeting()}, team`} description={`${branchName} · ${today.format('dddd, D MMMM YYYY')}`} />
      <Grid className="dashboard-overview" gutter="xl">
        <Grid.Col span={{ base: 12, lg: isAdmin ? 5 : 12 }}>
          <Group justify="space-between" mb="sm"><Title order={3}>{isAdmin ? 'Monthly pulse' : 'Branch pulse'}</Title>{isAdmin && <Text size="sm" c="dimmed">{today.format('MMMM YYYY')}</Text>}</Group>
          <Paper className="monthly-pulse-panel" p={{ base: 'lg', sm: 'xl' }} radius="lg" withBorder>
            {isAdmin && <><Text size="sm" c="dimmed" fw={600}>Fee collection progress</Text><Group align="end" gap={8} mt="xs"><Text fz={34} fw={850}>{collectionRate}%</Text><Text c="dimmed" mb={7}>paid</Text></Group><Progress value={collectionRate} size="lg" radius="xl" mt="md" color="green" /><SimpleGrid className="fee-collection-matrix" cols={3} spacing="xs" mt="lg"><FeeMetric icon={<IconUsers size={18} />} label="Total students" value={activeStudents.length} color="blue" /><FeeMetric icon={<IconCheck size={18} />} label="Paid" value={paidStudents} color="green" /><FeeMetric icon={<IconAlertCircle size={18} />} label="Unpaid" value={unpaidStudents} color="red" /></SimpleGrid></>}
            <Stack mt={isAdmin ? 'xl' : 0} gap="md">
              <Metric icon={<IconSchool size={18} />} label="Classes running" value={String(data.classes.length)} color="blue" />
              <Metric icon={<IconUsers size={18} />} label="Current enrollments" value={String(data.enrollments.filter((enrollment) => !enrollment.end_date).length)} color="orange" />
              <Metric icon={<IconBallBasketball size={18} />} label="Active coaches" value={String(data.coaches.filter((coach) => coach.status === 'Active').length)} color="violet" />
            </Stack>
          </Paper>
        </Grid.Col>

        {isAdmin && <Grid.Col span={{ base: 12, lg: 7 }}>
          <Group justify="space-between" mb="sm"><Group gap="xs"><ThemeIcon variant="light" color="pink" radius="xl"><IconCake size={18} /></ThemeIcon><Title order={3}>Birthday babies</Title></Group><Text size="sm" c="dimmed">Within 7 days</Text></Group>
          {birthdays.length ? <SimpleGrid cols={{ base: 1, md: 2 }}>{birthdays.map(({ student, birthday, dayOffset }) => <Paper key={student.id} p="md" radius="lg" withBorder><Group wrap="nowrap"><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={52} /><Box flex={1} style={{ minWidth: 0 }}><Text fw={750} truncate>{student.name}</Text><Text size="sm" c="dimmed">{birthday.format('D MMMM')} · {birthdayAge(student, birthday)} years old</Text></Box><Badge color={dayOffset === 0 ? 'pink' : dayOffset > 0 ? 'orange' : 'gray'} variant="light">{birthdayLabel(dayOffset)}</Badge></Group></Paper>)}</SimpleGrid> : <Paper p="lg" radius="lg" withBorder><Text c="dimmed" size="sm" ta="center">No student birthdays within the past or next 7 days.</Text></Paper>}
        </Grid.Col>}
      </Grid>
    </>
  )
}

function FeeMetric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return <Box className="fee-collection-cell" ta="center"><ThemeIcon variant="light" color={color} radius="xl" mx="auto">{icon}</ThemeIcon><Text fw={850} fz="xl" mt={6}>{value}</Text><Text size="xs" c="dimmed">{label}</Text></Box>
}

function Metric({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return <Group><ThemeIcon variant="light" color={color} radius="md">{icon}</ThemeIcon><Text size="sm" flex={1}>{label}</Text><Text fw={750}>{value}</Text></Group>
}

function nearbyBirthdays(students: Student[], today: Dayjs) {
  const reference = today.startOf('day')
  return students.filter((student) => student.status !== 'Inactive' && student.date_of_birth).map((student) => {
    const dateOfBirth = dayjs(student.date_of_birth)
    const birthdays = [reference.year() - 1, reference.year(), reference.year() + 1].map((year) => birthdayInYear(dateOfBirth, year))
    const birthday = birthdays.sort((a, b) => Math.abs(a.diff(reference, 'day')) - Math.abs(b.diff(reference, 'day')))[0]
    return { student, birthday, dayOffset: birthday.diff(reference, 'day') }
  }).filter((item) => Math.abs(item.dayOffset) <= 7).sort((a, b) => Math.abs(a.dayOffset) - Math.abs(b.dayOffset) || a.dayOffset - b.dayOffset || a.student.name.localeCompare(b.student.name))
}

function birthdayInYear(dateOfBirth: Dayjs, year: number) {
  const month = dateOfBirth.month()
  const day = Math.min(dateOfBirth.date(), dayjs(new Date(year, month + 1, 0)).date())
  return dayjs(new Date(year, month, day)).startOf('day')
}

function birthdayAge(student: Student, birthday: Dayjs) {
  return birthday.year() - dayjs(student.date_of_birth).year()
}

function birthdayLabel(dayOffset: number) {
  if (dayOffset === 0) return 'Today'
  if (dayOffset === 1) return 'Tomorrow'
  if (dayOffset === -1) return 'Yesterday'
  return dayOffset > 0 ? `In ${dayOffset} days` : `${Math.abs(dayOffset)} days ago`
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
