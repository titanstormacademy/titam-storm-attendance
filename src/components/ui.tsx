import { Avatar, Box, Group, Image, Modal, Paper, Skeleton, Stack, Text, ThemeIcon, Title, type ModalProps } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { Icon } from '@tabler/icons-react'

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <Group className="page-header" justify="space-between" align="flex-start" mb="xl" wrap="wrap">
      <Box className="page-header-copy">
        <Title component="h1" order={2} tabIndex={-1}>{title}</Title>
        <Text c="dimmed" mt={4}>{description}</Text>
      </Box>
      {action && <Box className="page-header-action">{action}</Box>}
    </Group>
  )
}

export function ResponsiveModal({ centered, fullScreen, overlayProps, transitionProps, ...props }: ModalProps) {
  const isMobile = useMediaQuery('(max-width: 48em)')

  return (
    <Modal
      {...props}
      centered={isMobile ? false : (centered ?? true)}
      fullScreen={Boolean(fullScreen || isMobile)}
      overlayProps={{ backgroundOpacity: 0.55, blur: 3, ...overlayProps }}
      transitionProps={{ transition: isMobile ? 'slide-up' : 'pop', duration: 180, ...transitionProps }}
    />
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

export function PersonAvatar({ name, src, thumbnailSrc, size = 'md', onClick }: { name: string; src?: string | null; thumbnailSrc?: string | null; size?: string | number; onClick?: () => void }) {
  const optimizedSrc = thumbnailSrc || profileThumbnailUrl(src)
  return <Avatar className={onClick ? 'photo-avatar-clickable' : undefined} src={optimizedSrc || src} name={name} color="orange" radius="xl" size={size} imageProps={{ loading: 'lazy', decoding: 'async', fetchPriority: 'low', onError: src && optimizedSrc ? (event) => { event.currentTarget.onerror = null; event.currentTarget.src = src } : undefined }} onClick={onClick} role={onClick ? 'button' : undefined} aria-label={onClick ? `View photo of ${name}` : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } } : undefined} />
}

function profileThumbnailUrl(src?: string | null) {
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return null
  const queryIndex = src.indexOf('?')
  const base = queryIndex === -1 ? src : src.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : src.slice(queryIndex)
  const extensionIndex = base.lastIndexOf('.')
  const path = extensionIndex > base.lastIndexOf('/') ? base.slice(0, extensionIndex) : base
  return `${path}.thumb.webp${query}`
}

export function PhotoLightbox({ src, name, opened, onClose }: { src: string | null; name: string; opened: boolean; onClose: () => void }) {
  return <Modal className="photo-lightbox" opened={opened} onClose={onClose} title={name} size="xl" centered overlayProps={{ backgroundOpacity: 0.82, blur: 5 }}><Box className="photo-lightbox-stage">{src ? <Image src={src} alt={name} fit="contain" /> : <Avatar name={name} color="orange" size={180} radius="xl" />}</Box></Modal>
}

export function PageLoader({ label = 'Loading workspace…' }: { label?: string }) {
  return <Stack role="status" aria-live="polite"><Text c="dimmed" size="sm">{label}</Text><Skeleton height={120} radius="lg" /><Skeleton height={240} radius="lg" /><Skeleton height={180} radius="lg" /></Stack>
}
