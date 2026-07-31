import { useEffect, useState } from 'react'
import { ActionIcon, Badge, Box, Button, FileInput, Grid, Group, Modal, MultiSelect, NumberInput, Paper, PasswordInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconBuilding, IconDeviceFloppy, IconEdit, IconKey, IconPhoto, IconPlus, IconTrash, IconUserShield } from '@tabler/icons-react'
import { getBranchMemberships, getHeadCoachRates, getProfiles, replaceHeadCoachRates, saveBranch, setSharedAdminPassword, updateAcademySettings, updateProfileAccess, uploadImage } from '../lib/api'
import { PageHeader } from '../components/ui'
import type { Branch, HeadCoachRate, Profile } from '../types/models'

export function SettingsPage({ branches, settings, onChanged }: {
  branches: Branch[]
  settings: { academy_name: string; logo_path: string | null; default_branch_id: number | null }
  onChanged: () => Promise<unknown>
}) {
  const [branchOpened, branchModal] = useDisclosure(false)
  const [branchForm, setBranchForm] = useState<Partial<Branch> & { name: string }>({ name: '', subtitle: '', status: 'Active' })
  const [academyName, setAcademyName] = useState(settings.academy_name)
  const [defaultBranchId, setDefaultBranchId] = useState<string | null>(settings.default_branch_id ? String(settings.default_branch_id) : null)
  const [logo, setLogo] = useState<File | null>(null)
  const [rates, setRates] = useState<HeadCoachRate[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [memberships, setMemberships] = useState<Array<{ user_id: string; branch_id: number }>>([])
  const [adminPassword, setAdminPassword] = useState('')
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([getHeadCoachRates(), getProfiles(), getBranchMemberships()]).then(([nextRates, nextProfiles, nextMemberships]) => {
      setRates(nextRates); setProfiles(nextProfiles); setMemberships(nextMemberships)
    }).catch((error) => notifications.show({ color: 'red', message: errorMessage(error) }))
  }, [])

  function editBranch(branch?: Branch) {
    setBranchForm(branch ? { ...branch } : { name: '', subtitle: '', status: 'Active' })
    branchModal.open()
  }

  async function submitBranch() {
    if (!branchForm.name.trim()) return
    setSaving(true)
    try {
      await saveBranch(branchForm)
      branchModal.close()
      notifications.show({ color: 'green', message: 'Branch saved' })
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function saveAdminPassword() {
    if (adminPassword.length < 8) { notifications.show({ color: 'red', message: 'Admin password must contain at least 8 characters' }); return }
    if (adminPassword !== confirmAdminPassword) { notifications.show({ color: 'red', message: 'Admin passwords do not match' }); return }
    setSaving(true)
    try {
      await setSharedAdminPassword(adminPassword)
      setAdminPassword('')
      setConfirmAdminPassword('')
      notifications.show({ color: 'green', message: 'Shared admin password updated' })
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function saveBrand() {
    setSaving(true)
    try {
      const logoPath = logo ? await uploadImage('academy-assets', settings.default_branch_id || branches[0]?.id || 1, logo) : settings.logo_path
      await updateAcademySettings({ academy_name: academyName, logo_path: logoPath || undefined, default_branch_id: defaultBranchId ? Number(defaultBranchId) : undefined })
      notifications.show({ color: 'green', message: 'Academy branding updated' })
      await onChanged()
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function saveRates() {
    setSaving(true)
    try {
      await replaceHeadCoachRates(rates.map(({ id: _id, ...rate }) => rate))
      setRates(await getHeadCoachRates())
      notifications.show({ color: 'green', message: 'Head coach rates updated' })
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  async function saveUser(profile: Profile) {
    setSaving(true)
    try {
      await updateProfileAccess(profile.id, profile.role, memberships.filter((item) => item.user_id === profile.id).map((item) => item.branch_id))
      notifications.show({ color: 'green', message: `${profile.full_name}'s access updated` })
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  function setUserBranches(userId: string, values: string[]) {
    setMemberships((current) => [...current.filter((item) => item.user_id !== userId), ...values.map((value) => ({ user_id: userId, branch_id: Number(value) }))])
  }

  return (
    <>
      <PageHeader title="Settings" description="Academy branding, locations, team access, and commission rules" />
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack>
            <Paper p={{ base: 'md', sm: 'xl' }} radius="lg" withBorder>
              <Group mb="lg"><IconPhoto size={22} /><Title order={4}>Academy branding</Title></Group>
              <Stack><TextInput label="Academy name" value={academyName} onChange={(event) => setAcademyName(event.currentTarget.value)} /><Select label="Default branch" value={defaultBranchId} onChange={setDefaultBranchId} data={branches.filter((branch) => branch.status === 'Active').map((branch) => ({ value: String(branch.id), label: branch.name }))} /><FileInput label="Logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" value={logo} onChange={setLogo} clearable /><Button leftSection={<IconDeviceFloppy size={17} />} onClick={saveBrand} loading={saving}>Save branding</Button></Stack>
            </Paper>
            <Paper p={{ base: 'md', sm: 'xl' }} radius="lg" withBorder>
              <Group mb="xs"><IconKey size={22} /><Title order={4}>Shared admin password</Title></Group>
              <Text c="dimmed" size="sm" mb="lg">Administrators enter this password with their name. It is securely hashed and cannot be viewed after saving.</Text>
              <Stack><PasswordInput label="New admin password" value={adminPassword} onChange={(event) => setAdminPassword(event.currentTarget.value)} minLength={8} autoComplete="new-password" /><PasswordInput label="Confirm password" value={confirmAdminPassword} onChange={(event) => setConfirmAdminPassword(event.currentTarget.value)} minLength={8} autoComplete="new-password" /><Button leftSection={<IconDeviceFloppy size={17} />} onClick={saveAdminPassword} loading={saving} disabled={!adminPassword || !confirmAdminPassword}>Save admin password</Button></Stack>
            </Paper>
            <Paper p={{ base: 'md', sm: 'xl' }} radius="lg" withBorder>
              <Group justify="space-between" mb="lg"><Group><IconBuilding size={22} /><Title order={4}>Branches</Title></Group><Button size="xs" variant="light" leftSection={<IconPlus size={15} />} onClick={() => editBranch()}>Add</Button></Group>
              <Stack gap="sm">{branches.map((branch) => <Paper key={branch.id} p="md" radius="md" withBorder><Group justify="space-between" wrap="nowrap"><Box style={{ minWidth: 0 }}><Text fw={700} truncate>{branch.name}</Text><Text size="sm" c="dimmed" truncate>{branch.subtitle || 'No location subtitle'}</Text></Box><Group gap={4} wrap="nowrap"><Badge color={branch.status === 'Active' ? 'green' : 'gray'} variant="light">{branch.status}</Badge><ActionIcon aria-label={`Edit ${branch.name}`} size={44} variant="subtle" onClick={() => editBranch(branch)}><IconEdit size={16} /></ActionIcon></Group></Group></Paper>)}</Stack>
            </Paper>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack>
            <Paper p={{ base: 'md', sm: 'xl' }} radius="lg" withBorder>
              <Group mb="xs"><IconUserShield size={22} /><Title order={4}>Team access</Title></Group>
              <Text c="dimmed" size="sm" mb="lg">Emergency email accounts are managed here. Name-only basic users automatically receive limited attendance access to active branches.</Text>
              <Stack>{profiles.map((profile) => <Paper key={profile.id} p="md" radius="md" withBorder><Grid align="end"><Grid.Col span={{ base: 12, md: 4 }}><Text fw={700}>{profile.full_name || 'Unnamed user'}</Text><Text size="xs" c="dimmed">{profile.id.slice(0, 8)}…</Text></Grid.Col><Grid.Col span={{ base: 12, sm: 4, md: 3 }}><Select label="Role" value={profile.role} onChange={(value) => setProfiles((current) => current.map((item) => item.id === profile.id ? { ...item, role: value as Profile['role'] } : item))} data={[{ value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admin' }]} /></Grid.Col><Grid.Col span={{ base: 12, sm: 8, md: 4 }}><MultiSelect label="Branches" disabled={profile.role === 'admin'} value={memberships.filter((item) => item.user_id === profile.id).map((item) => String(item.branch_id))} onChange={(values) => setUserBranches(profile.id, values)} data={branches.filter((branch) => branch.status === 'Active').map((branch) => ({ value: String(branch.id), label: branch.name }))} /></Grid.Col><Grid.Col span={{ base: 12, md: 1 }}><Button fullWidth variant="light" onClick={() => saveUser(profile)} loading={saving} leftSection={<IconDeviceFloppy size={17} />}>Save</Button></Grid.Col></Grid></Paper>)}</Stack>
            </Paper>
            <Paper p={{ base: 'md', sm: 'xl' }} radius="lg" withBorder>
              <Group justify="space-between" mb="xs"><Title order={4}>Head coach rate table</Title><Button size="xs" variant="light" leftSection={<IconPlus size={15} />} onClick={() => setRates([...rates, { id: -Date.now(), min_students: 1, max_students: 49, min_fee: 0, max_fee: 99999, payout: 0 }])}>Add row</Button></Group>
              <Text c="dimmed" size="sm" mb="lg">Payout per Paid student-month, matched by distinct unsettled student count and each student’s monthly fee.</Text>
              <Stack hiddenFrom="md">{rates.map((rate, index) => <Paper key={rate.id} p="md" radius="md" withBorder><Grid><Grid.Col span={6}><NumberInput label="Students from" value={rate.min_students} min={0} onChange={(value) => updateRate(index, 'min_students', value, rates, setRates)} /></Grid.Col><Grid.Col span={6}><NumberInput label="Students to" value={rate.max_students} min={0} onChange={(value) => updateRate(index, 'max_students', value, rates, setRates)} /></Grid.Col><Grid.Col span={6}><NumberInput label="Fee from" prefix="RM " value={rate.min_fee} min={0} onChange={(value) => updateRate(index, 'min_fee', value, rates, setRates)} /></Grid.Col><Grid.Col span={6}><NumberInput label="Fee to" prefix="RM " value={rate.max_fee} min={0} onChange={(value) => updateRate(index, 'max_fee', value, rates, setRates)} /></Grid.Col><Grid.Col span={10}><NumberInput label="Payout" prefix="RM " value={rate.payout} min={0} onChange={(value) => updateRate(index, 'payout', value, rates, setRates)} /></Grid.Col><Grid.Col span={2} style={{ display: 'flex', alignItems: 'end' }}><ActionIcon aria-label="Delete rate row" size={44} color="red" variant="light" onClick={() => setRates(rates.filter((_, rowIndex) => rowIndex !== index))}><IconTrash size={16} /></ActionIcon></Grid.Col></Grid></Paper>)}</Stack>
              <Box visibleFrom="md"><Table.ScrollContainer minWidth={620}><Table><Table.Thead><Table.Tr><Table.Th>Students from</Table.Th><Table.Th>Students to</Table.Th><Table.Th>Fee from</Table.Th><Table.Th>Fee to</Table.Th><Table.Th>Payout</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{rates.map((rate, index) => <Table.Tr key={rate.id}><Table.Td><NumberInput hideControls value={rate.min_students} min={0} onChange={(value) => updateRate(index, 'min_students', value, rates, setRates)} /></Table.Td><Table.Td><NumberInput hideControls value={rate.max_students} min={0} onChange={(value) => updateRate(index, 'max_students', value, rates, setRates)} /></Table.Td><Table.Td><NumberInput hideControls prefix="RM " value={rate.min_fee} min={0} onChange={(value) => updateRate(index, 'min_fee', value, rates, setRates)} /></Table.Td><Table.Td><NumberInput hideControls prefix="RM " value={rate.max_fee} min={0} onChange={(value) => updateRate(index, 'max_fee', value, rates, setRates)} /></Table.Td><Table.Td><NumberInput hideControls prefix="RM " value={rate.payout} min={0} onChange={(value) => updateRate(index, 'payout', value, rates, setRates)} /></Table.Td><Table.Td><ActionIcon aria-label="Delete rate row" color="red" variant="subtle" onClick={() => setRates(rates.filter((_, rowIndex) => rowIndex !== index))}><IconTrash size={16} /></ActionIcon></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></Box>
              <Button fullWidth mt="lg" onClick={saveRates} loading={saving}>Save rate table</Button>
            </Paper>
          </Stack>
        </Grid.Col>
      </Grid>

      <Modal opened={branchOpened} onClose={branchModal.close} title={branchForm.id ? 'Edit branch' : 'Add branch'} centered>
        <Stack><TextInput label="Branch name" value={branchForm.name} onChange={(event) => setBranchForm({ ...branchForm, name: event.currentTarget.value })} required /><TextInput label="Subtitle / location" value={branchForm.subtitle || ''} onChange={(event) => setBranchForm({ ...branchForm, subtitle: event.currentTarget.value })} /><Select label="Status" value={branchForm.status} onChange={(value) => setBranchForm({ ...branchForm, status: value as Branch['status'] })} data={['Active', 'Inactive']} /><Group justify="flex-end"><Button variant="default" onClick={branchModal.close}>Cancel</Button><Button onClick={submitBranch} loading={saving}>Save branch</Button></Group></Stack>
      </Modal>
    </>
  )
}

function updateRate(index: number, field: keyof Omit<HeadCoachRate, 'id'>, value: string | number, rates: HeadCoachRate[], setRates: (rates: HeadCoachRate[]) => void) {
  setRates(rates.map((rate, rowIndex) => rowIndex === index ? { ...rate, [field]: Number(value) } : rate))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong'
}
