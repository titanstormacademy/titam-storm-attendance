import dayjs, { type Dayjs } from 'dayjs'
import { Badge, Box, Grid, Group, Paper, Progress, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconBallBasketball, IconCake, IconCalendarEvent, IconCash, IconChevronRight, IconClipboardCheck, IconSchool, IconUsers } from '@tabler/icons-react'
import { EmptyState, PageHeader, PersonAvatar, StatCard } from '../components/ui'
import { publicImageUrl } from '../lib/supabase'
import type { BootstrapData, Student } from '../types/models'

export function DashboardPage({ data, branchName, isAdmin, onAttendance }: { data: BootstrapData; branchName: string; isAdmin: boolean; onAttendance: () => void }) {
  const today = dayjs()
  const todayName = today.format('dddd')
  const todayDate = today.format('YYYY-MM-DD')
  const todayClasses = data.classes.filter((academyClass) => academyClass.day_of_week === todayName)
  const currentMonthPayments = data.payments.filter((payment) => payment.fee_month.startsWith(today.format('YYYY-MM')) && payment.status !== 'Unpaid')
  const monthRevenue = currentMonthPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const activeStudents = data.students.filter((student) => student.status === 'Active')
  const paidStudents = new Set(currentMonthPayments.filter((payment) => payment.status === 'Paid').map((payment) => payment.student_id)).size
  const collectionRate = activeStudents.length ? Math.round((paidStudents / activeStudents.length) * 100) : 0
  const birthdays = isAdmin ? nearbyBirthdays(data.students, today) : []

  return (
    <>
      <PageHeader title={`Good ${greeting()}, team`} description={`${branchName} · ${today.format('dddd, D MMMM YYYY')}`} />
      <SimpleGrid className="dashboard-stats" cols={{ base: 2, lg: 4 }} spacing={{ base: 'sm', sm: 'md' }} mb="xl">
        <StatCard label="Active students" value={activeStudents.length} detail={`${data.students.filter((student) => student.status === 'Trial').length} currently on trial`} icon={IconUsers} />
        <StatCard label="Today's classes" value={todayClasses.length} detail={`${todayClasses.reduce((sum, item) => sum + new Set(data.enrollments.filter((enrollment) => enrollment.class_id === item.id && !enrollment.end_date).map((enrollment) => enrollment.student_id)).size, 0)} scheduled students`} icon={IconCalendarEvent} color="blue" />
        {isAdmin && <StatCard label="Fees this month" value={`RM ${monthRevenue.toLocaleString('en-MY', { minimumFractionDigits: 0 })}`} detail={`${paidStudents} students paid`} icon={IconCash} color="green" />}
        <StatCard label="Attendance records" value={data.sessions.filter((session) => session.session_date === todayDate).length} detail="Sessions ready today" icon={IconClipboardCheck} color="violet" />
      </SimpleGrid>

      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Group justify="space-between" mb="sm"><Title order={3}>Today’s schedule</Title><Text component="button" className="text-button" onClick={onAttendance}>Open attendance <IconChevronRight size={15} /></Text></Group>
          {todayClasses.length ? (
            <Stack gap="sm">
              {todayClasses.map((academyClass) => {
                const enrolled = new Set(data.enrollments.filter((enrollment) => enrollment.class_id === academyClass.id && !enrollment.end_date).map((enrollment) => enrollment.student_id)).size
                const session = data.sessions.find((item) => item.class_id === academyClass.id && item.session_date === todayDate)
                return (
                  <Paper key={academyClass.id} p="lg" radius="lg" withBorder className="schedule-row" onClick={onAttendance}>
                    <Group wrap="nowrap">
                      <ThemeIcon size={50} radius="md" variant="light" color="orange"><IconBallBasketball size={26} /></ThemeIcon>
                      <Box flex={1}>
                        <Group gap="xs"><Text fw={750}>{academyClass.label}</Text><Badge variant="light" color={session ? 'green' : 'gray'}>{session ? 'Ready' : 'Not started'}</Badge></Group>
                        <Text c="dimmed" size="sm" mt={4}>{formatTime(academyClass.start_time)} – {formatTime(academyClass.end_time)} · {academyClass.coach?.name || 'No coach assigned'}</Text>
                      </Box>
                      <Box ta="right"><Text fw={800} size="lg">{enrolled}</Text><Text c="dimmed" size="xs">students</Text></Box>
                    </Group>
                  </Paper>
                )
              })}
            </Stack>
          ) : <EmptyState title="No classes today" message="Enjoy the break or add a one-off session from the Classes page." icon={IconCalendarEvent} />}
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Title order={3} mb="sm">{isAdmin ? 'Monthly pulse' : 'Branch pulse'}</Title>
          <Paper p={{ base: 'lg', sm: 'xl' }} radius="lg" withBorder>
            {isAdmin && <><Text size="sm" c="dimmed" fw={600}>Fee collection progress</Text><Group align="end" gap={8} mt="xs"><Text fz={34} fw={850}>{collectionRate}%</Text><Text c="dimmed" mb={7}>paid</Text></Group><Progress value={collectionRate} size="lg" radius="xl" mt="md" color="green" /></>}
            <Stack mt={isAdmin ? 'xl' : 0} gap="md">
              <Metric icon={<IconSchool size={18} />} label="Classes running" value={String(data.classes.length)} />
              <Metric icon={<IconUsers size={18} />} label="Current enrollments" value={String(data.enrollments.filter((enrollment) => !enrollment.end_date).length)} />
              <Metric icon={<IconBallBasketball size={18} />} label="Active coaches" value={String(data.coaches.filter((coach) => coach.status === 'Active').length)} />
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>

      {isAdmin && <Box mt="xl">
        <Group justify="space-between" mb="sm"><Group gap="xs"><ThemeIcon variant="light" color="pink" radius="xl"><IconCake size={18} /></ThemeIcon><Title order={3}>Birthday babies</Title></Group><Text size="sm" c="dimmed">Within 7 days</Text></Group>
        {birthdays.length ? <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>{birthdays.map(({ student, birthday, dayOffset }) => <Paper key={student.id} p="md" radius="lg" withBorder><Group wrap="nowrap"><PersonAvatar name={student.name} src={publicImageUrl('student-photos', student.photo_path)} size={52} /><Box flex={1} style={{ minWidth: 0 }}><Text fw={750} truncate>{student.name}</Text><Text size="sm" c="dimmed">{birthday.format('D MMMM')} · {birthdayAge(student, birthday)} years old</Text></Box><Badge color={dayOffset === 0 ? 'pink' : dayOffset > 0 ? 'orange' : 'gray'} variant="light">{birthdayLabel(dayOffset)}</Badge></Group></Paper>)}</SimpleGrid> : <Paper p="lg" radius="lg" withBorder><Text c="dimmed" size="sm" ta="center">No student birthdays within the past or next 7 days.</Text></Paper>}
      </Box>}
    </>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <Group><ThemeIcon variant="light" color="gray" radius="md">{icon}</ThemeIcon><Text size="sm" flex={1}>{label}</Text><Text fw={750}>{value}</Text></Group>
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

function formatTime(value: string | null) {
  if (!value) return 'Time TBC'
  return dayjs(`2000-01-01T${value}`).format('h:mm A')
}
