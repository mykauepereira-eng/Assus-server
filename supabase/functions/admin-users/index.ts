// admin-users: cria o primeiro administrador e, depois, os usuários da equipe.
// Ações: bootstrap (só quando o banco está vazio), create, reset, ativo.
import { admin, cors, json, quemChama } from './_compartilhado.ts';

const emailOk = (e: unknown) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const senhaOk = (p: unknown) => typeof p === 'string' && p.length >= 6;

async function acharPorEmail(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }
  const acao = String(b.action ?? '');
  const email = String(b.email ?? '').trim().toLowerCase();
  const nome = String(b.nome ?? '').trim().slice(0, 120);

  try {
    if (acao === 'bootstrap') {
      const { count, error: ce } = await admin.from('profiles').select('id', { count: 'exact', head: true });
      if (ce) throw ce;
      if ((count ?? 0) > 0) return json({ error: 'O sistema já foi configurado.' }, 409);
      if (!emailOk(email)) return json({ error: 'E-mail inválido.' }, 400);
      if (!senhaOk(b.password)) return json({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password: String(b.password), email_confirm: true, user_metadata: { nome } });
      if (error) {
        if (!/already|registered|exists/i.test(error.message)) return json({ error: error.message }, 400);
        const u = await acharPorEmail(email);
        if (!u) return json({ error: 'Não foi possível localizar o usuário.' }, 400);
        await admin.auth.admin.updateUserById(u.id, { password: String(b.password), email_confirm: true, user_metadata: { ...(u.user_metadata ?? {}), nome } });
        return json({ id: u.id });
      }
      return json({ id: data.user!.id });
    }

    const eu = await quemChama(req);
    if (!eu) return json({ error: 'Entre no sistema para continuar.' }, 401);
    if (!eu.admin) return json({ error: 'Somente o administrador pode fazer isso.' }, 403);

    if (acao === 'create') {
      if (!emailOk(email)) return json({ error: 'E-mail inválido.' }, 400);
      if (!senhaOk(b.password)) return json({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password: String(b.password), email_confirm: true, user_metadata: { nome, troca: true } });
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'Este e-mail já está cadastrado.' : error.message }, 400);
      return json({ id: data.user!.id });
    }
    if (acao === 'reset') {
      const id = String(b.id ?? '');
      if (!senhaOk(b.password)) return json({ error: 'A senha precisa ter pelo menos 6 caracteres.' }, 400);
      const { data: u, error: ge } = await admin.auth.admin.getUserById(id);
      if (ge || !u.user) return json({ error: 'Usuário não encontrado.' }, 404);
      const { error } = await admin.auth.admin.updateUserById(id, { password: String(b.password), user_metadata: { ...(u.user.user_metadata ?? {}), troca: true } });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    if (acao === 'ativo') {
      const id = String(b.id ?? '');
      if (id === eu.id) return json({ error: 'Você não pode desativar o próprio usuário.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: b.on ? 'none' : '876000h' });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Erro inesperado.' }, 500);
  }
});
