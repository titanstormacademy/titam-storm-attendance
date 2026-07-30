import { Avatar, Box, Group, Paper, Skeleton, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import type { Icon } from '@tabler/icons-react'

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="xl" wrap="wrap">
      <Box>
        <Title order={2}>{title}</Title>
        <Text c="dimmed" mt={4}>{description}</Text>
      </Box>
      {action}
    </Group>
  )
}

export function StatCard({ label, value, detail, icon: StatIcon, color = 'orange' }: {
  label: string
  value: string | number
  detail: string
  icon: Icon
  color?: string
}) {
  return (
    <Paper className="stat-card" p="lg" radius="lg" withBorder>
      <Group justify="space-between" align="flex-start">
        <Box>
          <Text size="sm" c="dimmed" fw={600}>{label}</Text>
          <Text className="stat-value" fw={800}>{value}</Text>
          <Text size="xs" c="dimmed">{detail}</Text>
        </Box>
        <ThemeIcon size={44} radius="md" variant="light" color={color}><StatIcon size={23} /></ThemeIcon>
      </Group>
    </Paper>
  )
}

export function EmptyState({ title, message, icon: EmptyIcon }: { title: string; message: string; icon: Icon }) {
  return (
    <Paper p={48} radius="lg" withBorder ta="center">
      <ThemeIcon variant="light" size={58} radius="xl" color="gray" mx="auto"><EmptyIcon size={28} /></ThemeIcon>
      <Text fw={700} mt="md">{title}</Text>
      <Text c="dimmed" size="sm" maw={420} mx="auto" mt={4}>{message}</Text>
    </Paper>
  )
}

export function PersonAvatar({ name, src, size = 'md' }: { name: string; src?: string | null; size?: string | number }) {
  return <Avatar src={src} name={name} color="orange" radius="xl" size={size} />
}

export function PageLoader() {
  return <Stack><Skeleton height={120} radius="lg" /><Skeleton height={240} radius="lg" /><Skeleton height={180} radius="lg" /></Stack>
}
