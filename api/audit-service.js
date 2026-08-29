import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEYS = new Set([
  'after',
  'before',
  'hash',
  'raw_token',
  'secret',
  'state',
  'token'
]);

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    out[key] = scrub(child);
  }
  return out;
}

export function createAuditService({ dataDir }) {
  const auditFile = path.join(dataDir, 'audit.log');

  function appendAuditEvent(event) {
    const safeEvent = {
      timestamp: new Date().toISOString(),
      ...scrub(event)
    };
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    fs.appendFileSync(auditFile, JSON.stringify(safeEvent) + '\n', { mode: 0o600 });
    return safeEvent;
  }

  function readAuditEvents() {
    try {
      const text = fs.readFileSync(auditFile, 'utf8').trim();
      if (!text) return [];
      return text.split('\n').map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  return { auditFile, appendAuditEvent, readAuditEvents };
}
