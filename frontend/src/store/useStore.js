import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'

const KEY = 'gym_state_v1'
const dirty = () => localStorage.getItem('gym_dirty') === '1'
const revision = state => state?._revision || 0
const conflictError = () => Object.assign(new Error('Server data changed. Export your local backup, then reload server data in Settings.'), { code: 'STATE_CONFLICT', status: 409 })
const ownerError = () => Object.assign(new Error('Local data belongs to another profile. Export your backup, then reload server data in Settings.'), { code: 'STATE_OWNER_MISMATCH', status: 409 })
const blocked = e => ['STATE_CONFLICT', 'STATE_REVISION_REQUIRED', 'STATE_REVISION_INVALID', 'STATE_VALIDATION_FAILED'].includes(e.code) || [400, 409, 422, 428].includes(e.status)
function savedSyncError() {
  try { return JSON.parse(localStorage.getItem('gym_sync_error')) } catch { return null }
}
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null
}
const clone = o => JSON.parse(JSON.stringify(o))

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return Object.assign(clone(DEF), JSON.parse(raw))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null
  let inFlight = null
  let edits = 0
  let recovering = false
  let persisted = localStorage.getItem(KEY)

  const syncError = error => {
    const info = { message: error.message, code: error.code, status: error.status, details: error.details }
    if (blocked(error)) localStorage.setItem('gym_sync_error', JSON.stringify(info))
    set({ syncStatus: blocked(error) ? 'conflict' : 'error', syncError: info })
  }
  const clearSyncError = () => {
    localStorage.removeItem('gym_sync_error')
    set({ syncError: null })
  }
  const pushQuietly = () => get().pushState().catch(() => {})
  const schedulePush = (delay = 1500) => {
    clearTimeout(pushTm)
    pushTm = null
    if (get().syncStatus !== 'conflict') pushTm = setTimeout(pushQuietly, delay)
  }

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true) => {
    if (push) S._ts = Date.now()
    if (push && get().user) {
      // Imported backups cannot change the revision this device has acknowledged.
      S._revision = revision(get().S)
      localStorage.setItem('gym_dirty', '1')
      edits++
      if (get().syncStatus !== 'conflict') set({ syncStatus: 'pending' })
    }
    registerCustom(S.customEx)
    persisted = JSON.stringify(S)
    localStorage.setItem(KEY, persisted)
    set({ S })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      schedulePush()
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      pushQuietly()
    }
  })
  window.addEventListener('online', () => { if (get().user && dirty()) pushQuietly() })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    clearTimeout(pushTm)
    clearSyncError()
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem('gym_state_user')
    localStorage.removeItem(KEY)
    set({ syncStatus: 'saved' })
    persist(clone(DEF), false)
  }

  return {
    S: (() => { const s = loadState(); registerCustom(s.customEx); return s })(),
    user: (() => { try { return JSON.parse(localStorage.getItem('gym_user')) || null } catch { return null } })(),
    ready: false,
    syncStatus: savedSyncError() ? 'conflict' : dirty() ? 'pending' : 'saved',
    syncError: savedSyncError(),

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      const S = clone(get().S)
      mut(S)
      persist(S, push)
    },
    replaceState(S, push = false) { persist(clone(S), push) },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) { if (v) localStorage.setItem('gym_guest', '1'); else localStorage.removeItem('gym_guest'); set({}) },

    setUser(u) {
      if (u) {
        const owner = localStorage.getItem('gym_state_user') || get().user?.id
        if (owner && owner !== u.id) {
          syncError(ownerError())
        } else if (owner !== u.id) {
          clearSyncError()
          persist({ ...get().S, _revision: 0 }, false)
          if (hasData(get().S) || get().S.active || dirty()) localStorage.setItem('gym_dirty', '1')
        }
        localStorage.setItem('gym_state_user', owner || u.id)
        localStorage.setItem('gym_user', JSON.stringify(u))
        localStorage.removeItem('gym_guest')
      } else localStorage.removeItem('gym_user')
      set({ user: u, syncStatus: savedSyncError() ? 'conflict' : dirty() ? 'pending' : 'saved' })
    },

    async pushState() {
      if (!get().user) return
      const owner = localStorage.getItem('gym_state_user')
      if (owner && owner !== get().user.id) { const error = ownerError(); syncError(error); throw error }
      clearTimeout(pushTm)
      pushTm = null
      if (get().syncStatus === 'conflict') throw Object.assign(new Error(get().syncError.message), get().syncError)
      if (recovering) throw new Error('Server reload is in progress.')
      if (inFlight) return inFlight
      if (!dirty()) return
      inFlight = (async () => {
        try {
          while (dirty()) {
            if (localStorage.getItem(KEY) !== persisted) throw conflictError()
            const uid = get().user.id
            const snapshot = clone(get().S)
            const sentEdits = edits
            set({ syncStatus: 'syncing' })
            const ack = await api('/api/data', {
              method: 'PUT', body: JSON.stringify({ state: snapshot, expected_revision: revision(snapshot), expected_uid: uid })
            })
            if (get().user?.id !== uid || get().syncError?.code === 'STATE_OWNER_MISMATCH') throw ownerError()
            if (localStorage.getItem(KEY) !== persisted) throw conflictError()
            if (!Number.isInteger(ack.revision) || ack.revision < 0) throw new Error('Server did not acknowledge a revision. Reload the app before saving.')
            // Acknowledgement updates metadata only: edits made during the request stay local.
            const latest = { ...get().S, _revision: ack.revision }
            if (sentEdits === edits && ack.ts != null) latest._ts = ack.ts
            persist(latest, false)
            if (sentEdits === edits) localStorage.removeItem('gym_dirty')
            clearSyncError()
          }
          set({ syncStatus: 'saved' })
        } catch (e) {
          syncError(e)
          if (!blocked(e)) schedulePush(15000)
          throw e
        } finally { inFlight = null }
      })()
      return inFlight
    },
    async pullState() {
      if (get().syncStatus === 'conflict') return
      const uid = get().user?.id
      try {
        if (inFlight) await inFlight
        const { state } = await api('/api/data')
        if (get().user?.id !== uid || get().syncStatus === 'conflict') return
        const S = get().S
        if (dirty()) {
          if (revision(state) > revision(S)) { syncError(conflictError()); return }
          // A delayed read must not turn an acknowledged write into a conflict.
          if (revision(state) === revision(S)) await get().pushState()
          return
        }
        if (state && revision(state) >= revision(S)) {
          persist(Object.assign(clone(DEF), state, { active: S.active }), false)
          clearSyncError()
          set({ syncStatus: 'saved' })
        } else if (!state && hasData(S)) {
          localStorage.setItem('gym_dirty', '1')
          await get().pushState()
        }
      } catch (e) { syncError(e) }
    },

    // Only the confirmed Settings action may discard a retained local draft.
    async reloadServerState() {
      if (recovering) throw new Error('Server reload is already in progress.')
      recovering = true
      clearTimeout(pushTm)
      try {
        if (inFlight) await inFlight.catch(() => {})
        const before = edits
        const { state } = await api('/api/data')
        if (before !== edits) throw new Error('Local data changed during reload. Export a backup and try again.')
        persist(Object.assign(clone(DEF), state || {}, { active: get().S.active }), false)
        localStorage.setItem('gym_state_user', get().user.id)
        localStorage.removeItem('gym_dirty')
        clearSyncError()
        set({ syncStatus: 'saved' })
      } finally { recovering = false }
    },

    async signOut() {
      await get().pushState()
      if (dirty()) throw new Error('Local data changed during sign-out. Your draft is still on this device.')
      const savedEdits = edits
      await api('/api/logout', { method: 'POST', body: '{}' })
      if (dirty() || edits !== savedEdits) throw new Error('Local data changed during sign-out. Your draft is still on this device.')
      clearLocalSession()
    },

    async signOutAll() {
      await get().pushState()
      if (dirty()) throw new Error('Local data changed during sign-out. Your draft is still on this device.')
      const savedEdits = edits
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      if (dirty() || edits !== savedEdits) throw new Error('Local data changed during sign-out. Your draft is still on this device.')
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
