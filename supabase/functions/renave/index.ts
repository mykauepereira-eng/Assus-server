// renave: ponte com o Renave-WS do Serpro (estoque eletrônico de veículos usados).
// O Renave exige "two-way SSL": cada chamada leva o certificado digital ICP-Brasil (A1) da loja,
// cadastrado no Credencia. Por isso o certificado nunca vai para a página: fica só nos segredos.
//
// Segredos (Supabase → Edge Functions → Secrets):
//   RENAVE_CERT_PEM_B64  certificado público com a cadeia, em PEM, codificado em base64
//   RENAVE_KEY_PEM_B64   chave privada em PEM, codificada em base64
//   RENAVE_AMBIENTE      hom (homologação, padrão) ou prod
//
// GET            → diagnóstico público: o servidor aceita certificado de cliente? (não revela nada da loja)
// POST {acao}    → só administrador ou quem grava veículos:
//   status        configuração atual (ambiente, certificado presente)
//   testar        abre conexão com o Renave usando o certificado
//   chamar        {metodo, caminho, corpo} operação do manual (caminho relativo a /renave-ws/api/)
import { admin, cors, json, quemChama } from './_compartilhado.ts';

const BASE: Record<string, string> = {
  hom: 'https://hom.renave.estaleiro.serpro.gov.br/renave-ws/api/',
  prod: 'https://renave.estaleiro.serpro.gov.br/renave-ws/api/',
};
const D = Deno as unknown as { createHttpClient?: (o: Record<string, string>) => unknown };
const temMtls = () => typeof D.createHttpClient === 'function';
const amb = () => (Deno.env.get('RENAVE_AMBIENTE') === 'prod' ? 'prod' : 'hom');
const paraB64 = (buf: ArrayBuffer) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const b64 = (n: string) => { const v = Deno.env.get(n); if (!v) return ''; try { return atob(v); } catch { return ''; } };

function cliente() {
  const cert = b64('RENAVE_CERT_PEM_B64'), key = b64('RENAVE_KEY_PEM_B64');
  if (!cert || !key) throw new Error('Certificado da loja não configurado nos segredos do servidor.');
  if (!temMtls()) throw new Error('Este servidor não consegue usar certificado de cliente. Use um integrador credenciado ou o serviço ponte descrito no LEIAME.');
  return D.createHttpClient!({ cert, key });
}

async function renave(metodo: string, caminho: string, corpo?: unknown) {
  const c = cliente();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), metodo === 'GET' ? 60_000 : 120_000);
  try {
    const r = await fetch(BASE[amb()] + caminho, {
      method: metodo, signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      // @ts-ignore: opção do Deno para certificado de cliente
      client: c,
    });
    const tipo = r.headers.get('content-type') ?? '';
    const dados = tipo.includes('json') ? await r.json() : tipo.includes('pdf') ? { pdf_base64: paraB64(await r.arrayBuffer()) } : { texto: (await r.text()).slice(0, 2000) };
    return { status: r.status, ok: r.ok, dados };
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    let cria = 'indisponível';
    if (temMtls()) { try { const c = D.createHttpClient!({}) as { close?: () => void }; c?.close?.(); cria = 'ok'; } catch (e) { cria = (e as Error).message; } }
    return json({ ok: true, servico: 'renave', certificado_de_cliente_suportado: cria === 'ok', detalhe: cria });
  }
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const eu = await quemChama(req);
  if (!eu) return json({ error: 'Entre no sistema para continuar.' }, 401);
  if (!eu.admin) {
    const { data: p } = await admin.from('profiles').select('wr').eq('id', eu.id).maybeSingle();
    if (!(p?.wr ?? []).includes('veic')) return json({ error: 'Seu cargo não pode enviar dados ao Renave.' }, 403);
  }
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }

  try {
    if (b.acao === 'status') {
      return json({ ambiente: amb(), certificado: !!(b64('RENAVE_CERT_PEM_B64') && b64('RENAVE_KEY_PEM_B64')), certificado_de_cliente_suportado: temMtls() });
    }
    if (b.acao === 'testar') {
      const r = await renave('GET', 'estoques');
      return json({ conectou: true, ambiente: amb(), status: r.status, resposta: r.dados });
    }
    if (b.acao === 'chamar') {
      if (!eu.admin) return json({ error: 'Só o administrador faz chamadas diretas.' }, 403);
      const metodo = String(b.metodo ?? 'GET').toUpperCase();
      const caminho = String(b.caminho ?? '');
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(metodo)) return json({ error: 'Método inválido.' }, 400);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_/.?=&%]{0,300}$/.test(caminho) || caminho.includes('..') || caminho.includes('//')) return json({ error: 'Caminho inválido.' }, 400);
      return json(await renave(metodo, caminho, b.corpo));
    }
    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (e) {
    const m = (e as Error).name === 'AbortError' ? 'O Renave demorou demais para responder. Tente de novo mais tarde.' : (e as Error).message;
    return json({ error: m || 'Falha ao falar com o Renave.' }, 502);
  }
});
