// atendente: Atendente IA do Sistema da Concessionária (tela 2206).
// Recebe WhatsApp (Cloud API), Instagram e Facebook Messenger num endereço só, responde com o Claude
// usando o estoque real e passa a conversa para um vendedor quando precisa. O vendedor sempre manda:
// quando ele responde, o robô se cala naquela conversa.
//
// Segredos (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   chave da API da Claude (Console da Claude, com limite mensal de gasto)
//   META_APP_SECRET     segredo do app da Meta (confere a assinatura de cada chamada)
//   META_PAGE_TOKEN     token permanente da Página (responde no Messenger e no Instagram)
//   WA_TOKEN, WA_PHONE_ID  token e id do número do WhatsApp Cloud API
//   META_APP_ID         opcional: id do app, para separar ecos do robô das respostas da equipe
//   META_GRAPH_VERSION  opcional (padrão v23.0) · ATD_MODELO opcional (padrão claude-haiku-5-5)
//
// GET  ?hub.mode=subscribe…  verificação do webhook pela Meta (token de 2206)
// GET                         diagnóstico público, sem dados da loja
// POST da Meta                mensagens (responde 200 na hora e trabalha em segundo plano)
// POST da equipe {acao}       status | simular | simular_novo | roteiro | enviar | assumir | devolver | encerrar | lida | apagar
// deno-lint-ignore-file no-explicit-any
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { admin, cors, igual, json, quemChama } from './_compartilhado.ts';
import { AtdRegras as A } from './regras.js';
import { assinatura, iguais, lerEventos, lerJson, temLeadgen, type Entrada } from './nucleo.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const ESPERA_MS = 8000; // junta a rajada de mensagens curtas numa resposta só
const GV = () => Deno.env.get('META_GRAPH_VERSION') ?? 'v23.0';
const MODELO = () => Deno.env.get('ATD_MODELO') || A.MODELO;
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
const daqui = (h: number) => new Date(Date.now() + h * 3600e3).toISOString();
const agoraISO = () => new Date().toISOString();
const canalN = (c: string) => (A.CANAIS as Record<string, string>)[c] ?? c;
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e ?? 'erro')).slice(0, 300);
function segundoPlano(p: Promise<unknown>) {
  const w = p.catch((e) => console.error('atendente:', msgErro(e)));
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(w);
}

// ---------- contexto: configuração de 2206, dados da loja e estoque ----------
async function contexto() {
  const { data } = await admin.from('docs').select('id,data').eq('coll', 'conf').in('id', ['integ', 'cfgs']);
  const integ = data?.find((x) => x.id === 'integ')?.data ?? {};
  const loja = data?.find((x) => x.id === 'cfgs')?.data ?? {};
  const c = A.conf(integ.atd);
  let carros: any[] = [];
  if (c.estoque) {
    const { data: cs } = await admin.from('docs').select('data').eq('coll', 'carros').eq('data->>st', 'disp');
    carros = (cs ?? []).map((x: any) => x.data);
  }
  return { c, loja, carros };
}
type Ctx = Awaited<ReturnType<typeof contexto>>;

// ---------- cérebro: Claude com a base da loja e as últimas mensagens ----------
let cliente: Anthropic | null = null;
function claude() {
  const k = Deno.env.get('ANTHROPIC_API_KEY');
  if (!k) throw new Error('Falta a chave da Claude: grave o segredo ANTHROPIC_API_KEY no Supabase.');
  return (cliente ??= new Anthropic({ apiKey: k, maxRetries: 2, timeout: 45_000 }));
}
async function pensar(ctx: Ctx, msgs: Array<{ autor: string; texto: string }>) {
  const hist = A.historico(msgs);
  if (!hist.length || hist[hist.length - 1].role !== 'user') throw new Error('Não há mensagem do cliente para responder.');
  const r = await claude().messages.create({
    model: MODELO(),
    max_tokens: 2048,
    system: [
      { type: 'text', text: A.sistema(ctx.c, ctx.loja.empresa) },
      { type: 'text', text: 'BASE\n' + A.baseTexto(ctx.loja, ctx.carros, ctx.c), cache_control: { type: 'ephemeral' } },
    ],
    messages: hist as Anthropic.MessageParam[],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: A.ESQUEMA } },
  });
  const uso = { entrada: r.usage.input_tokens ?? 0, saida: r.usage.output_tokens ?? 0, cache: r.usage.cache_read_input_tokens ?? 0 };
  if (r.stop_reason === 'refusal') return { saida: A.decidir({ transferir: true, motivo: 'O atendente recusou responder esta mensagem.' }, ctx.c), uso };
  if (r.stop_reason === 'max_tokens') return { saida: A.decidir({ transferir: true, motivo: 'A resposta do atendente ficou incompleta.' }, ctx.c), uso };
  const txt = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const obj = lerJson(txt);
  if (!obj) return { saida: A.decidir({ transferir: true, motivo: 'O atendente devolveu uma resposta fora do formato.' }, ctx.c), uso };
  return { saida: A.decidir(obj, ctx.c), uso };
}
async function usoDoMes() {
  const mes = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  const { data } = await admin.from('atd_uso').select('*').eq('mes', mes).maybeSingle();
  return data ?? { mes, respostas: 0, entrada: 0, saida: 0, cache: 0 };
}

// ---------- envio pelo canal da conversa ----------
async function enviarCanal(cv: any, texto: string): Promise<string | null> {
  if (cv.canal === 'teste') return null;
  if (cv.canal === 'whatsapp') {
    const tk = Deno.env.get('WA_TOKEN'), ph = Deno.env.get('WA_PHONE_ID');
    if (!tk || !ph) throw new Error('WhatsApp não configurado: grave WA_TOKEN e WA_PHONE_ID no Supabase.');
    const r = await fetch(`https://graph.facebook.com/${GV()}/${encodeURIComponent(ph)}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: cv.externo, type: 'text', text: { preview_url: false, body: texto } }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error?.message ?? 'O WhatsApp recusou o envio.');
    return d?.messages?.[0]?.id ?? null;
  }
  const tk = Deno.env.get('META_PAGE_TOKEN');
  if (!tk) throw new Error('Página não configurada: grave META_PAGE_TOKEN no Supabase.');
  const r = await fetch(`https://graph.facebook.com/${GV()}/me/messages?access_token=${encodeURIComponent(tk)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: cv.externo }, messaging_type: 'RESPONSE', message: { text: texto } }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message ?? 'A Meta recusou o envio.');
  return d?.message_id ?? null;
}
// nome do contato no Messenger/Instagram (a Meta não manda no webhook)
async function nomeMeta(cv: any) {
  const tk = Deno.env.get('META_PAGE_TOKEN');
  if (!tk || cv.canal === 'whatsapp' || cv.nome) return;
  try {
    const campos = cv.canal === 'instagram' ? 'name,username' : 'first_name,last_name';
    const r = await fetch(`https://graph.facebook.com/${GV()}/${encodeURIComponent(cv.externo)}?fields=${campos}&access_token=${encodeURIComponent(tk)}`);
    if (!r.ok) return;
    const d = await r.json();
    const nome = String(d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || d.username || '').slice(0, 120);
    if (nome) await admin.from('atd_conversas').update({ nome }).eq('id', cv.id).eq('nome', '');
  } catch { /* sem nome: segue */ }
}
async function registrar(acao: string, eu: { id: string; nome: string } | null, alvo = '') {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  await admin.from('docs').insert({ coll: 'aud', id, data: { id, t: Date.now(), u: eu?.id ?? '', un: eu?.nome ?? 'Atendente IA', tela: '2206', acao, alvo } });
}

// ---------- uma resposta do robô (depois da rajada) ----------
async function responder(convId: string, msgId: number, o: { esperar?: boolean; forcar?: boolean } = {}) {
  if (o.esperar !== false) await dorme(ESPERA_MS);
  const { data: depois } = await admin.from('atd_mensagens').select('id').eq('conversa', convId).eq('dir', 'in').gt('id', msgId).limit(1);
  if (depois?.length) return null; // chegou outra mensagem: a próxima tarefa responde tudo junto
  const { data: cv } = await admin.from('atd_conversas').select('*').eq('id', convId).single();
  const ctx = await contexto();
  if (!cv || (!o.forcar && !A.deveResponder(cv, ctx.c, Date.now()))) return null;
  const { data: ult } = await admin.from('atd_mensagens').select('id,autor,texto').eq('conversa', convId).order('id', { ascending: false }).limit(A.HIST);
  const msgs = (ult ?? []).reverse();
  if (!msgs.length || msgs[msgs.length - 1].autor !== 'cliente') return null; // alguém já respondeu

  let saida: any, uso: any = null, erro = '';
  const mes = await usoDoMes();
  if (mes.respostas >= ctx.c.limiteMes) saida = A.decidir({ transferir: true, motivo: 'Limite de respostas automáticas do mês atingido (ajuste em 2206).' }, ctx.c);
  else {
    try { ({ saida, uso } = await pensar(ctx, msgs)); } catch (e) {
      erro = msgErro(e);
      saida = A.decidir({ transferir: true, motivo: 'Atendente automático indisponível: ' + erro }, ctx.c);
    }
  }
  if (uso) await admin.rpc('atd_contar', { p_in: uso.entrada, p_out: uso.saida, p_cache: uso.cache });

  let metaId: string | null = null, falha = '';
  try { metaId = await enviarCanal(cv, saida.mensagem); } catch (e) { falha = msgErro(e); }
  await admin.from('atd_mensagens').insert({ conversa: convId, dir: 'out', autor: 'robo', texto: saida.mensagem, meta_id: metaId,
    info: { transferir: saida.transferir, motivo: saida.motivo, lead: saida.lead, uso, erro, falha, modelo: uso ? MODELO() : '' } });
  if (falha) await admin.from('atd_mensagens').insert({ conversa: convId, dir: 'out', autor: 'sistema', texto: 'A mensagem acima não chegou ao cliente: ' + falha });

  const dados = { ...(cv.dados ?? {}) };
  for (const [k, v] of Object.entries(saida.lead)) if (v) dados[k] = v;
  const upd: Record<string, unknown> = { ultima: agoraISO(), dados, temperatura: saida.lead.temperatura || cv.temperatura, resumo: saida.lead.resumo || cv.resumo };
  const transf = saida.transferir || !!falha;
  if (transf) Object.assign(upd, { estado: 'transferido', motivo: falha ? 'A mensagem não chegou ao cliente: ' + falha : saida.motivo, pausado_ate: daqui(ctx.c.pausaH) });
  await admin.from('atd_conversas').update(upd).eq('id', convId);

  let lead: any = null;
  if (cv.canal !== 'teste') {
    const r = await admin.rpc('atd_lead', { p_conv: convId, p: { ...dados, transferir: transf, motivo: upd.motivo ?? '' } });
    if (r.error) console.error('atendente: lead', r.error.message); else lead = r.data;
  }
  return { saida, uso, erro, falha, lead };
}

// ---------- mensagens da Meta ----------
async function receber(ev: Entrada, ctx: Ctx) {
  if (ev.eco) {
    // eco da Página: se foi o próprio robô (id já gravado ou texto igual há pouco), ignora; se foi alguém da equipe, o robô se cala
    const { data: ja } = await admin.from('atd_mensagens').select('id').eq('meta_id', ev.metaId).maybeSingle();
    if (ja) return;
    const app = Deno.env.get('META_APP_ID');
    if (app && ev.appId === app) return;
    const { data: cv0 } = await admin.from('atd_conversas').select('id').eq('canal', ev.canal).eq('externo', ev.externo).maybeSingle();
    if (cv0) {
      await dorme(1500); // o envio do robô pode estar gravando o id agora
      const { data: ja2 } = await admin.from('atd_mensagens').select('id').eq('meta_id', ev.metaId).maybeSingle();
      if (ja2) return;
      const { data: rb } = await admin.from('atd_mensagens').select('texto,em').eq('conversa', cv0.id).eq('autor', 'robo').order('id', { ascending: false }).limit(1).maybeSingle();
      if (rb && rb.texto === ev.texto && Date.now() - new Date(rb.em).getTime() < 120e3) return;
    }
  }
  const { data: r, error } = await admin.rpc('atd_entrada', { p: { canal: ev.canal, externo: ev.externo, nome: ev.nome, tel: ev.tel, texto: ev.texto, meta_id: ev.metaId, eco: ev.eco, pausa_h: ctx.c.pausaH } });
  if (error) throw new Error(error.message);
  if (!r || r.dup || r.eco) return;
  const { data: cv } = await admin.from('atd_conversas').select('*').eq('id', r.conversa).single();
  if (cv) await nomeMeta(cv);
  if (cv && A.deveResponder(cv, ctx.c, Date.now())) await responder(r.conversa, r.msg);
}
async function webhookMeta(req: Request, corpo: string, url: URL) {
  const seg = Deno.env.get('META_APP_SECRET');
  if (seg) {
    if (!iguais(await assinatura(seg, corpo), req.headers.get('x-hub-signature-256') ?? '')) return json({ error: 'Assinatura inválida.' }, 401);
  } else if (!(await tokenOk(url.searchParams.get('token') ?? ''))) {
    return json({ error: 'Configure META_APP_SECRET ou use ?token= no endereço.' }, 401);
  }
  const b = lerJson(corpo);
  if (!b) return json({ error: 'Corpo inválido.' }, 400);
  if (temLeadgen(b)) segundoPlano(repassarLeads(req, corpo));
  const evs = lerEventos(b);
  if (evs.length) segundoPlano((async () => {
    const ctx = await contexto();
    // em ordem dentro de cada conversa, em paralelo entre conversas diferentes
    const porConversa = new Map<string, Entrada[]>();
    for (const ev of evs) { const k = ev.canal + ':' + ev.externo; porConversa.set(k, [...(porConversa.get(k) ?? []), ev]); }
    await Promise.all([...porConversa.values()].map(async (lista) => {
      for (const ev of lista) await receber(ev, ctx).catch((e) => console.error('atendente:', msgErro(e)));
    }));
  })());
  return json({ ok: true, mensagens: evs.length }); // 200 na hora: a Meta não reenvia
}
// formulários de Lead Ads chegam pelo mesmo endereço da Página: vão para a função "leads", com a mesma assinatura
async function repassarLeads(req: Request, corpo: string) {
  const { data } = await admin.from('app_segredos').select('valor').eq('nome', 'leads').maybeSingle();
  if (!data) return;
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/leads?token=${encodeURIComponent(data.valor)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': req.headers.get('x-hub-signature-256') ?? '' }, body: corpo,
  });
}
async function tokenOk(t: string) {
  if (!t) return false;
  const { data } = await admin.from('app_segredos').select('valor').eq('nome', 'atendente').maybeSingle();
  return !!data && igual(String(data.valor), t);
}

// ---------- ações da equipe (tela 2206) ----------
async function equipe(req: Request, b: Record<string, any>) {
  const eu = await quemChama(req);
  if (!eu) return json({ error: 'Entre no sistema para continuar.' }, 401);
  const { data: p } = await admin.from('profiles').select('rd,wr').eq('id', eu.id).maybeSingle();
  const le = eu.admin || (p?.rd ?? []).includes('22'), grava = eu.admin || (p?.wr ?? []).includes('22');
  if (!le) return json({ error: 'Seu cargo não acessa o CRM.' }, 403);
  const acao = String(b.acao ?? '');

  if (acao === 'status') {
    const ctx = await contexto(), mes = await usoDoMes();
    return json({
      modelo: MODELO(), claude: !!Deno.env.get('ANTHROPIC_API_KEY'), assinatura: !!Deno.env.get('META_APP_SECRET'),
      pagina: !!Deno.env.get('META_PAGE_TOKEN'), whatsapp: !!(Deno.env.get('WA_TOKEN') && Deno.env.get('WA_PHONE_ID')),
      ligado: ctx.c.on, canais: ctx.c.canais, uso: mes, limite: ctx.c.limiteMes, carros: A.carrosVenda(ctx.carros).length,
    });
  }
  if (!grava) return json({ error: 'Seu cargo só pode ver as conversas.' }, 403);

  if (acao === 'simular' || acao === 'simular_novo') {
    const externo = 'u:' + eu.id;
    if (acao === 'simular_novo') { await admin.from('atd_conversas').delete().eq('canal', 'teste').eq('externo', externo); return json({ ok: true }); }
    const texto = String(b.texto ?? '').trim().slice(0, 1000);
    if (!texto) return json({ error: 'Escreva a mensagem do cliente.' }, 400);
    const { data: r, error } = await admin.rpc('atd_entrada', { p: { canal: 'teste', externo, nome: 'Simulação de ' + eu.nome, texto } });
    if (error) return json({ error: error.message }, 400);
    await admin.from('atd_conversas').update({ estado: 'robo', pausado_ate: null }).eq('id', r.conversa);
    const res = await responder(r.conversa, r.msg, { esperar: false, forcar: true });
    return json({ conversa: r.conversa, ...(res ?? {}) });
  }
  if (acao === 'roteiro') {
    const ctx = await contexto();
    const casos = A.roteiro(ctx.carros);
    const res = await Promise.all(casos.map(async (k: any) => {
      try {
        const { saida, uso } = await pensar(ctx, k.m.map((texto: string) => ({ autor: 'cliente', texto })));
        if (uso) await admin.rpc('atd_contar', { p_in: uso.entrada, p_out: uso.saida, p_cache: uso.cache });
        return { n: k.n, m: k.m, e: k.e, saida, ok: !!k.ok(saida) };
      } catch (e) { return { n: k.n, m: k.m, e: k.e, erro: msgErro(e), ok: false }; }
    }));
    await registrar(`Rodou o roteiro de testes do atendente: ${res.filter((x) => x.ok).length} de ${res.length} ok`, eu);
    return json({ casos: res });
  }

  const { data: cv } = await admin.from('atd_conversas').select('*').eq('id', String(b.conversa ?? '')).maybeSingle();
  if (!cv) return json({ error: 'Conversa não encontrada.' }, 404);
  const quem = cv.nome || canalN(cv.canal) || 'contato';
  const ctx = await contexto();

  if (acao === 'enviar') {
    const texto = String(b.texto ?? '').trim().slice(0, 4000);
    if (!texto) return json({ error: 'Escreva a mensagem.' }, 400);
    if (cv.canal === 'whatsapp' && !A.janela24(cv, Date.now())) return json({ error: 'Passaram 24 horas desde a última mensagem do cliente: o WhatsApp só aceita modelo aprovado. Use o botão do WhatsApp do vendedor.' }, 409);
    let metaId: string | null = null;
    try { metaId = await enviarCanal(cv, texto); } catch (e) { return json({ error: msgErro(e) }, 502); }
    await admin.from('atd_mensagens').insert({ conversa: cv.id, dir: 'out', autor: 'humano', texto, meta_id: metaId, por: eu.id, info: { nome: eu.nome } });
    await admin.from('atd_conversas').update({ estado: 'humano', pausado_ate: daqui(ctx.c.pausaH), nao_lidas: 0, ultima: agoraISO() }).eq('id', cv.id);
    return json({ ok: true });
  }
  if (acao === 'assumir') {
    await admin.from('atd_conversas').update({ estado: 'humano', pausado_ate: daqui(ctx.c.pausaH), nao_lidas: 0 }).eq('id', cv.id);
    await registrar(`Assumiu a conversa de ${quem} (${canalN(cv.canal)}); o robô fica calado por ${ctx.c.pausaH} h`, eu, cv.lead_id);
    return json({ ok: true });
  }
  if (acao === 'devolver') {
    await admin.from('atd_conversas').update({ estado: 'robo', pausado_ate: null, motivo: '' }).eq('id', cv.id);
    await registrar(`Devolveu ao robô a conversa de ${quem} (${canalN(cv.canal)})`, eu, cv.lead_id);
    return json({ ok: true });
  }
  if (acao === 'encerrar') {
    await admin.from('atd_conversas').update({ estado: 'encerrado', pausado_ate: null, nao_lidas: 0 }).eq('id', cv.id);
    await registrar(`Encerrou a conversa de ${quem} (${canalN(cv.canal)})`, eu, cv.lead_id);
    return json({ ok: true });
  }
  if (acao === 'lida') {
    await admin.from('atd_conversas').update({ nao_lidas: 0 }).eq('id', cv.id);
    return json({ ok: true });
  }
  if (acao === 'apagar') {
    if (!eu.admin) return json({ error: 'Só o administrador apaga conversas (pedido de exclusão de dados).' }, 403);
    await admin.from('atd_conversas').delete().eq('id', cv.id);
    await registrar(`Apagou a conversa de ${quem} (${canalN(cv.canal)}) a pedido do cliente (LGPD)`, eu, cv.lead_id);
    return json({ ok: true });
  }
  return json({ error: 'Ação desconhecida.' }, 400);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  try {
    if (req.method === 'GET') {
      const modo = url.searchParams.get('hub.mode'), ch = url.searchParams.get('hub.challenge');
      if (modo === 'subscribe' && ch) {
        return (await tokenOk(url.searchParams.get('hub.verify_token') ?? '')) ? new Response(ch, { headers: { 'Content-Type': 'text/plain' } }) : new Response('token inválido', { status: 403 });
      }
      return json({ ok: true, servico: 'atendente', modelo: MODELO() });
    }
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    const corpo = await req.text();
    if (corpo.length > 200_000) return json({ error: 'Conteúdo grande demais.' }, 413);
    const b = lerJson(corpo);
    if (b && typeof b.object === 'string') return await webhookMeta(req, corpo, url);
    if (!b) return json({ error: 'Corpo inválido.' }, 400);
    return await equipe(req, b);
  } catch (e) {
    return json({ error: msgErro(e) || 'Erro inesperado.' }, 500);
  }
});
