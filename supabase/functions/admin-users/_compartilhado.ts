// Utilidades usadas pelas funções do sistema (copiadas em cada função na publicação)
import { createClient } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
export const json = (b: unknown, s = 200, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', ...h } });

function chaveSecreta(): string {
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'); if (k.default) return k.default; } catch { /* usa a antiga */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), { auth: { persistSession: false, autoRefreshToken: false } });

// pessoa logada e ativa (a partir do token da sessão)
export async function quemChama(req: Request) {
  const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!tok || tok.startsWith('sb_')) return null;
  const { data, error } = await admin.auth.getUser(tok);
  if (error || !data.user) return null;
  const { data: p } = await admin.from('profiles').select('id,admin,ativo,nome').eq('id', data.user.id).maybeSingle();
  if (!p || !p.ativo) return null;
  return p as { id: string; admin: boolean; ativo: boolean; nome: string };
}
export const igual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
