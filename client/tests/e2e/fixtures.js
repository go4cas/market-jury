// The Trade Master the end-to-end server is seeded with. Test-only values.
export const E2E_PASSWORD = 'e2e trade master password'
export const E2E_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
// A ready-made Trade Master session, so screen tests needn't spend the one-time code.
export const E2E_SESSION_TOKEN = 'e2e-trade-master-session'
// A second session for the test that signs out, so the one above stays valid.
export const E2E_SIGN_OUT_TOKEN = 'e2e-trade-master-sign-out'
