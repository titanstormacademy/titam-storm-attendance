import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Alert, AppShell, Avatar, Box, Button, Center, Group, Image, Menu, NavLink, Paper, Select, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { IconAlertCircle, IconBallBasketball, IconBuilding, IconCalendarEvent, IconCash, IconChartBar, IconChevronDown, IconClipboardCheck, IconLogout, IconMenu2, IconSchool, IconSettings, IconUsers, type Icon } from '@tabler/icons-react'
import { useAuth } from './contexts/useAuth'
import { getAcademySettings, getBootstrapData, getBranches } from './lib/api'
import { isSupabaseConfigured, publicImageUrl } from './lib/supabase'
import { PageLoader } from './components/ui'
import { LoginPage } from './pages/LoginPage'
import type { BootstrapData } from './types/models'

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const AttendancePage = lazy(() => import('./pages/AttendancePage').then((module) => ({ default: module.AttendancePage })))
const StudentsPage = lazy(() => import('./pages/StudentsPage').then((module) => ({ default: module.StudentsPage })))
const ClassesPage = lazy(() => import('./pages/ClassesPage').then((module) => ({ default: module.ClassesPage })))
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then((module) => ({ default: module.PaymentsPage })))
const CoachesPage = lazy(() => import('./pages/CoachesPage').then((module) => ({ default: module.CoachesPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

export type PageKey = 'dashboard' | 'attendance' | 'students' | 'classes' | 'payments' | 'coaches' | 'reports' | 'settings'

interface NavItem {
  key: PageKey
  label: string
  icon: Icon
  admin?: boolean
}

const navigation: NavItem[] = [
  { key: 'dashboard', label: 'Overview', icon: IconChartBar },
  { key: 'attendance', label: 'Attendance', icon: IconClipboardCheck },
  { key: 'students', label: 'Students', icon: IconUsers },
  { key: 'classes', label: 'Classes & sessions', icon: IconCalendarEvent, admin: true },
  { key: 'payments', label: 'Payments', icon: IconCash, admin: true },
  { key: 'coaches', label: 'Coaches', icon: IconSchool, admin: true },
  { key: 'reports', label: 'Reports', icon: IconChartBar, admin: true },
  { key: 'settings', label: 'Settings', icon: IconSettings, admin: true },
]

export default function App() {
  const { user, profile, loading: authLoading, signOut } = useAuth()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [studentCreateRequest, setStudentCreateRequest] = useState(0)
  const [navbarOpened, navbar] = useDisclosure(false)
  const [branchId, setBranchId] = useState<number | null>(() => {
    const stored = localStorage.getItem('titan-storm-branch')
    return stored ? Number(stored) : null
  })
  const isAdmin = profile?.role === 'admin'

  const branchesQuery = useQuery({ queryKey: ['branches', user?.id], queryFn: getBranches, enabled: Boolean(user) })
  const settingsQuery = useQuery({ queryKey: ['academy-settings'], queryFn: getAcademySettings, enabled: Boolean(user) })
  const branches = branchesQuery.data || []
  const activeBranches = branches.filter((branch) => branch.status === 'Active')

  useEffect(() => {
    if (!activeBranches.length) return
    const selectedExists = activeBranches.some((branch) => branch.id === branchId)
    if (!selectedExists) {
      const nextId = activeBranches.find((branch) => branch.id === settingsQuery.data?.default_branch_id)?.id || activeBranches[0].id
      setBranchId(nextId)
      localStorage.setItem('titan-storm-branch', String(nextId))
    }
  }, [activeBranches, branchId, settingsQuery.data?.default_branch_id])

  const dataQuery = useQuery({
    queryKey: ['bootstrap', branchId, isAdmin],
    queryFn: () => getBootstrapData(branchId!, Boolean(isAdmin)),
    enabled: Boolean(user && profile && branchId),
  })

  const visibleNavigation = useMemo(() => navigation.filter((item) => !item.admin || isAdmin), [isAdmin])
  const activeBranch = branches.find((branch) => branch.id === branchId)

  async function refreshAll() {
    await Promise.all([dataQuery.refetch(), branchesQuery.refetch(), settingsQuery.refetch()])
  }

  function navigate(nextPage: PageKey) {
    setPage(nextPage)
    navbar.close()
  }

  function registerStudentFromAttendance() {
    setStudentCreateRequest((current) => current + 1)
    setPage('students')
    navbar.close()
  }

  if (!isSupabaseConfigured) return <ConfigurationRequired />
  if (authLoading) return <Center h="100vh"><Stack align="center"><ThemeIcon size={64} radius={20}><IconBallBasketball size={36} /></ThemeIcon><Text fw={700}>Loading Titan Storm…</Text></Stack></Center>
  if (!user) return <LoginPage />
  if (!profile) return <Center h="100vh"><Alert color="red" icon={<IconAlertCircle size={18} />}>Your user profile could not be loaded. Ask an administrator to verify the database migration.</Alert></Center>
  if (!branchesQuery.isLoading && !activeBranches.length) return <Center h="100vh"><Paper p="xl" radius="lg" withBorder ta="center"><IconBuilding size={36} /><Title order={3} mt="md">No branch access yet</Title><Text c="dimmed" maw={420} mt="xs">Your account is ready, but an administrator must assign you to at least one branch.</Text><Button mt="lg" variant="light" onClick={signOut}>Sign out</Button></Paper></Center>

  const logoUrl = publicImageUrl('academy-assets', settingsQuery.data?.logo_path || null)
  const primaryNavigation = visibleNavigation.slice(0, 3)
  const isMoreActive = navbarOpened || !primaryNavigation.some((item) => item.key === page)

  return (
    <AppShell
      header={{ height: { base: 60, sm: 72 } }}
      navbar={{ width: 270, breakpoint: 'sm', collapsed: { mobile: !navbarOpened } }}
      padding="xl"
    >
      <AppShell.Header className="app-header">
        <Group className="app-header-inner" h="100%" px={{ base: 'xs', sm: 'xl' }} justify="space-between" wrap="nowrap">
          <Group className="app-brand" gap="sm" wrap="nowrap">
            {logoUrl ? <Image className="app-logo" src={logoUrl} alt="" w={{ base: 36, sm: 42 }} h={{ base: 36, sm: 42 }} radius="md" fit="contain" /> : <ThemeIcon className="app-logo" size={42} radius="md" color="orange"><IconBallBasketball size={24} /></ThemeIcon>}
            <Text className="mobile-brand-name" hiddenFrom="sm" fw={850} c="white">Titan Storm</Text>
            <Box visibleFrom="sm"><Text className="desktop-brand-name" fw={850} lh={1.1}>{settingsQuery.data?.academy_name || 'Titan Storm'}</Text><Text className="desktop-brand-subtitle" size="xs">Academy operations</Text></Box>
          </Group>
          <Group className="app-header-actions" gap="md" wrap="nowrap">
            <Select className="branch-select" aria-label="Active branch" leftSection={<IconBuilding size={16} />} value={branchId ? String(branchId) : null} onChange={(value) => { if (value) { setBranchId(Number(value)); localStorage.setItem('titan-storm-branch', value); setPage('dashboard') } }} data={activeBranches.map((branch) => ({ value: String(branch.id), label: branch.name }))} w={{ base: 148, sm: 210 }} allowDeselect={false} />
            <Menu position="bottom-end" shadow="lg">
              <Menu.Target>
                <Button className="profile-menu-trigger" aria-label={`Open account menu for ${profile.full_name}`} variant="subtle" color="dark" px="xs" rightSection={<Box visibleFrom="sm"><IconChevronDown size={14} /></Box>}>
                  <Group gap="xs" wrap="nowrap"><Avatar name={profile.full_name} color="orange" size={32} /><Box visibleFrom="sm" ta="left"><Text size="sm" fw={700} lh={1}>{profile.full_name}</Text><Text size="xs" c="dimmed" mt={4}>{isAdmin ? 'Administrator' : 'Staff'}</Text></Box></Group>
                </Button>
              </Menu.Target>
              <Menu.Dropdown><Menu.Label>Account</Menu.Label><Menu.Item leftSection={<IconLogout size={16} />} color="red" onClick={signOut}>Sign out</Menu.Item></Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar id="full-navigation" p="md" className="app-navbar" aria-label="Full navigation">
        <Stack h="100%">
          <Box flex={1}>
            <Text size="xs" tt="uppercase" fw={800} c="dimmed" px="sm" mb="xs">Workspace</Text>
            {visibleNavigation.map((item) => <NavLink key={item.key} label={item.label} leftSection={<item.icon size={19} stroke={1.8} />} active={page === item.key} aria-current={page === item.key ? 'page' : undefined} onClick={() => navigate(item.key)} variant="filled" className="nav-link" />)}
          </Box>
          <Paper p="md" radius="lg" className="branch-card">
            <Group wrap="nowrap"><ThemeIcon variant="light" color="orange"><IconBuilding size={18} /></ThemeIcon><Box style={{ minWidth: 0 }}><Text size="sm" fw={700} truncate>{activeBranch?.name}</Text><Text size="xs" c="dimmed" truncate>{activeBranch?.subtitle || 'Active branch'}</Text></Box></Group>
          </Paper>
        </Stack>
      </AppShell.Navbar>

      {navbarOpened && <Box component="button" type="button" className="mobile-nav-overlay" aria-label="Close full navigation" onClick={navbar.close} hiddenFrom="sm" />}

      <AppShell.Main className="app-main">
        <Box maw={1500} mx="auto">
          {dataQuery.isLoading || !dataQuery.data ? <PageLoader /> : <Suspense fallback={<PageLoader />}><Box key={`${page}-${branchId}`} className="page-transition">{renderPage(page, {
            branchId: branchId!, branchName: activeBranch?.name || '', data: dataQuery.data, isAdmin: Boolean(isAdmin),
            onChanged: async () => { await dataQuery.refetch() }, refreshAll,
            navigate, registerStudentFromAttendance, studentCreateRequest, onStudentCreateHandled: () => setStudentCreateRequest(0), branches, settings: settingsQuery.data || { academy_name: 'Titan Storm', logo_path: null, default_branch_id: branchId },
          })}</Box></Suspense>}
        </Box>
      </AppShell.Main>

      <Box component="nav" className="mobile-nav" aria-label="Primary navigation" hiddenFrom="sm">
        {primaryNavigation.map((item) => <button type="button" key={item.key} className={page === item.key ? 'active' : ''} aria-current={page === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}><item.icon size={21} aria-hidden="true" /><span>{item.label.split(' ')[0]}</span></button>)}
        <button type="button" className={isMoreActive ? 'active' : ''} aria-expanded={navbarOpened} aria-controls="full-navigation" onClick={navbar.toggle}><IconMenu2 size={21} aria-hidden="true" /><span>More</span></button>
      </Box>
    </AppShell>
  )
}

interface PageProps {
  branchId: number
  branchName: string
  data: BootstrapData
  isAdmin: boolean
  onChanged: () => Promise<unknown>
  refreshAll: () => Promise<void>
  navigate: (page: PageKey) => void
  registerStudentFromAttendance: () => void
  studentCreateRequest: number
  onStudentCreateHandled: () => void
  branches: Awaited<ReturnType<typeof getBranches>>
  settings: Awaited<ReturnType<typeof getAcademySettings>>
}

function renderPage(page: PageKey, props: PageProps) {
  switch (page) {
    case 'attendance': return <AttendancePage branchId={props.branchId} data={props.data} isAdmin={props.isAdmin} onRegisterStudent={props.registerStudentFromAttendance} />
    case 'students': return <StudentsPage branchId={props.branchId} data={props.data} isAdmin={props.isAdmin} createRequest={props.studentCreateRequest} onCreateHandled={props.onStudentCreateHandled} onChanged={props.onChanged} />
    case 'classes': return <ClassesPage branchId={props.branchId} data={props.data} onChanged={props.onChanged} />
    case 'payments': return <PaymentsPage branchId={props.branchId} data={props.data} onChanged={props.onChanged} />
    case 'coaches': return <CoachesPage branchId={props.branchId} data={props.data} onChanged={props.onChanged} />
    case 'reports': return <ReportsPage branchId={props.branchId} data={props.data} />
    case 'settings': return <SettingsPage branches={props.branches} settings={props.settings} onChanged={props.refreshAll} />
    default: return <DashboardPage data={props.data} branchName={props.branchName} isAdmin={props.isAdmin} onAttendance={() => props.navigate('attendance')} />
  }
}

function ConfigurationRequired() {
  return <Center h="100vh" p="xl"><Paper p={36} radius="xl" withBorder maw={620}><ThemeIcon size={56} radius="lg" color="orange"><IconBallBasketball size={31} /></ThemeIcon><Title order={2} mt="xl">Connect Supabase to continue</Title><Text c="dimmed" mt="sm">Create <Text span ff="monospace">titan-storm-web/.env.local</Text> and add your project URL and publishable key.</Text><Alert mt="xl" icon={<IconAlertCircle size={18} />} color="orange"><Text ff="monospace" size="sm">VITE_SUPABASE_URL=https://your-project.supabase.co<br />VITE_SUPABASE_ANON_KEY=your-publishable-key</Text></Alert></Paper></Center>
}
