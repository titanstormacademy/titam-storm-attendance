import { expect, test, type Page, type Route } from '@playwright/test'

const userId = '22222222-2222-4222-8222-222222222222'

function jwt() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: true })}.signature`
}

function fixtureData() {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const comparisonMonth = (now.getMonth() + 6) % 12
  const comparisonMonthDate = `${now.getFullYear()}-${String(comparisonMonth + 1).padStart(2, '0')}-15`
  const gapMonthDate = `${now.getFullYear()}-${String(Math.min(now.getMonth(), comparisonMonth) + 2).padStart(2, '0')}-15`
  const month = `${today.slice(0, 7)}-01`
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now)
  const students = [
    { id: 201, branch_id: 1, name: 'Avery Basketball Student With A Long Name', nric: 'S001', gender: 'Female', date_of_birth: `${now.getFullYear() - 12}-08-02`, age: null, height: '155', school: 'Titan International School', tshirt_size: 'M', student_phone: '0123456789', parent_name: 'Taylor Parent', parent_contact: '0198765432', email: 'avery@example.test', father_height: '180', mother_height: '165', monthly_fee: 150, level: 'Intermediate', status: 'Active', photo_path: 'fixtures/avery.jpg', created_at: now.toISOString() },
    { id: 202, branch_id: 1, name: 'Blake Trial', nric: '', gender: 'Male', date_of_birth: null, age: 9, height: '', school: '', tshirt_size: '', student_phone: '', parent_name: '', parent_contact: '', email: '', father_height: '', mother_height: '', monthly_fee: 120, level: 'Beginner', status: 'Trial', photo_path: null, created_at: now.toISOString() },
  ]
  const coaches = [
    { id: 301, branch_id: 1, name: 'Jordan Head Coach', phone: '0123000000', coach_type: 'Head', hourly_rate: 0, status: 'Active', photo_path: null },
    { id: 302, branch_id: 1, name: 'Morgan Assistant Coach', phone: '0123111111', coach_type: 'Assistant', hourly_rate: 80, status: 'Active', photo_path: null },
  ]
  const classes = [{ id: 401, branch_id: 1, label: 'Elite Development Training With Long Name', day_of_week: day, start_time: '09:00:00', end_time: '10:30:00', coach_id: 301, coach: { id: 301, name: 'Jordan Head Coach' } }, { id: 402, branch_id: 1, label: 'Skills Lab', day_of_week: 'Saturday', start_time: '11:00:00', end_time: '12:00:00', coach_id: 301, coach: { id: 301, name: 'Jordan Head Coach' } }]
  const sessions = [{ id: 501, branch_id: 1, class_id: 401, session_date: today, notes: 'Bring both jerseys', coach_id: 301, class: { id: 401, label: classes[0].label, start_time: '09:00:00', end_time: '10:30:00' }, coach: { id: 301, name: 'Jordan Head Coach' } }]
  const enrollments = [{ id: 601, branch_id: 1, student_id: 201, class_id: 401, start_date: `${now.getFullYear()}-01-01`, end_date: null }]
  const payments = [{ id: 701, branch_id: 1, student_id: 201, fee_month: month, amount: 150, method: 'Bank Transfer', status: 'Paid', date_received: today, remarks: 'Monthly fee', reference_no: 'UX-001', coach_id: 301, commission_settled: false, coach_payment_id: null, receipt_path: null, student: { id: 201, name: students[0].name, monthly_fee: 150 }, coach: { id: 301, name: coaches[0].name } }]
  const attendance = [{ student_id: 201, session_id: 501, class_id: 401, branch_id: 1, attendance_date: today, status: 'Present', remarks: 'On time', is_trial: false }, { student_id: 202, session_id: 501, class_id: 401, branch_id: 1, attendance_date: today, status: 'Present', remarks: 'First visit', is_trial: true }]
  const reportAttendance = [...attendance.map((record) => { const student = students.find((item) => item.id === record.student_id)!; return { ...record, student: { id: student.id, name: student.name, status: student.status, gender: student.gender, level: student.level }, class: { id: 401, label: classes[0].label } } }), { ...attendance[0], session_id: 502, class_id: 402, student: { id: students[0].id, name: students[0].name, status: students[0].status, gender: students[0].gender, level: students[0].level }, class: { id: 402, label: classes[1].label } }, { ...attendance[0], session_id: 503, attendance_date: comparisonMonthDate, student: { id: students[0].id, name: students[0].name, status: students[0].status, gender: students[0].gender, level: students[0].level }, class: { id: 401, label: classes[0].label } }, { ...attendance[0], session_id: 504, attendance_date: gapMonthDate, student: { id: students[0].id, name: students[0].name, status: students[0].status, gender: students[0].gender, level: students[0].level }, class: { id: 401, label: classes[0].label } }]
  const coachAttendance = [{ id: 801, branch_id: 1, session_id: 501, class_id: 401, attendance_date: today, coach_id: 302, hours: 1.5, coach_payment_id: null }]
  return { today, month, students, coaches, classes, sessions, enrollments, payments, attendance, reportAttendance, coachAttendance }
}

async function respond(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })
}

async function mockAdminBackend(page: Page, options: { failBootstrap?: boolean; failReport?: boolean; failSettings?: boolean } = {}) {
  const data = fixtureData()
  let admin = false
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.includes('/storage/v1/object/public/student-photos/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#f26522"/></svg>' })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (url.pathname === '/auth/v1/signup') return respond(route, { access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ux-refresh', user: { id: userId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: { full_name: 'UX Admin' }, created_at: new Date().toISOString() } })
    if (url.pathname === '/rest/v1/rpc/login_with_shared_admin_password') { admin = true; return respond(route, { ok: true, profile: { id: userId, full_name: 'UX Admin', role: 'admin' } }) }
    if (url.pathname === '/rest/v1/profiles') {
      const single = request.headers().accept?.includes('vnd.pgrst.object') || url.searchParams.has('id')
      return respond(route, single ? { id: userId, full_name: 'UX Admin', role: 'admin' } : [{ id: userId, full_name: 'UX Admin', role: 'admin' }])
    }
    if (url.pathname === '/rest/v1/branches') return respond(route, [{ id: 1, name: 'Main Academy Branch With A Long Name', subtitle: 'City Sports Centre', status: 'Active' }, { id: 2, name: 'Second Branch', subtitle: 'North Centre', status: 'Active' }])
    if (url.pathname === '/rest/v1/academy_settings') return respond(route, { academy_name: 'Titan Storm Basketball Academy', logo_path: null, default_branch_id: 1 })
    if (url.pathname === '/rest/v1/students') return options.failBootstrap ? respond(route, { message: 'Bootstrap unavailable' }, 500) : respond(route, admin ? data.students : [])
    if (url.pathname === '/rest/v1/coaches') return respond(route, data.coaches)
    if (url.pathname === '/rest/v1/classes') return respond(route, data.classes)
    if (url.pathname === '/rest/v1/sessions') return respond(route, request.method() === 'GET' ? data.sessions : data.sessions[0])
    if (url.pathname === '/rest/v1/enrollments') return respond(route, data.enrollments)
    if (url.pathname === '/rest/v1/payments') return respond(route, data.payments)
    if (url.pathname === '/rest/v1/attendance') return options.failReport && url.searchParams.get('select')?.includes('student:students') ? respond(route, { message: 'Report unavailable' }, 500) : respond(route, url.searchParams.get('select')?.includes('student:students') ? data.reportAttendance : data.attendance)
    if (url.pathname === '/rest/v1/coach_attendance') return respond(route, data.coachAttendance)
    if (url.pathname === '/rest/v1/head_coach_rates') return options.failSettings ? respond(route, { message: 'Settings unavailable' }, 500) : respond(route, [{ id: 901, min_students: 1, max_students: 49, min_fee: 0, max_fee: 99999, payout: 30 }])
    if (url.pathname === '/rest/v1/branch_memberships') return respond(route, [])
    if (url.pathname === '/rest/v1/coach_payments') return respond(route, [])
    if (url.pathname === '/rest/v1/rpc/set_attendance_trial') {
      const input = request.postDataJSON() as { p_student_id: number; p_is_trial: boolean }
      const record = data.attendance.find((item) => item.student_id === input.p_student_id)!
      record.is_trial = input.p_is_trial
      const reportRecord = data.reportAttendance.find((item) => item.student_id === input.p_student_id)!
      reportRecord.is_trial = input.p_is_trial
      return respond(route, record)
    }
    if (url.pathname === '/rest/v1/rpc/get_head_coach_commission') return respond(route, { type: 'Head', units: 1, students: 1, commission: 30, unmatched: 0, items: [{ paymentId: 701, studentId: 201, studentName: data.students[0].name, feeMonth: data.month.slice(0, 7), dateReceived: data.today, receivedMonth: data.month.slice(0, 7), fee: 150, payout: 30 }] })
    if (url.pathname === '/rest/v1/rpc/get_assistant_pay') return respond(route, { type: 'Assistant', month: data.month.slice(0, 7), hours: 1.5, hourlyRate: 80, total: 120, sessions: [{ date: data.today, className: data.classes[0].label, hours: 1.5 }] })
    return respond(route, [])
  })
}

async function loginAdmin(page: Page, options: { failBootstrap?: boolean; failReport?: boolean; failSettings?: boolean } = {}) {
  await mockAdminBackend(page, options)
  await page.goto('/')
  await page.getByLabel('Your name').fill('UX Admin')
  await page.getByLabel(/Password/).fill('shared-password')
  await page.getByRole('button', { name: 'Enter' }).click()
  if (!options.failBootstrap) await expect(page.getByRole('heading', { name: /Good .* team/ })).toBeVisible()
}

async function navigate(page: Page, isMobile: boolean, label: string, heading: string | RegExp) {
  const primary = page.getByRole('navigation', { name: isMobile ? 'Primary navigation' : 'Full navigation' })
  if (isMobile && !['Overview', 'Attendance', 'Students'].includes(label)) {
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('navigation', { name: 'Full navigation' }).getByText(label, { exact: true }).click()
  } else {
    await primary.getByText(label, { exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflowing = await page.evaluate(() => {
    const root = document.querySelector('.app-main') || document.body
    const bounds = root.getBoundingClientRect()
    return [...root.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element)
      if (!element.checkVisibility() || style.position === 'fixed' || style.position === 'absolute' || element.closest('[class*="mantine-TableScrollContainer"]') || element.closest('[class*="mantine-Grid"]')) return false
      const rect = element.getBoundingClientRect()
      return rect.left < bounds.left - 2 || rect.right > bounds.right + 2
    }).map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 60) }))
  })
  expect(overflowing).toEqual([])
}

const screens = [
  { label: 'Overview', heading: /Good .* team/ },
  { label: 'Attendance', heading: 'Attendance' },
  { label: 'Students', heading: 'Students' },
  { label: 'Classes & sessions', heading: 'Classes' },
  { label: 'Payments', heading: 'Payments' },
  { label: 'Coaches', heading: 'Coaches' },
  { label: 'Reports', heading: 'Reports' },
  { label: 'Settings', heading: 'Settings' },
]

test('overview prioritizes monthly pulse, birthdays, and fee collection status', async ({ page }) => {
  await loginAdmin(page)
  await expect(page.getByRole('heading', { name: 'Monthly pulse' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Birthday babies' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Today’s schedule' })).toHaveCount(0)
  await expect(page.getByText('Active students', { exact: true })).toHaveCount(0)
  await expect(page.locator('.fee-collection-cell').filter({ has: page.getByText('Total students', { exact: true }) })).toContainText('1')
  await expect(page.locator('.fee-collection-cell').filter({ has: page.getByText('Paid', { exact: true }) })).toContainText('1')
  await expect(page.locator('.fee-collection-cell').filter({ has: page.getByText('Unpaid', { exact: true }) })).toContainText('0')
  const iconColors = await page.locator('.monthly-pulse-panel .mantine-ThemeIcon-root').evaluateAll((icons) => [...new Set(icons.map((icon) => getComputedStyle(icon).color))])
  expect(iconColors.length).toBeGreaterThanOrEqual(3)
})

test('trial attendance is tagged and excluded from counted report sessions', async ({ page, isMobile }) => {
  await loginAdmin(page)
  await navigate(page, Boolean(isMobile), 'Attendance', 'Attendance')
  await page.getByRole('button', { name: /Elite Development Training/ }).first().click()
  const attendanceSummary = page.locator('.attendance-summary-card.present')
  await expect(attendanceSummary).toContainText('2')
  await expect(attendanceSummary).toContainText('Regular 1')
  await expect(attendanceSummary).toContainText('Trial 1')
  const enrolledCard = page.locator('.attendance-student-card').filter({ hasText: 'Avery Basketball Student' })
  await expect(enrolledCard.getByRole('button', { name: /trial/i })).toHaveCount(0)
  const trialCard = page.locator('.attendance-student-card').filter({ hasText: 'Blake Trial' })
  const trialToggle = trialCard.getByRole('button', { name: 'Remove trial tag from Blake Trial' })
  await expect(trialToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(trialToggle).toHaveText('Trial session ✓')
  await trialToggle.click()
  const markTrial = trialCard.getByRole('button', { name: 'Mark Blake Trial as a trial session' })
  await expect(markTrial).toHaveText('Mark trial')
  await markTrial.click()
  await expect(trialToggle).toHaveText('Trial session ✓')
  await navigate(page, Boolean(isMobile), 'Reports', 'Reports')
  const trialStudent = page.getByRole('button', { name: /Blake Trial/ })
  await expect(trialStudent).toContainText('1')
  await trialStudent.click()
  await expect(page.getByText('Trial', { exact: true }).last()).toBeVisible()
})

test('student photo lightbox stays contained on phone screens', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile photo lightbox behavior')
  await loginAdmin(page)
  await navigate(page, true, 'Attendance', 'Attendance')
  await page.getByRole('button', { name: /Elite Development Training/ }).first().click()
  await page.getByRole('button', { name: /View photo of Avery Basketball Student/ }).click()
  await expect(page.getByText('Avery Basketball Student With A Long Name', { exact: true }).last()).toBeVisible()
  const bounds = await page.locator('.photo-lightbox-content').evaluate((content) => {
    const contentRect = content.getBoundingClientRect()
    const imageRect = content.querySelector('img')!.getBoundingClientRect()
    return { top: contentRect.top, right: contentRect.right, bottom: contentRect.bottom, left: contentRect.left, imageTop: imageRect.top, imageRight: imageRect.right, imageBottom: imageRect.bottom, imageLeft: imageRect.left, viewportWidth: visualViewport?.width || innerWidth, viewportHeight: visualViewport?.height || innerHeight }
  })
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight)
  expect(bounds.imageTop).toBeGreaterThanOrEqual(bounds.top)
  expect(bounds.imageLeft).toBeGreaterThanOrEqual(bounds.left)
  expect(bounds.imageRight).toBeLessThanOrEqual(bounds.right)
  expect(bounds.imageBottom).toBeLessThanOrEqual(bounds.bottom)
})

test('reports can be filtered by student name', async ({ page, isMobile }) => {
  await loginAdmin(page)
  await navigate(page, Boolean(isMobile), 'Reports', 'Reports')
  await expect(page.getByRole('button', { name: /Avery Basketball Student/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Blake Trial/ })).toBeVisible()
  await page.getByLabel('Search report students').fill('blake')
  await expect(page.getByRole('button', { name: /Blake Trial/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Avery Basketball Student/ })).toHaveCount(0)
  await expect(page.getByText('1 of 2 students')).toBeVisible()
  await page.getByLabel('Search report students').fill('')
  await page.getByLabel('Filter report students by class').click()
  await page.getByRole('option', { name: 'Skills Lab' }).click()
  await expect(page.getByRole('button', { name: /Avery Basketball Student/ }).locator('.report-total')).toHaveText('1')
  await expect(page.getByRole('button', { name: /Blake Trial/ })).toHaveCount(0)
})

test('receipt images are compressed before OCR upload', async ({ page, isMobile, browserName }) => {
  test.skip(isMobile && browserName !== 'webkit', 'Receipt compression runs in Chromium and mobile WebKit')
  await loginAdmin(page)
  await navigate(page, Boolean(isMobile), 'Payments', 'Payments')
  await page.getByRole('button', { name: 'Record payment' }).click()
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 1200
    const context = canvas.getContext('2d')!
    const image = context.createImageData(canvas.width, canvas.height)
    let state = 123456789
    for (let index = 0; index < image.data.length; index += 4) {
      state = (state * 1664525 + 1013904223) >>> 0
      image.data[index] = state & 255
      image.data[index + 1] = (state >>> 8) & 255
      image.data[index + 2] = (state >>> 16) & 255
      image.data[index + 3] = (state >>> 24) & 255
    }
    context.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  })
  const source = Buffer.from(dataUrl.split(',')[1], 'base64')
  const requestPromise = page.waitForRequest((request) => request.url().includes('/functions/v1/receipt-ocr'))
  await page.locator('input[type="file"]').setInputFiles({ name: 'large-receipt.png', mimeType: 'image/png', buffer: source })
  const request = await requestPromise
  const uploaded = request.postDataBuffer()!
  const contentStart = uploaded.indexOf(Buffer.from('\r\n\r\n')) + 4
  const contentEnd = uploaded.lastIndexOf(Buffer.from('\r\n--'))
  expect(uploaded.includes(Buffer.from('image/webp'))).toBe(true)
  expect(contentEnd - contentStart).toBeLessThanOrEqual(400_000)
})

test('reports combine attendance from multiple selected months', async ({ page, isMobile }) => {
  const now = new Date()
  const comparisonMonth = (now.getMonth() + 6) % 12
  const comparisonMonthLabel = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(now.getFullYear(), comparisonMonth, 1))
  await loginAdmin(page)
  await navigate(page, Boolean(isMobile), 'Reports', 'Reports')
  const student = page.getByRole('button', { name: /Avery Basketball Student/ })
  await expect(student.locator('.report-total')).toHaveText('2')
  await page.getByLabel('Filter report by months').click()
  await page.getByRole('option', { name: comparisonMonthLabel, exact: true }).click()
  await expect(student.locator('.report-total')).toHaveText('3')
})

test('bootstrap failures show a retry action instead of an endless skeleton', async ({ page }) => {
  await loginAdmin(page, { failBootstrap: true })
  await expect(page.getByText('Could not load academy data')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('report and settings failures remain visible with retry actions', async ({ page, isMobile }) => {
  await loginAdmin(page, { failReport: true, failSettings: true })
  await navigate(page, Boolean(isMobile), 'Reports', 'Reports')
  await expect(page.getByText('Could not load report')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy' })).toBeDisabled()
  await navigate(page, Boolean(isMobile), 'Settings', 'Settings')
  await expect(page.getByText('Could not load access and commission settings')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save rate table' })).toBeDisabled()
})

test('every admin screen renders without horizontal overflow in light and dark mode', async ({ page, isMobile }) => {
  test.setTimeout(90_000)
  await loginAdmin(page)
  for (const screen of screens) {
    if (screen.label !== 'Overview') await navigate(page, Boolean(isMobile), screen.label, screen.heading)
    await expectNoHorizontalOverflow(page)
  }
  await page.getByRole('button', { name: 'Use dark mode' }).click()
  for (const screen of screens) {
    await navigate(page, Boolean(isMobile), screen.label, screen.heading)
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark')
    await expectNoHorizontalOverflow(page)
  }
})

test('primary interaction on every admin screen is reachable', async ({ page, isMobile }) => {
  test.setTimeout(90_000)
  await loginAdmin(page)
  await navigate(page, Boolean(isMobile), 'Attendance', 'Attendance')
  await page.getByRole('button', { name: /Elite Development Training/ }).first().click()
  await expect(page.getByRole('button', { name: 'Back to attendance' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to attendance' }).click()

  await navigate(page, Boolean(isMobile), 'Students', 'Students')
  await page.getByRole('button', { name: /Avery Basketball Student/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await navigate(page, Boolean(isMobile), 'Classes & sessions', 'Classes')
  await page.getByRole('button', { name: 'Add class' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await navigate(page, Boolean(isMobile), 'Payments', 'Payments')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await navigate(page, Boolean(isMobile), 'Coaches', 'Coaches')
  await page.getByRole('button', { name: 'Add coach' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await navigate(page, Boolean(isMobile), 'Reports', 'Reports')
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible()

  await navigate(page, Boolean(isMobile), 'Settings', 'Settings')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
})
