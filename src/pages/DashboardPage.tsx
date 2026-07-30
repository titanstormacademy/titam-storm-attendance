import dayjs from 'dayjs'
import { Badge, Box, Grid, Group, Paper, Progress, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconBallBasketball, IconCalendarEvent, IconCash, IconChevronRight, IconClipboardCheck, IconSchool, IconUsers } from '@tabler/icons-react'
import { EmptyState, PageHeader, StatCard } from '../components/ui'
import type { BootstrapData } from '../types/models'

export function DashboardPage({ data, branchName, onAttendance }: { data: BootstrapData; branchName: string; onAttendance: () => void }) {
  const today = dayjs()
  const todayName = today.format('dddd')
  const todayDate = today.format('YYYY-MM-DD')
  const todayClasses = data.classes.filter((academyClass) => academyClass.day_of_week === todayName)
  const currentMonthPayments = data.payments.filter((payment) => payment.fee_month.startsWith(today.format('YYYY-MM')) && payment.status !== 'Unpaid')
  const monthRevenue = currentMonthPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
  const activeStudents = data.students.filter((student) => student.status === 'Active')
  const paidStudents = new Set(currentMonthPayments.filter((payment) => payment.status === 'Paid').map((payment) => payment.student_id)).size
  const collectionRate = activeStudents.length ? Math.round((paidStudents / activeStudents.length) * 100) : 0

  return (
    <>
      <PageHeader title={`Good ${greeting()}, team`} description={`${branchName} · ${today.format('dddd, D MMMM YYYY')}`} />
      <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} mb="xl">
        <StatCard label="Active students" value={activeStudents.length} detail={`${data.students.filter((student) => student.status === 'Trial').length} currently on trial`} icon={IconUsers} />
        <StatCard label="Today's classes" value={todayClasses.length} detail={`${todayClasses.reduce((sum, item) => sum + data.enrollments.filter((enrollment) => enrollment.class_id === item.id).length, 0)} scheduled students`} icon={IconCalendarEvent} color="blue" />
        <StatCard label="Fees this month" value={`RM ${monthRevenue.toLocaleString('en-MY', { minimumFractionDigits: 0 })}`} detail={`${paidStudents} students paid`} icon={IconCash} color="green" />
        <StatCard label="Attendance records" value={data.sessions.filter((session) => session.session_date === todayDate).length} detail="Sessions ready today" icon={IconClipboardCheck} color="violet" />
      </SimpleGrid>

      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Group justify="space-between" mb="sm"><Title order={3}>Today’s schedule</Title><Text component="button" className="text-button" onClick={onAttendance}>Open attendance <IconChevronRight size={15} /></Text></Group>
          {todayClasses.length ? (
            <Stack gap="sm">
              {todayClasses.map((academyClass) => {
                const enrolled = data.enrollments.filter((enrollment) => enrollment.class_id === academyClass.id).length
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
          <Title order={3} mb="sm">Monthly pulse</Title>
          <Paper p="xl" radius="lg" withBorder>
            <Text size="sm" c="dimmed" fw={600}>Fee collection progress</Text>
            <Group align="end" gap={8} mt="xs"><Text fz={34} fw={850}>{collectionRate}%</Text><Text c="dimmed" mb={7}>paid</Text></Group>
            <Progress value={collectionRate} size="lg" radius="xl" mt="md" color="green" />
            <Stack mt="xl" gap="md">
              <Metric icon={<IconSchool size={18} />} label="Classes running" value={String(data.classes.length)} />
              <Metric icon={<IconUsers size={18} />} label="Total enrollments" value={String(data.enrollments.length)} />
              <Metric icon={<IconBallBasketball size={18} />} label="Active coaches" value={String(data.coaches.filter((coach) => coach.status === 'Active').length)} />
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>
    </>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <Group><ThemeIcon variant="light" color="gray" radius="md">{icon}</ThemeIcon><Text size="sm" flex={1}>{label}</Text><Text fw={750}>{value}</Text></Group>
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
