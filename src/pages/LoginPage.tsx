import { useState } from 'react'
import { Alert, Anchor, Box, Button, Center, Container, Paper, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core'
import { IconAlertCircle, IconBallBasketball, IconBolt, IconChartBar, IconShieldLock } from '@tabler/icons-react'
import { useAuth } from '../contexts/useAuth'

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setSubmitting(true)
    try {
      if (mode === 'signup') {
        await signUp(email, password, fullName)
        setSuccess('Account created. Check your email to confirm the account, then sign in.')
        setMode('signin')
      } else await signIn(email, password)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to continue')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box className="login-page">
      <Container size="lg" className="login-layout">
        <Box className="login-brand-panel">
          <ThemeIcon size={60} radius={18} color="orange"><IconBallBasketball size={34} /></ThemeIcon>
          <Title order={1} mt="xl">Run your academy.<br /><span>Coach the future.</span></Title>
          <Text size="lg" c="dimmed" maw={520} mt="md">A faster, secure workspace for attendance, student progress, fee collection, and coach payouts.</Text>
          <Stack mt={38} gap="lg">
            <Feature icon={<IconBolt size={20} />} title="Fast everywhere" text="Built on Cloudflare and Supabase for instant access on desktop and mobile." />
            <Feature icon={<IconShieldLock size={20} />} title="Secure by design" text="Real user accounts, row-level security, and private payment receipts." />
            <Feature icon={<IconChartBar size={20} />} title="One source of truth" text="Live operational and financial reporting without spreadsheet bottlenecks." />
          </Stack>
        </Box>

        <Center>
          <Paper component="form" onSubmit={submit} className="login-card" p={36} radius="xl" withBorder shadow="xl">
            <Text tt="uppercase" fw={800} size="xs" c="orange">Titan Storm</Text>
            <Title order={2} mt={8}>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</Title>
            <Text c="dimmed" size="sm" mt={6}>{mode === 'signin' ? 'Sign in to manage your academy.' : 'Your administrator will assign your access.'}</Text>
            <Stack mt="xl">
              {error && <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light">{error}</Alert>}
              {success && <Alert color="green" variant="light">{success}</Alert>}
              {mode === 'signup' && <TextInput label="Full name" placeholder="Your name" value={fullName} onChange={(event) => setFullName(event.currentTarget.value)} required />}
              <TextInput label="Email" placeholder="you@example.com" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
              <PasswordInput label="Password" placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.currentTarget.value)} minLength={8} required />
              <Button type="submit" size="md" loading={submitting}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
              <Text ta="center" size="sm" c="dimmed">
                {mode === 'signin' ? 'Need an account? ' : 'Already registered? '}
                <Anchor component="button" type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}>
                  {mode === 'signin' ? 'Sign up' : 'Sign in'}
                </Anchor>
              </Text>
            </Stack>
          </Paper>
        </Center>
      </Container>
    </Box>
  )
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Box className="login-feature">
      <ThemeIcon variant="light" color="orange" radius="md" size={40}>{icon}</ThemeIcon>
      <Box><Text fw={700}>{title}</Text><Text c="dimmed" size="sm">{text}</Text></Box>
    </Box>
  )
}
