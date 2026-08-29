import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAuditService } from '../audit-service.js';

function withTempAuditService(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-audit-service-'));
  try {
    const audit = createAuditService({ dataDir });
    fn(audit);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('appendAuditEvent writes one parseable JSONL event with a timestamp', () => {
  withTempAuditService(audit => {
    const event = audit.appendAuditEvent({
      uid: 'u1',
      actor: 'mcp-token:tok_1',
      action: 'override_day',
      revision_before: 1,
      revision_after: 2,
      details: { date: '2026-08-29' }
    });

    const lines = fs.readFileSync(audit.auditFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(typeof event.timestamp, 'string');
    assert.deepEqual(JSON.parse(lines[0]), event);
  });
});

test('appendAuditEvent recursively strips sensitive fields and state snapshots', () => {
  withTempAuditService(audit => {
    const event = audit.appendAuditEvent({
      uid: 'u1',
      actor: 'mcp-token:tok_1',
      action: 'edit_routine',
      token_id: 'tok_1',
      token: 'ogmcp_tok_1_secret',
      raw_token: 'ogmcp_tok_1_secret',
      secret: 'secret',
      hash: 'hash',
      state: { unit: 'kg' },
      before: { week: {} },
      after: { week: { 1: 'r1' } },
      details: {
        changed: true,
        token: 'nested-token',
        raw_token: 'nested-raw-token',
        secret: 'nested-secret',
        hash: 'nested-hash',
        state: { routines: [] },
        before: { name: 'Old' },
        after: { name: 'New' }
      }
    });

    assert.equal(event.token_id, 'tok_1');
    const json = JSON.stringify(event);
    assert.equal(json.includes('ogmcp_'), false);
    assert.equal(json.includes('secret'), false);
    assert.equal(json.includes('nested-token'), false);
    assert.equal(json.includes('"state"'), false);
    assert.equal(json.includes('"before"'), false);
    assert.equal(json.includes('"after"'), false);
    assert.equal(json.includes('"hash"'), false);
  });
});
