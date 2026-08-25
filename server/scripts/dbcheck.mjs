import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
for (const t of ['users','folders','notes','attachments']) {
  const { data, error, count } = await sb.from(t).select('*', { count:'exact' }).limit(3);
  console.log(t, error ? 'ERR ' + error.message : `count=${count}`, error ? '' : JSON.stringify(data?.map(r=>({...r, password_hash: r.password_hash?'<hash>':undefined, content: r.content?'<jsonb>':undefined}))));
}
