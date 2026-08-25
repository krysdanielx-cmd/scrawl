import { supabase } from './supabase.js';

/**
 * Migration 003 adds notes.content_text (a plain-text mirror of the Tiptap doc)
 * plus trigram indexes. The migration has to be run by hand in the Supabase SQL
 * editor, so the API probes for the column once and degrades gracefully:
 *   - present: content_text is written on save and search runs in Postgres
 *   - absent:  search falls back to filtering fetched docs in the API process
 * Remove this probe once 003 is confirmed applied everywhere.
 */
let cached = null;

export async function hasContentText() {
  if (cached !== null) return cached;
  const { error } = await supabase.from('notes').select('content_text').limit(1);
  // 42703 = undefined_column
  cached = !(error && (error.code === '42703' || /content_text/.test(error.message || '')));
  if (!cached) {
    console.warn('[scrawl] notes.content_text missing; run migration 202608250003_notes_search.sql');
  }
  return cached;
}

export function resetCapabilityCache() {
  cached = null;
}
