import { test, expect } from '@playwright/test'
import { totpAt, currentStep } from '../../../server/totp.js'
import { E2E_PASSWORD, E2E_TOTP_SECRET } from './fixtures.js'

test('a visitor is sent to the login page while the Gallery is closed', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('Trade Master screens are closed to visitors', async ({ page }) => {
  await page.goto('/admin/settings')
  await expect(page).toHaveURL('/login')
})

test('the login page asks for both password and code', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Enter your password.')).toBeVisible()
  await expect(page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible()
})

test('a wrong code is refused in plain language', async ({ page }) => {
  await page.goto('/login')
  const right = totpAt(E2E_TOTP_SECRET, currentStep())
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByLabel('Authenticator code').fill(right === '000000' ? '111111' : '000000')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'That password or code is not right.' })).toBeVisible()
  await expect(page).toHaveURL('/login')
})

test('the Trade Master signs in, sees the Overview, and signs out', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByLabel('Authenticator code').fill(totpAt(E2E_TOTP_SECRET, currentStep()))
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: '4 AI traders. $1,000 each. 3 months.', level: 1 })).toBeVisible()
  await expect(page.getByText('TRADE MASTER', { exact: true })).toBeVisible()
  await expect(page.getByTestId('dateline')).toContainText(/NY \d\d:\d\d/)
  await expect(page.getByText('Virtual money only. Not financial advice.')).toBeVisible()

  // The session survives a reload: it lives in an httpOnly cookie.
  await page.reload()
  await expect(page.getByText('TRADE MASTER', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/login')
  await page.goto('/')
  await expect(page).toHaveURL('/login')
})

test('Terminal is the default look, and Daylight sticks once picked', async ({ page }) => {
  await page.goto('/login')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'market-jury')
  await expect(html).toHaveAttribute('data-mode', 'dark')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 17, 23)')

  // The login page has no toggle; flip the stored choice the toggle writes and reload.
  await page.evaluate(() => localStorage.setItem('ui-mode', 'light'))
  await page.reload()
  await expect(html).toHaveAttribute('data-mode', 'light')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 248, 250)')
})
