/**
 * Exercises the folder, note, and public-share API against the running server
 * and the REAL Supabase project.
 *
 * Safety rules this file must keep:
 *  - it never creates or deletes a user
 *  - every row it creates is tracked and hard-deleted in the finally block
 *  - it never touches a row it did not create
 * Run with: node server/tests/api-notes.mjs
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createToken } from '../utils/tokens.js';

const BASE = process.env.TEST_BASE || 'http://localhost:8527';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let passed = 0;
const failures = [];
const createdNotes = new Set();
const createdFolders = new Set();

function check(name, condition, detail) {
  if (condition) { passed += 1; console.log(`  ok  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`); }
}

async function call(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

const doc = (...paragraphs) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

async function main() {
  const { data: owner, error } = await supabase.from('users').select('id, email').limit(1).maybeSingle();
  if (error || !owner) throw new Error('No owner row found; cannot test.');
  console.log(`Testing as existing owner ${owner.email} (no user is created or deleted)\n`);
  const token = createToken(owner.id);
  const stamp = Date.now();

  console.log('-- auth boundary');
  for (const path of ['/api/folders', '/api/notes', '/api/notes/recent']) {
    check(`401 without a token on ${path}`, (await call(path)).status === 401);
  }
  check('401 with a garbage token', (await call('/api/notes', { token: 'not.a.jwt' })).status === 401);

  console.log('\n-- folders');
  const baseline = await call('/api/folders', { token });
  check('GET /api/folders returns 200', baseline.status === 200, baseline.payload);
  check('folders carry note_count', baseline.payload.folders.every((f) => typeof f.note_count === 'number'));
  check('totals include all/unfiled/archived', ['all', 'unfiled', 'archived'].every((k) => k in baseline.payload.totals));
  const baselineFolderCount = baseline.payload.folders.length;

  const folderName = `zz-api-test-${stamp}`;
  const created = await call('/api/folders', { token, method: 'POST', body: { name: folderName } });
  check('POST /api/folders returns 201', created.status === 201, created.payload);
  const folderId = created.payload.folder?.id;
  if (folderId) createdFolders.add(folderId);
  check('new folder starts with 0 notes', created.payload.folder?.note_count === 0);

  const dupe = await call('/api/folders', { token, method: 'POST', body: { name: folderName } });
  check('duplicate folder name returns 409', dupe.status === 409, dupe.payload);

  const renamed = await call(`/api/folders/${folderId}`, { token, method: 'PATCH', body: { name: `${folderName}-b` } });
  check('PATCH /api/folders renames', renamed.status === 200 && renamed.payload.folder.name === `${folderName}-b`, renamed.payload);

  const badFolder = await call('/api/folders/not-a-uuid', { token, method: 'PATCH', body: { name: 'x' } });
  check('PATCH with a non-uuid id returns 400', badFolder.status === 400, badFolder.payload);

  const missingFolder = await call('/api/folders/11111111-1111-4111-8111-111111111111', { token, method: 'PATCH', body: { name: 'x' } });
  check('PATCH on a folder that is not mine returns 404', missingFolder.status === 404, missingFolder.payload);

  const longName = await call('/api/folders', { token, method: 'POST', body: { name: 'x'.repeat(200) } });
  check('over-long folder name returns 400', longName.status === 400);

  console.log('\n-- notes crud');
  const noteA = await call('/api/notes', {
    token, method: 'POST',
    body: { title: `zz test alpha ${stamp}`, folder_id: folderId, content: doc('hydrangea seeding plan', 'second line') },
  });
  check('POST /api/notes returns 201', noteA.status === 201, noteA.payload);
  const idA = noteA.payload.note?.id;
  if (idA) createdNotes.add(idA);
  check('created note is unarchived and unpublished', noteA.payload.note?.is_archived === false && noteA.payload.note?.is_published === false);

  const noteB = await call('/api/notes', { token, method: 'POST', body: { title: `zz test beta ${stamp}` } });
  const idB = noteB.payload.note?.id;
  if (idB) createdNotes.add(idB);
  check('note created with no folder is unfiled', noteB.payload.note?.folder_id === null, noteB.payload);

  const single = await call(`/api/notes/${idA}`, { token });
  check('GET /api/notes/:id returns the full doc', single.status === 200 && single.payload.note.content.type === 'doc', single.payload);

  const inFolder = await call(`/api/notes?folder_id=${folderId}`, { token });
  check('folder filter returns only that folder', inFolder.payload.notes.length === 1 && inFolder.payload.notes[0].id === idA, inFolder.payload);
  check('list rows carry a snippet and omit content', 'snippet' in inFolder.payload.notes[0] && !('content' in inFolder.payload.notes[0]));
  check('snippet is built from the doc text', inFolder.payload.notes[0].snippet.includes('hydrangea seeding plan'), inFolder.payload.notes[0]);

  const unfiled = await call('/api/notes?folder_id=unfiled', { token });
  check('unfiled filter finds the unfiled note', unfiled.payload.notes.some((n) => n.id === idB));
  check('unfiled filter excludes the filed note', !unfiled.payload.notes.some((n) => n.id === idA));

  const counted = await call('/api/folders', { token });
  check('folder note_count reflects the new note', counted.payload.folders.find((f) => f.id === folderId)?.note_count === 1, counted.payload.folders);
  check('folder list grew by exactly one', counted.payload.folders.length === baselineFolderCount + 1);

  console.log('\n-- update, pin, move, search');
  const edited = await call(`/api/notes/${idA}`, { token, method: 'PATCH', body: { content: doc('rewritten body about persimmon audits') } });
  check('PATCH content returns 200', edited.status === 200, edited.payload);
  const reread = await call(`/api/notes/${idA}`, { token });
  check('content round-trips', JSON.stringify(reread.payload.note.content).includes('persimmon audits'));

  const pinned = await call(`/api/notes/${idB}`, { token, method: 'PATCH', body: { is_pinned: true } });
  check('PATCH is_pinned returns 200', pinned.status === 200 && pinned.payload.note.is_pinned === true);
  const ordered = await call('/api/notes', { token });
  check('pinned notes sort first', ordered.payload.notes[0]?.is_pinned === true, ordered.payload.notes.slice(0, 2));

  const moved = await call(`/api/notes/${idB}`, { token, method: 'PATCH', body: { folder_id: folderId } });
  check('move to folder returns 200', moved.status === 200 && moved.payload.note.folder_id === folderId);
  const movedBack = await call(`/api/notes/${idB}`, { token, method: 'PATCH', body: { folder_id: null } });
  check('move back to unfiled returns 200', movedBack.status === 200 && movedBack.payload.note.folder_id === null);

  const badMove = await call(`/api/notes/${idB}`, { token, method: 'PATCH', body: { folder_id: '11111111-1111-4111-8111-111111111111' } });
  check('move into a folder I do not own returns 404', badMove.status === 404, badMove.payload);

  const badContent = await call(`/api/notes/${idB}`, { token, method: 'PATCH', body: { content: { type: 'not-a-doc' } } });
  check('a non-doc content payload returns 400', badContent.status === 400, badContent.payload);

  const unknownField = await call(`/api/notes/${idB}`, { token, method: 'PATCH', body: { user_id: owner.id } });
  check('an unexpected field returns 400', unknownField.status === 400, unknownField.payload);

  const search = await call('/api/notes?q=persimmon%20audits', { token });
  check('search finds body text', search.payload.notes.some((n) => n.id === idA), search.payload.notes.map((n) => n.title));
  const titleSearch = await call(`/api/notes?q=${encodeURIComponent(`zz test beta ${stamp}`)}`, { token });
  check('search finds title text', titleSearch.payload.notes.some((n) => n.id === idB));
  const punctuated = await call('/api/notes?q=' + encodeURIComponent('a,b)c"d%'), { token });
  check('search survives PostgREST punctuation', punctuated.status === 200, punctuated.payload);
  const noMatch = await call('/api/notes?q=' + encodeURIComponent(`nothingmatchesthis${stamp}`), { token });
  check('search with no match returns an empty list', noMatch.status === 200 && noMatch.payload.notes.length === 0);

  const recent = await call('/api/notes/recent?limit=5', { token });
  check('GET /api/notes/recent returns 200', recent.status === 200 && Array.isArray(recent.payload.notes));
  check('recent respects the limit', recent.payload.notes.length <= 5);

  console.log('\n-- publish and public reader');
  const published = await call(`/api/notes/${idA}/publish`, { token, method: 'POST' });
  check('POST publish returns 200', published.status === 200, published.payload);
  const slug = published.payload.note?.public_slug;
  check('publish returns a well-formed slug', /^[A-Za-z0-9_-]{12,64}$/.test(slug || ''), slug);

  const again = await call(`/api/notes/${idA}/publish`, { token, method: 'POST' });
  check('publishing twice keeps the same slug', again.payload.note?.public_slug === slug);

  const readerOk = await call(`/api/public/notes/${slug}`);
  check('public reader works with no token', readerOk.status === 200, readerOk.payload);
  check('public payload has title and content', Boolean(readerOk.payload.note?.title) && readerOk.payload.note?.content?.type === 'doc');
  check('public payload leaks no ids or owner', !('user_id' in readerOk.payload.note) && !('id' in readerOk.payload.note), Object.keys(readerOk.payload.note));

  check('bad slug shape returns 404', (await call('/api/public/notes/short')).status === 404);
  check('unknown slug returns 404', (await call('/api/public/notes/aaaaaaaaaaaaaaaaaaaaaa')).status === 404);

  const unpublished = await call(`/api/notes/${idA}/publish`, { token, method: 'DELETE' });
  check('DELETE publish returns 200', unpublished.status === 200 && unpublished.payload.note.is_published === false);
  check('the old link 404s straight after unpublishing', (await call(`/api/public/notes/${slug}`)).status === 404);

  console.log('\n-- archive and restore');
  const republished = await call(`/api/notes/${idA}/publish`, { token, method: 'POST' });
  const slug2 = republished.payload.note.public_slug;
  const archived = await call(`/api/notes/${idA}`, {
    token, method: 'PATCH', body: { is_archived: true },
  });
  check('PATCH is_archived archives the note', archived.status === 200 && archived.payload.note.is_archived === true, archived.payload);
  check('archiving also revokes the public link', archived.payload.note.is_published === false && archived.payload.note.public_slug === null);
  check('the revoked link 404s', (await call(`/api/public/notes/${slug2}`)).status === 404);
  check('the row still exists', (await call(`/api/notes/${idA}`, { token })).status === 200);

  const live = await call('/api/notes', { token });
  check('archived notes are hidden from the live list', !live.payload.notes.some((n) => n.id === idA));
  const archiveList = await call('/api/notes?archived=true', { token });
  check('archived notes appear in the archive list', archiveList.payload.notes.some((n) => n.id === idA));
  const republishBlocked = await call(`/api/notes/${idA}/publish`, { token, method: 'POST' });
  check('publishing an archived note returns 409', republishBlocked.status === 409, republishBlocked.payload);

  const restored = await call(`/api/notes/${idA}`, { token, method: 'PATCH', body: { is_archived: false } });
  check('restore returns the note to the desk', restored.status === 200 && restored.payload.note.is_archived === false);

  console.log('\n-- DELETE really deletes');
  const doomed = await call('/api/notes', { token, method: 'POST', body: { title: 'zz api doomed note' } });
  const doomedId = doomed.payload.note.id;
  createdNotes.add(doomedId);
  const hardDeleted = await call(`/api/notes/${doomedId}`, { token, method: 'DELETE' });
  check('DELETE /api/notes returns 200', hardDeleted.status === 200, hardDeleted.payload);
  check('DELETE reports the id it removed', hardDeleted.payload?.id === doomedId, hardDeleted.payload);
  check('the deleted note 404s afterwards', (await call(`/api/notes/${doomedId}`, { token })).status === 404);
  const { data: goneRow } = await supabase.from('notes').select('id').eq('id', doomedId).maybeSingle();
  check('the row is gone from Postgres, not just hidden', !goneRow, goneRow);
  if (!goneRow) createdNotes.delete(doomedId);
  check('deleting an unknown note is a 404', (await call(`/api/notes/${doomedId}`, { token, method: 'DELETE' })).status === 404);
  // The archived note from the section above must still be intact.
  check('archiving did NOT delete the earlier note', (await call(`/api/notes/${idA}`, { token })).status === 200);

  console.log('\n-- folder delete keeps notes');
  const deleted = await call(`/api/folders/${folderId}`, { token, method: 'DELETE' });
  check('DELETE /api/folders returns 200', deleted.status === 200, deleted.payload);
  if (deleted.status === 200) createdFolders.delete(folderId);
  const orphan = await call(`/api/notes/${idA}`, { token });
  check('its notes survive as unfiled', orphan.status === 200 && orphan.payload.note.folder_id === null, orphan.payload);
  const after = await call('/api/folders', { token });
  check('folder list is back to its baseline size', after.payload.folders.length === baselineFolderCount, after.payload.folders.map((f) => f.name));
}

try {
  await main();
} catch (error) {
  failures.push(`threw: ${error.message}`);
  console.error(error);
} finally {
  // Hard-delete only what this run created. Karen's real notes are untouched.
  for (const id of createdNotes) await supabase.from('notes').delete().eq('id', id);
  for (const id of createdFolders) await supabase.from('folders').delete().eq('id', id);
  console.log(`\ncleaned up ${createdNotes.size} note(s) and ${createdFolders.size} folder(s)`);
  console.log(`\n${passed} passed / ${failures.length} failed`);
  if (failures.length) { console.log('failed:', failures.join(' | ')); process.exit(1); }
}
