import { useState } from 'react'
import { ActionIcon, Alert, Anchor, Box, Button, Collapse, Divider, Image, Paper, PasswordInput, Stack, Text, TextInput, useComputedColorScheme, useMantineColorScheme } from '@mantine/core'
import { IconAlertCircle, IconKey, IconMoon, IconSun } from '@tabler/icons-react'
import { useAuth } from '../contexts/useAuth'

export function LoginPage() {
  const { signInWithName, signIn } = useAuth()
  const { setColorScheme } = useMantineColorScheme()
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true })
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

  async function emergencySignIn(event?: React.FormEvent) {
    event?.preventDefault()
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

  return <Box className="login-page login-kiosk-page">
    <ActionIcon className="login-theme-toggle" aria-label={colorScheme === 'dark' ? 'Use light mode' : 'Use dark mode'} variant="subtle" color="gray" size={44} radius="xl" onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}>{colorScheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}</ActionIcon>
    <Box className="login-kiosk-shell">
      <Box className="login-kiosk-brand">
        <Text component="h1" className="login-kiosk-name"><span>Titan</span><strong>Storm</strong></Text>
        <Text className="login-kiosk-tagline">Basketball Academy</Text>
      </Box>

      <Paper className="login-kiosk-card" radius="lg" shadow="xl">
        <Box className="login-crest-badge"><Image src="/titan-storm-logo.png" alt="Titan Storm Basketball Academy" fit="contain" /></Box>
        <Box component="form" onSubmit={enter}>
          <Stack gap="md">
            {error && <Alert icon={<IconAlertCircle size={18} />} color="red" variant="light">{error}</Alert>}
            <TextInput className="login-kiosk-input" label="Your name" placeholder="Enter your name" value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="name" required />
            <PasswordInput className="login-kiosk-input" label={<span>Password <small>(admin only)</small></span>} placeholder="Leave blank for basic access" value={adminPassword} onChange={(event) => setAdminPassword(event.currentTarget.value)} autoComplete="current-password" />
            <Button className="login-enter-button" type="submit" size="md" loading={submitting}>Enter</Button>
            <Text className="login-access-hint" ta="center">Leave password blank for attendance-only access.</Text>
          </Stack>
        </Box>

        <Divider my="lg" label="Administrator recovery" />
        <Anchor className="login-recovery-link" component="button" type="button" size="sm" aria-expanded={emergencyOpen} aria-controls="emergency-login" onClick={() => setEmergencyOpen((current) => !current)}><IconKey size={14} />{emergencyOpen ? 'Hide emergency account login' : 'Use emergency account login'}</Anchor>
        <Collapse id="emergency-login" in={emergencyOpen}><Box component="form" onSubmit={emergencySignIn}><Stack mt="md"><Text size="xs" c="dimmed">Use the original administrator account if the shared password has not been configured or was forgotten.</Text><TextInput label="Administrator email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} autoComplete="email" required /><PasswordInput label="Account password" value={emailPassword} onChange={(event) => setEmailPassword(event.currentTarget.value)} autoComplete="current-password" required /><Button type="submit" variant="light" loading={submitting} disabled={!email || !emailPassword}>Emergency sign in</Button></Stack></Box></Collapse>
      </Paper>
    </Box>
  </Box>
}
