import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'vitest'

import { getStateForUid, getUserForUid } from '../src/state.js'

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-state-context-'))
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

describe('request-scoped state helpers', () => {
  test('reads state for the explicit uid instead of OPENGYM_UID', () => {
    const dataDir = tempDataDir()
    const prev = process.env.OPENGYM_UID
    try {
      process.env.OPENGYM_UID = 'user-b'
      writeJson(path.join(dataDir, 'db.json'), {
        users: [
          { id: 'user-a', name: 'A', created: '2026-09-06T00:00:00.000Z' },
          { id: 'user-b', name: 'B', created: '2026-09-06T00:00:00.000Z' }
        ],
        creds: [],
        subs: [],
        invites: []
      })
      writeJson(path.join(dataDir, 'state-user-a.json'), { unit: 'kg', marker: 'A' })
      writeJson(path.join(dataDir, 'state-user-b.json'), { unit: 'lb', marker: 'B' })

      expect(getStateForUid('user-a', { dataDir }).marker).toBe('A')
      expect(getUserForUid('user-a', { dataDir }).name).toBe('A')
    } finally {
      if (prev === undefined) delete process.env.OPENGYM_UID
      else process.env.OPENGYM_UID = prev
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('rejects unsafe explicit uids for request-scoped reads', () => {
    const dataDir = tempDataDir()
    try {
      expect(() => getStateForUid('user/../one', { dataDir })).toThrow(/safe in a filename/)
      expect(() => getUserForUid('user/../one', { dataDir })).toThrow(/safe in a filename/)
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  })

  test('honors an explicit empty dataDir instead of falling back to ambient DATA_DIR', () => {
    expect(getStateForUid('definitely-missing-user', { dataDir: '' })).toBe(null)
  })
})
