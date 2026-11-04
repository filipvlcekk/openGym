import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createTokenService } from '../../api/token-service.js'

let dataDir, clients
const args = () => ({ from: '2026-11-04', to: '2026-11-04', expected_revision: 7,
  new_routines: [{ id: 'nov-a', name: 'A', exercises: [{ exercise_id: '0043', target: { sets: 2, repsMin: 6, repsMax: 8 } }] }],
  days: [{ date: '2026-11-04', routine_id: 'nov-a' }] })
async function connect(token) {
  const client = new Client({ name: 'plan-stdio-test', version: '1.0.0' })
  clients.push(client)
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.js', import.meta.url))],
    env: { ...process.env, OPENGYM_DATA: dataDir, OPENGYM_UID: 'user-a', OPENGYM_MCP_TOKEN: token },
    stderr: 'pipe'
  }))
  return client
}
const result = async (client, name, input) => JSON.parse((await client.callTool({ name, arguments: input })).content[0].text)
beforeEach(() => {
  clients = []
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-plan-stdio-'))
  fs.writeFileSync(path.join(dataDir, 'state-user-a.json'), JSON.stringify({ _revision: 7, routines: [], week: {}, dayPlan: {}, workouts: [], exWeights: {} }))
})
afterEach(async () => {
  await Promise.all(clients.map(client => client.close()))
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('real stdio SDK previews and commits the same stable proposal, then rereads it', async () => {
  const created = createTokenService({ dataDir }).createToken({ uid: 'user-a', scopes: ['state:read', 'plan:write'] })
  const client = await connect(created.token)
  expect((await client.listTools()).tools).toHaveLength(21)
  const p = await result(client, 'apply_training_plan', args())
  expect(p).toMatchObject({ ok: true, dry_run: true, revision: 7 })
  expect(fs.existsSync(path.join(dataDir, 'audit.log'))).toBe(false)
  expect(await result(client, 'apply_training_plan', { ...args(), dry_run: false, preview_hash: p.preview_hash })).toMatchObject({ ok: true, revision_after: 8 })
  expect(await result(client, 'get_training_plan', { from: args().from, to: args().to })).toMatchObject({ revision: 8, days: [{ routine_id: 'nov-a' }] })
  const invalid = await client.callTool({ name: 'apply_training_plan', arguments: { ...args(), unexpected: true } })
  expect(invalid.isError).toBe(true)
  createTokenService({ dataDir }).revokeToken(created.record.id, 'user-a')
  expect(await result(client, 'apply_training_plan', args())).toMatchObject({ ok: false, error: { code: 'TOKEN_REVOKED' } })
})

test('real stdio SDK refuses plan writes with a read-only token', async () => {
  const created = createTokenService({ dataDir }).createToken({ uid: 'user-a', scopes: ['state:read'] })
  const client = await connect(created.token)
  expect(await result(client, 'apply_training_plan', args())).toMatchObject({ ok: false, error: { code: 'TOKEN_FORBIDDEN', required_scope: 'plan:write' } })
  expect(fs.existsSync(path.join(dataDir, 'audit.log'))).toBe(false)
})
