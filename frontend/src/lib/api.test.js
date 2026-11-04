import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
describe('api errors', () => {
  it.each([409, 200])('preserves state-service errors for HTTP %s', async status => {
    vi.stubGlobal('navigator', { userAgent: '' })
    const body = { ok: false, error: { code: 'STATE_CONFLICT', message: 'State changed', details: { current_revision: 8 } } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body }))
    const { api } = await import('./api.js')
    await expect(api('/api/data')).rejects.toMatchObject({ message: 'State changed', status, code: 'STATE_CONFLICT', details: { current_revision: 8 }, body })
  })
  it('preserves legacy string errors and reload-required status', async () => {
    vi.stubGlobal('navigator', { userAgent: '' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 428, json: async () => ({ error: 'Reload required' }) }))
    const { api } = await import('./api.js')
    await expect(api('/api/data')).rejects.toMatchObject({ message: 'Reload required', status: 428 })
  })
  it('preserves HTTP errors even with a null response body', async () => {
    vi.stubGlobal('navigator', { userAgent: '' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => null }))
    const { api } = await import('./api.js')
    await expect(api('/api/data')).rejects.toMatchObject({ message: 'HTTP 502', status: 502, body: null })
  })

})
