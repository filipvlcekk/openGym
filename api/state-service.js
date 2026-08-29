import fs from 'node:fs';
import path from 'node:path';

function safeUid(uid) {
  return String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function currentRevisionOf(state) {
  const revision = Number(state?._revision || 0);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function createStateService({ dataDir, audit = null }) {
  const stateFile = uid => path.join(dataDir, 'state-' + safeUid(uid) + '.json');
  const lockFile = uid => path.join(dataDir, 'locks', 'state-' + safeUid(uid) + '.lock');

  function readUserState(uid) {
    try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
  }

  function withUserStateLock(uid, operation, fn, options = {}) {
    const file = lockFile(uid);
    const timeoutMs = Math.max(0, options.timeoutMs ?? 5000);
    const staleMs = Math.max(1, options.staleMs ?? 30000);
    const deadline = Date.now() + timeoutMs;
    fs.mkdirSync(path.dirname(file), { recursive: true });

    while (true) {
      let fd;
      try {
        fd = fs.openSync(file, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify({
          pid: process.pid,
          uid: safeUid(uid),
          operation,
          created_at: new Date().toISOString()
        }));
        try {
          return fn();
        } finally {
          try { fs.closeSync(fd); } catch {}
          try { fs.unlinkSync(file); } catch {}
        }
      } catch (e) {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch {}
        }
        if (e?.code !== 'EEXIST') throw e;
        try {
          const stat = fs.statSync(file);
          if (Date.now() - stat.mtimeMs > staleMs) {
            fs.unlinkSync(file);
            continue;
          }
        } catch (statError) {
          if (statError?.code === 'ENOENT') continue;
          throw statError;
        }
        if (Date.now() >= deadline) {
          return {
            ok: false,
            error: {
              code: 'STATE_LOCKED',
              message: 'State is currently being written. Try again shortly.'
            }
          };
        }
        sleepSync(25);
      }
    }
  }

  function updateUserState(uid, mutation, options = {}) {
    return withUserStateLock(uid, options.operation || 'state-write', () => {
      const current = readUserState(uid) || {};
      const currentRevision = currentRevisionOf(current);
      if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
        return {
          ok: false,
          error: {
            code: 'STATE_CONFLICT',
            message: 'State changed since the tool read it.',
            current_revision: currentRevision
          }
        };
      }

      const draft = JSON.parse(JSON.stringify(current));
      const mutated = mutation(draft);
      const next = { ...(mutated && typeof mutated === 'object' ? mutated : draft) };
      delete next.active;
      next._revision = currentRevision + 1;
      atomicWrite(stateFile(uid), JSON.stringify(next));
      audit?.appendAuditEvent({
        uid: safeUid(uid),
        actor: options.actor || 'unknown',
        action: options.operation || 'state-write',
        token_id: options.tokenId || undefined,
        revision_before: currentRevision,
        revision_after: next._revision,
        details: options.details || undefined
      });
      return { ok: true, revision: next._revision, ts: next._ts || null };
    }, options.lock);
  }

  function replaceUserState(uid, state, options = {}) {
    const result = updateUserState(uid, () => state, { ...options, operation: options.operation || 'replace-state' });
    if (!result.ok) return result;
    return { ok: true, ts: result.ts };
  }

  return { stateFile, lockFile, readUserState, updateUserState, replaceUserState, atomicWrite };
}
