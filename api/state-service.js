import fs from 'node:fs';
import path from 'node:path';

function safeUid(uid) {
  return String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function createStateService({ dataDir }) {
  const stateFile = uid => path.join(dataDir, 'state-' + safeUid(uid) + '.json');

  function readUserState(uid) {
    try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
  }

  function replaceUserState(uid, state) {
    const next = { ...state };
    delete next.active;
    atomicWrite(stateFile(uid), JSON.stringify(next));
    return { ok: true, ts: next._ts || null };
  }

  return { stateFile, readUserState, replaceUserState, atomicWrite };
}
