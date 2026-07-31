import { useState } from 'react'
import { Alert, Anchor, Box, Button, Center, Collapse, Container, Divider, Paper, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { IconAlertCircle, IconBallBasketball, IconBolt, IconChartBar, IconKey, IconShieldLock } from '@tabler/icons-react'
import { useAuth } from '../contexts/useAuth'

export function LoginPage() {
  const { signInWithName, signIn } = useAuth()
  const [name, setName] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [emergencyOpen, setEmergencyOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function enter(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (!name.trim()) { setError('Enter your name'); return }
    setSubmitting(true)
    try {
      await signInWithName(name.trim(), adminPassword || undefined)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to enter the academy workspace')
    } finally {
      setSubmitting(false)
    }
  }

  async function emergencySignIn() {
    setError('')
    setSubmitting(true)
    try {
      await signIn(email, emailPassword)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Emergency account login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return <Box className="login-page">
    <Container size="lg" className="login-layout">
      <Box className="login-brand-panel">
        <ThemeIcon size={60} radius={18} color="orange"><IconBallBasketball size={34} /></ThemeIcon>
        <Title order={1} mt="xl">Run your academy.<br /><span>Coach the future.</span></Title>
        <Text size="lg" c="dimmed" maw={520} mt="md">A fast workspace for attendance, student administration, fee collection, and coach payouts.</Text>
        <Stack mt={38} gap="lg">
          <Feature icon={<IconBolt size={20} />} title="Fast everywhere" text="Built for quick courtside attendance on desktop and mobile." />
          <Feature icon={<IconShieldLock size={20} />} title="Permission controlled" text="Basic attendance access is separated from administrator and financial access." />
          <Feature icon={<IconChartBar size={20} />} title="One source of truth" text="Live operational and financial reporting without spreadsheet bottlenecks." />
        </Stack>
      </Box>

      <Center>
        <Paper className="login-card" p={36} radius="xl" withBorder shadow="xl">
          <Text tt="uppercase" fw={800} size="xs" c="orange">Titan Storm</Text>
          <Title order={2} mt={8}>Welcome</Title>
          <Text c="dimmed" size="sm" mt={6}>Enter your name for attendance access. Administrators also enter the shared password.</Text>
          <Box component="form" onSubmit={enter} mt="xl">
            <Stack>
              {error && <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light">{error}</Alert>}
              <TextInput label="Your name" placeholder="Enter your name" value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="name" required />
              <PasswordInput label="Admin password" description="Leave blank for basic attendance access" placeholder="Optional for administrators" value={adminPassword} onChange={(event) => setAdminPassword(event.currentTarget.value)} autoComplete="current-password" />
              <Button type="submit" size="md" loading={submitting}>{adminPassword ? 'Enter as administrator' : 'Enter attendance'}</Button>
            </Stack>
          </Box>

          <Divider my="lg" label="Administrator recovery" />
          <Anchor component="button" type="button" size="sm" onClick={() => setEmergencyOpen((current) => !current)}><IconKey size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{emergencyOpen ? 'Hide emergency account login' : 'Use emergency account login'}</Anchor>
          <Collapse in={emergencyOpen}><Stack mt="md"><Text size="xs" c="dimmed">Use the original Supabase administrator account if the shared password has not been configured or was forgotten.</Text><TextInput label="Administrator email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} autoComplete="email" /><PasswordInput label="Account password" value={emailPassword} onChange={(event) => setEmailPassword(event.currentTarget.value)} autoComplete="current-password" /><Button variant="light" onClick={emergencySignIn} loading={submitting} disabled={!email || !emailPassword}>Emergency sign in</Button></Stack></Collapse>
        </Paper>
      </Center>
    </Container>
  </Box>
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <Box className="login-feature"><ThemeIcon variant="light" color="orange" radius="md" size={40}>{icon}</ThemeIcon><Box><Text fw={700}>{title}</Text><Text c="dimmed" size="sm">{text}</Text></Box></Box>
}
