// leads: porta de entrada de leads de fora (site, Meta Lead Ads, Zapier/Make, portais).
// POST com JSON ou formulário: token, nome, tel, email, origem, interesse, veiculo, orcamento, mensagem.
// GET com hub.mode=subscribe: verificação do webhook da Meta (use o mesmo token).
import { admin, cors, igual, json } from './_compartilhado.ts';

async function tokenOk(t: string) {
  if (!t) return false;
  const { data } = await admin.from('app_segredos').select('valor').eq('nome', 'leads').maybeSingle();
  return !!data && igual(String(data.valor), t);
}
const pega = (o: Record<string, unknown>, ...ks: string[]) => {
  for (const k of ks) { const v = o[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
  return '';
};

async function assinaturaMetaOk(req: Request, corpo: string) {
  const seg = Deno.env.get('META_APP_SECRET');
  if (!seg) return true; // sem segredo configurado, confia no token da URL
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(seg), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(corpo)));
  const hex = 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return igual(hex, sig);
}

async function leadDaMeta(leadgenId: string) {
  const tk = Deno.env.get('META_PAGE_TOKEN');
  if (!tk) throw new Error('Configure o segredo META_PAGE_TOKEN para buscar os dados do lead.');
  const v = Deno.env.get('META_GRAPH_VERSION') ?? 'v23.0';
  const r = await fetch(`https://graph.facebook.com/${v}/${encodeURIComponent(leadgenId)}?fields=field_data,platform,form_id,ad_name&access_token=${encodeURIComponent(tk)}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message ?? 'Falha ao buscar o lead na Meta.');
  const f: Record<string, string> = {};
  for (const x of d.field_data ?? []) f[String(x.name)] = String((x.values ?? [])[0] ?? '');
  return {
    nome: f.full_name || [f.first_name, f.last_name].filter(Boolean).join(' '),
    tel: f.phone_number || f.telefone || '', email: f.email || '',
    interesse: f.modelo || f.veiculo || f.interesse || '', origem: d.platform === 'ig' ? 'instagram' : 'facebook',
    canal: 'meta_lead_ads', ref: String(d.form_id ?? ''), mensagem: d.ad_name ? 'Anúncio: ' + d.ad_name : '',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const modo = url.searchParams.get('hub.mode'), tk = url.searchParams.get('hub.verify_token') ?? '', ch = url.searchParams.get('hub.challenge');
    if (modo === 'subscribe' && ch) return (await tokenOk(tk)) ? new Response(ch, { headers: { 'Content-Type': 'text/plain' } }) : new Response('token inválido', { status: 403 });
    return json({ ok: true, uso: 'Envie POST com token, nome, tel ou email, origem, interesse, veiculo, orcamento, mensagem.' });
  }
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const corpo = await req.text();
  if (corpo.length > 20000) return json({ error: 'Conteúdo grande demais.' }, 413);
  const tipo = req.headers.get('content-type') ?? '';
  let b: Record<string, unknown> = {};
  try {
    if (tipo.includes('application/json')) b = JSON.parse(corpo || '{}');
    else b = Object.fromEntries(new URLSearchParams(corpo));
  } catch { return json({ error: 'Corpo inválido.' }, 400); }

  try {
    // Meta Lead Ads (webhook da página)
    if (b.object === 'page' && Array.isArray(b.entry)) {
      if (!(await tokenOk(url.searchParams.get('token') ?? ''))) return json({ error: 'Token inválido.' }, 401);
      if (!(await assinaturaMetaOk(req, corpo))) return json({ error: 'Assinatura inválida.' }, 401);
      const res = [];
      for (const e of b.entry as Array<Record<string, unknown>>) for (const c of (e.changes as Array<Record<string, any>>) ?? []) {
        if (c.field !== 'leadgen' || !c.value?.leadgen_id) continue;
        const d = await leadDaMeta(String(c.value.leadgen_id));
        const { data, error } = await admin.rpc('criar_lead_externo', { p: d });
        res.push(error ? { erro: error.message } : data);
      }
      return json({ ok: true, leads: res });
    }

    // site, Zapier, Make, RD Station, portais
    // limite por origem: no máximo 20 envios a cada 10 minutos (contra robôs e tentativa de adivinhar o token)
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'sem-ip';
    const { data: livre } = await admin.rpc('conta_limite', { p_chave: 'lead:' + ip, p_max: 20, p_seg: 600 });
    if (livre === false) return json({ error: 'Muitos envios seguidos. Tente de novo em alguns minutos.' }, 429);
    const token = pega(b, 'token') || req.headers.get('x-token') || url.searchParams.get('token') || '';
    if (!(await tokenOk(token))) return json({ error: 'Token inválido.' }, 401);
    if (pega(b, 'website', 'site_url')) return json({ ok: true }); // campo-isca contra robôs
    const p = {
      nome: pega(b, 'nome', 'name', 'full_name'), tel: pega(b, 'tel', 'telefone', 'phone', 'whatsapp', 'celular'),
      email: pega(b, 'email', 'e-mail'), origem: pega(b, 'origem', 'source', 'utm_source') || 'site',
      interesse: pega(b, 'interesse', 'modelo', 'veiculo_interesse'), veiculo: pega(b, 'veiculo', 'placa', 'codigo'),
      orcamento: pega(b, 'orcamento', 'budget'), mensagem: pega(b, 'mensagem', 'message', 'msg', 'comentario'),
      canal: pega(b, 'canal') || 'webhook', ref: pega(b, 'ref', 'utm_campaign'),
      consentimento: ['1', 'true', 'on', 'sim'].includes(pega(b, 'consentimento', 'consent', 'lgpd').toLowerCase()),
    };
    const { data, error } = await admin.rpc('criar_lead_externo', { p });
    if (error) return json({ error: error.message }, 400);
    // volta para a página do próprio site que enviou (nunca para outro endereço)
    const volta = pega(b, 'redirect', 'voltar');
    const de = req.headers.get('origin') || req.headers.get('referer') || '';
    const host = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
    if (volta && /^https:\/\//i.test(volta) && host(volta) && host(volta) === host(de)) return new Response(null, { status: 303, headers: { ...cors, Location: volta } });
    return json(data);
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Erro inesperado.' }, 500);
  }
});
