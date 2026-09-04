import { expect, test, type Page, type Route } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: true })}.signature`
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })
}

async function mockBackend(page: Page) {
  let adminLogin = false
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (url.pathname === '/auth/v1/signup') {
      const accessToken = token()
      return json(route, {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'e2e-refresh-token',
        user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: { full_name: 'E2E Staff' }, created_at: new Date().toISOString() },
      })
    }
    if (url.pathname === '/rest/v1/rpc/login_as_basic') return json(route, { id: userId, full_name: 'E2E Staff', role: 'staff' })
    if (url.pathname === '/rest/v1/rpc/login_with_shared_admin_password') { adminLogin = true; return json(route, { ok: true, profile: { id: userId, full_name: 'E2E Admin', role: 'admin' } }) }
    if (url.pathname === '/rest/v1/rpc/get_basic_bootstrap') return json(route, { students: [{ id: 102, branch_id: 1, name: 'Basic Student', nric: '', gender: '', date_of_birth: null, age: null, height: '', school: '', tshirt_size: '', student_phone: '', parent_name: '', parent_contact: '', email: '', father_height: '', mother_height: '', monthly_fee: null, level: 'Beginner', status: 'Active', photo_path: null, created_at: new Date().toISOString() }], coaches: [], classes: [], sessions: [], enrollments: [], payments: [] })
    if (url.pathname === '/rest/v1/profiles') return json(route, { id: userId, full_name: adminLogin ? 'E2E Admin' : 'E2E Staff', role: adminLogin ? 'admin' : 'staff' })
    if (url.pathname === '/rest/v1/branches') return json(route, [{ id: 1, name: 'Main Branch', subtitle: 'E2E', status: 'Active' }, { id: 2, name: 'Second Branch', subtitle: 'E2E 2', status: 'Active' }])
    if (url.pathname === '/rest/v1/academy_settings') return json(route, { academy_name: 'Titan Storm', logo_path: null, default_branch_id: 1 })
    if (url.pathname === '/rest/v1/students') {
      const today = new Date()
      const birthday = `${today.getFullYear() - 10}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const birthdayStudent = { id: 101, branch_id: 1, name: 'Birthday Student', nric: '', gender: '', date_of_birth: birthday, age: null, height: '', school: '', tshirt_size: '', student_phone: '', parent_name: '', parent_contact: '', email: '', father_height: '', mother_height: '', monthly_fee: 100, level: 'Beginner', status: 'Active', photo_path: null, created_at: new Date().toISOString() }
      const directoryStudents = Array.from({ length: 30 }, (_, index) => ({ ...birthdayStudent, id: 200 + index, name: `Directory Student ${String(index + 1).padStart(2, '0')}`, date_of_birth: null }))
      return json(route, adminLogin ? [birthdayStudent, ...directoryStudents] : [])
    }
    return json(route, [])
  })
}

async function login(page: Page, admin = false) {
  await mockBackend(page)
  await page.goto('/')
  await page.getByLabel('Your name').fill(admin ? 'E2E Admin' : 'E2E Staff')
  if (admin) await page.getByLabel(/Password/).fill('shared-admin-password')
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page.getByText('Good morning, team').or(page.getByText('Good afternoon, team')).or(page.getByText('Good evening, team'))).toBeVisible()
}

test('renders the existing shared-access login without horizontal overflow', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Enter' })).toBeVisible()
  await expect(page.getByText('Leave password blank for attendance-only access.')).toBeVisible()
  const contentOverflow = await page.evaluate(() => {
    const bounds = document.body.getBoundingClientRect()
    return [...document.body.querySelectorAll('*')].some((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
    })
  })
  expect(contentOverflow).toBe(false)
  const fontSize = await page.getByLabel('Your name').evaluate((element) => getComputedStyle(element).fontSize)
  expect(Number.parseFloat(fontSize)).toBeGreaterThanOrEqual(16)
})

test('dark mode can be selected before login and persists', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Use dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
  await expect(page.locator('.login-kiosk-card')).not.toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
  await expect(page.getByRole('button', { name: 'Use light mode' })).toBeVisible()
})

test('account dark mode persists and keeps student profiles dark', async ({ page, isMobile }) => {
  await login(page)
  await page.getByRole('button', { name: 'Use dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: /Basic Student/ }).click()
  await expect(page.getByRole('dialog')).not.toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
})

test('reopening the app restores the last page', async ({ page, isMobile }) => {
  await login(page)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await expect(page).toHaveURL(/page=students/)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  await expect(page).toHaveURL(/page=students/)
})

test('browser Back returns through top-level app navigation', async ({ page, isMobile }) => {
  await login(page)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Attendance', { exact: true }).click()
  await expect(page).toHaveURL(/page=attendance/)
  await navigation.getByText('Students', { exact: true }).click()
  await expect(page).toHaveURL(/page=students/)
  await page.goBack()
  await expect(page).toHaveURL(/page=attendance/)
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
})

test('browser Back restores the previous page scroll position', async ({ page, isMobile }) => {
  await login(page, true)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => (document.scrollingElement?.scrollHeight || 0) - (document.scrollingElement?.clientHeight || 0))).toBeGreaterThan(500)
  const previousScroll = await page.evaluate(() => {
    window.scrollTo(0, 600)
    return window.scrollY
  })
  expect(previousScroll).toBeGreaterThan(300)
  await navigation.getByText('Attendance', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(previousScroll - 100)
})

test('browser Back restores the previous branch and its scroll position', async ({ page }) => {
  await login(page, true)
  await page.getByRole('navigation', { name: 'Full navigation' }).getByText('Students', { exact: true }).click()
  await expect.poll(() => page.evaluate(() => (document.scrollingElement?.scrollHeight || 0) - (document.scrollingElement?.clientHeight || 0))).toBeGreaterThan(500)
  await page.evaluate(() => window.scrollTo(0, 600))
  const branch = page.getByRole('textbox', { name: 'Active branch' })
  await branch.click()
  await page.getByRole('option', { name: 'Second Branch' }).click()
  await expect(branch).toHaveValue('Second Branch')
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  await expect(branch).toHaveValue('Main Branch')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
})

test('basic users can open a read-only student profile from the card', async ({ page, isMobile }) => {
  await login(page)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: /Basic Student/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Full name')).toHaveValue('Basic Student')
  await expect(page.getByLabel('Full name')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save student' })).toHaveCount(0)
})

test('student profile fits the mobile visual viewport', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile modal sizing')
  await login(page)
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: /Basic Student/ }).click()
  const bounds = await page.getByRole('dialog').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: visualViewport?.width || innerWidth, viewportHeight: visualViewport?.height || innerHeight }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(-1)
  expect(bounds.top).toBeGreaterThanOrEqual(-1)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1)
  const modalBody = page.locator('.student-profile-modal-body')
  const scroll = await modalBody.evaluate((body) => {
    body.scrollTop = body.scrollHeight
    return { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, scrollTop: body.scrollTop }
  })
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight)
  expect(scroll.scrollTop).toBeGreaterThan(0)
})

test('Add student stays fixed while the mobile student directory scrolls', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile floating action behavior')
  await login(page, true)
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByText('Students', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible()
  await expect(page.locator('.page-transition')).toHaveCSS('transform', 'none')
  await expect.poll(() => page.evaluate(() => (document.scrollingElement?.scrollHeight || 0) - (document.scrollingElement?.clientHeight || 0))).toBeGreaterThan(500)
  await page.evaluate(() => { if (document.scrollingElement) document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight })
  await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop || 0)).toBeGreaterThan(0)
  const bounds = await page.getByRole('button', { name: 'Add student' }).evaluate((button) => {
    const rect = button.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, position: getComputedStyle(button).position, viewportHeight: visualViewport?.height || innerHeight }
  })
  expect(bounds.position).toBe('fixed')
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight)
})

test('branch switching does not enlarge the mobile viewport', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile viewport behavior')
  await login(page)
  const before = await page.evaluate(() => ({ width: visualViewport?.width || innerWidth, scale: visualViewport?.scale || 1 }))
  const branch = page.getByRole('textbox', { name: 'Active branch' })
  expect(Number.parseFloat(await branch.evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  await branch.click()
  await page.getByRole('option', { name: 'Second Branch' }).click()
  await expect(branch).toHaveValue('Second Branch')
  const after = await page.evaluate(() => ({ width: visualViewport?.width || innerWidth, scale: visualViewport?.scale || 1, scrollX }))
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1)
  expect(after.scale).toBe(before.scale)
  expect(after.scrollX).toBe(0)
})

test('administrators can open an editable student profile from the card', async ({ page, isMobile }) => {
  await login(page, true)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: /Birthday Student/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Full name')).toHaveValue('Birthday Student')
  await expect(page.getByLabel('Full name')).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Save student' })).toBeVisible()
})

test('student detail dropdowns work in mobile portrait mode', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile portrait dropdown behavior')
  await login(page, true)
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: 'Add student' }).click()
  await page.getByRole('textbox', { name: 'Gender' }).click()
  await page.getByRole('option', { name: 'Female' }).click()
  await expect(page.getByRole('textbox', { name: 'Gender' })).toHaveValue('Female')
  await page.getByRole('textbox', { name: 'Level', exact: true }).click()
  await page.getByRole('option', { name: 'Intermediate' }).click()
  await expect(page.getByRole('textbox', { name: 'Level', exact: true })).toHaveValue('Intermediate')
})

test('Overview shows a student whose birthday is today', async ({ page }) => {
  await login(page, true)
  await expect(page.getByRole('heading', { name: 'Birthday babies' })).toBeVisible()
  await expect(page.getByText('Birthday Student')).toBeVisible()
  await expect(page.getByText('Today', { exact: true })).toBeVisible()
})

test('student editor supports manual age or automatic DOB age', async ({ page, isMobile }) => {
  await login(page, true)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: 'Add student' }).click()
  await page.getByLabel('Age', { exact: true }).fill('0')
  await expect(page.getByLabel('Age', { exact: true })).toHaveValue('0')
  await page.getByText('DOB', { exact: true }).click()
  await page.getByLabel('Date of birth', { exact: true }).fill('2015-08-01')
  await expect(page.getByText(/Calculated age:/)).toBeVisible()
  await expect(page.getByLabel('Age', { exact: true })).toBeHidden()
})

test('selected student photo is previewed before saving', async ({ page, isMobile }) => {
  await login(page, true)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: 'Add student' }).click()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose profile photo' }).click()
  await (await fileChooser).setFiles({
    name: 'student-preview.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  })
  await expect(page.getByText('Photo preview · save to upload')).toBeVisible()
  await expect.poll(() => page.locator('.profile-photo-editor img').getAttribute('src')).toMatch(/^blob:/)
})

test('dirty student form cannot close until discard is confirmed', async ({ page, isMobile }) => {
  await login(page, true)
  const navigation = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  await navigation.getByText('Students', { exact: true }).click()
  await page.getByRole('button', { name: 'Add student' }).click()
  await page.getByLabel('Full name').fill('Unsaved Student')
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Discard your unsaved changes')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByLabel('Full name')).toHaveValue('Unsaved Student')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByLabel('Full name')).toBeHidden()
  await navigation.getByText('Attendance', { exact: true }).click()
  await expect(page).toHaveURL(/page=attendance/)
})

test('mobile Back closes the More drawer before leaving the page', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile navigation behavior')
  await login(page)
  await page.getByRole('button', { name: 'More' }).click()
  await expect(page.getByRole('button', { name: 'Close full navigation' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('button', { name: 'Close full navigation' })).toBeHidden()
})
