'use strict';
// Local proof only. No network clients, implicit retention, or model-driven mutations.
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const CONFIDANTES = Object.freeze(['aline', 'chase']);
const hash = value => createHash('sha256').update(value).digest('hex');
const validPersona = id => CONFIDANTES.includes(id);
const fail = code => { const e = new Error(code); e.code = code; throw e; };
function canConfidanteAccess(memory, memberId, confidanteId) {
  if (!memory || memory.deleted || !validPersona(confidanteId) || memory.memberId !== memberId) return false;
  if (memory.kind === 'relationship' && memory.origin !== confidanteId) return false;
  return memory.scope === 'all' ||
    (memory.scope === 'private' && memory.origin === confidanteId) ||
    (memory.scope === 'selected' && memory.permitted.includes(confidanteId));
}
function openMemoryStore(filename) {
  if (!filename || filename === ':memory:') fail('persistent_path_required');
  // Exclusive creation with restrictive permissions; never truncate existing state.
  try { fs.closeSync(fs.openSync(filename, 'wx', 0o600)); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  fs.chmodSync(filename, 0o600);
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY, credential_hash TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), body TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS memory_member ON memories(member_id);`);
  const member = id => { if (!db.prepare('SELECT id FROM members WHERE id=?').get(id)) fail('unknown_member'); };
  const list = id => { member(id); return db.prepare('SELECT body FROM memories WHERE member_id=? ORDER BY rowid').all(id).map(r => JSON.parse(r.body)); };
  const inspect = (id, memoryId) => { member(id); const row = db.prepare('SELECT body FROM memories WHERE member_id=? AND id=?').get(id,memoryId); if (!row) fail('not_found'); return JSON.parse(row.body); };
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function validate(m) {
    if (typeof m.content !== 'string' || !m.content.trim() || m.content.length > 8000) fail('invalid_content');
    if (!validPersona(m.origin)) fail('invalid_confidante');
    if (!['institutional','relationship'].includes(m.kind)) fail('invalid_kind');
    if (!['private','selected','all'].includes(m.scope)) fail('invalid_scope');
    if (!Array.isArray(m.permitted) || m.permitted.some(p => !validPersona(p))) fail('invalid_scope');
    if (m.scope === 'selected' && !m.permitted.length) fail('invalid_scope');
    if (m.kind === 'relationship' && m.scope !== 'private') fail('relationship_must_be_private');
    if (!Array.isArray(m.parents) || m.parents.some(p => typeof p !== 'string')) fail('invalid_parents');
  }
  function accessible(m, memberId, persona, map, seen = new Set()) {
    if (!canConfidanteAccess(m, memberId, persona) || seen.has(m.id)) return false;
    const next = new Set(seen).add(m.id);
    return m.parents.every(id => accessible(map.get(id), memberId, persona, map, next));
  }
  function retrieve(memberId, persona) {
    if (!validPersona(persona)) fail('invalid_confidante');
    const rows = list(memberId), map = new Map(rows.map(m => [m.id,m]));
    return rows.filter(m => accessible(m, memberId, persona, map));
  }
  function descendants(rows, id) {
    const doomed = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const m of rows) if (!doomed.has(m.id) && m.parents.some(p => doomed.has(p))) { doomed.add(m.id); changed = true; } }
    return doomed;
  }
  const removeIds = (memberId, ids) => { const q = db.prepare('DELETE FROM memories WHERE member_id=? AND id=?'); for (const id of ids) q.run(memberId,id); };
  return {
    enroll() {
      const id = randomUUID(), credential = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO members VALUES(?,?)').run(id,hash(credential));
      return { memberId:id, credential };
    },
    authenticate(credential) {
      if (typeof credential !== 'string' || credential.length > 256) fail('unauthenticated');
      const row = db.prepare('SELECT id FROM members WHERE credential_hash=?').get(hash(credential));
      if (!row) fail('unauthenticated'); return row.id;
    },
    list, inspect, retrieve,
    create(memberId, persona, sessionId, input) {
      member(memberId); if (!validPersona(persona)) fail('invalid_confidante');
      if (input.scope === 'none') return null;
      return transaction(() => {
        const now = new Date().toISOString();
        const m = { id:randomUUID(),memberId,content:input.content,kind:input.kind || 'institutional',origin:persona,
          scope:input.scope,permitted:[...new Set(input.permitted || [])],parents:[...new Set(input.parents || [])],
          source:{type:'member_explicit',sessionId,confidanteId:persona},createdAt:now,updatedAt:now };
        validate(m);
        const available = new Set(retrieve(memberId,persona).map(r => r.id));
        if (m.parents.some(id => !available.has(id))) fail('unauthorized_parent');
        const existing = list(memberId).find(r => ['content','kind','origin','scope','permitted','parents'].every(k => JSON.stringify(r[k]) === JSON.stringify(m[k])));
        if (existing) return existing;
        db.prepare('INSERT INTO memories VALUES(?,?,?)').run(m.id,memberId,JSON.stringify(m)); return m;
      });
    },
    update(memberId,id,patch) {
      if (!patch || Object.keys(patch).some(k => !['content','scope','permitted'].includes(k))) fail('invalid_patch');
      return transaction(() => {
        const before = inspect(memberId,id), after = {...before,...patch,updatedAt:new Date().toISOString()};
        validate(after);
        if (after.content !== before.content) { const ids = descendants(list(memberId),id); ids.delete(id); removeIds(memberId,ids); }
        db.prepare('UPDATE memories SET body=? WHERE id=? AND member_id=?').run(JSON.stringify(after),id,memberId); return after;
      });
    },
    delete(memberId,id) { return transaction(() => { inspect(memberId,id); const ids = descendants(list(memberId),id); removeIds(memberId,ids); return {deletedIds:[...ids]}; }); },
    context(memberId,persona) {
      const rows = retrieve(memberId,persona);
      return {institutional:rows.filter(r => r.kind === 'institutional'),relationship:rows.filter(r => r.kind === 'relationship')};
    },
    close() { db.close(); }
  };
}
module.exports = {openMemoryStore, canConfidanteAccess, validPersona};
