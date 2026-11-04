// integracoes: consultas externas para quem está logado, com cache no banco.
// acao: fipe_marcas | fipe_modelos | fipe_anos | fipe_preco | fipe_busca | cep | cnpj
import { admin, cors, json, quemChama } from './_compartilhado.ts';

const FIPE = 'https://fipe.parallelum.com.br/api/v2';
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function cache<T>(chave: string, horas: number, f: () => Promise<T>): Promise<T> {
  const { data } = await admin.from('api_cache').select('valor,em').eq('chave', chave).maybeSingle();
  if (data && Date.now() - new Date(data.em).getTime() < horas * 3600e3) return data.valor as T;
  const v = await f();
  await admin.from('api_cache').upsert({ chave, valor: v as unknown as Record<string, unknown>, em: new Date().toISOString() });
  return v;
}
async function pegar(url: string, h: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...h } });
  if (r.status === 404) throw new Error('Não encontrado.');
  if (r.status === 429) throw new Error('Limite de consultas atingido. Tente mais tarde.');
  if (!r.ok) throw new Error('O serviço externo respondeu com erro ' + r.status + '.');
  return r.json();
}
const fipe = (p: string) => pegar(FIPE + p, Deno.env.get('FIPE_TOKEN') ? { 'X-Subscription-Token': Deno.env.get('FIPE_TOKEN')! } : {});
const tipoOk = (t: unknown) => (['cars', 'motorcycles', 'trucks'].includes(String(t)) ? String(t) : 'cars');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!(await quemChama(req))) return json({ error: 'Entre no sistema para continuar.' }, 401);
  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ error: 'Corpo inválido.' }, 400); }
  const t = tipoOk(b.tipo);
  try {
    switch (b.acao) {
      case 'fipe_marcas': return json(await cache(`fipe:${t}:marcas`, 24 * 7, () => fipe(`/${t}/brands`)));
      case 'fipe_modelos': return json(await cache(`fipe:${t}:${b.marca}:modelos`, 24 * 7, () => fipe(`/${t}/brands/${encodeURIComponent(b.marca)}/models`)));
      case 'fipe_anos': return json(await cache(`fipe:${t}:${b.marca}:${b.modelo}:anos`, 24 * 7, () => fipe(`/${t}/brands/${encodeURIComponent(b.marca)}/models/${encodeURIComponent(b.modelo)}/years`)));
      case 'fipe_preco': return json(await cache(`fipe:${t}:${b.marca}:${b.modelo}:${b.ano}`, 24, () => fipe(`/${t}/brands/${encodeURIComponent(b.marca)}/models/${encodeURIComponent(b.modelo)}/years/${encodeURIComponent(b.ano)}`)));
      case 'fipe_busca': {
        // acha marca, modelo e ano a partir do texto da ficha
        const marcas: Array<{ code: string; name: string }> = await cache(`fipe:${t}:marcas`, 24 * 7, () => fipe(`/${t}/brands`));
        const qm = norm(String(b.marca ?? '')).replace(/^vw$/, 'volkswagen').replace(/^gm$/, 'chevrolet');
        const m = marcas.find((x) => norm(x.name) === qm) ?? marcas.find((x) => norm(x.name).split(' ').includes(qm)) ?? marcas.find((x) => norm(x.name).includes(qm));
        if (!m) return json({ error: 'Marca não encontrada na FIPE: ' + b.marca }, 404);
        const modelos: Array<{ code: string; name: string }> = await cache(`fipe:${t}:${m.code}:modelos`, 24 * 7, () => fipe(`/${t}/brands/${m.code}/models`));
        const alvo = norm(`${b.modelo ?? ''} ${b.versao ?? ''}`).split(' ').filter(Boolean);
        const base = norm(String(b.modelo ?? '')).split(' ').filter(Boolean);
        const pont = modelos.map((x) => { const w = norm(x.name).split(' '); const temBase = base.every((p) => w.includes(p));
          return { x, s: (temBase ? 10 : 0) + alvo.filter((p) => w.includes(p)).length - w.length * 0.01 }; })
          .filter((y) => y.s >= 10).sort((a, c) => c.s - a.s);
        if (!pont.length) return json({ error: 'Modelo não encontrado na FIPE: ' + b.modelo }, 404);
        const ano = String(b.ano ?? '');
        for (const { x } of pont.slice(0, 6)) {
          const anos: Array<{ code: string; name: string }> = await cache(`fipe:${t}:${m.code}:${x.code}:anos`, 24 * 7, () => fipe(`/${t}/brands/${m.code}/models/${x.code}/years`));
          const a = anos.find((y) => y.code.startsWith(ano + '-'));
          if (!a) continue;
          const p = await cache(`fipe:${t}:${m.code}:${x.code}:${a.code}`, 24, () => fipe(`/${t}/brands/${m.code}/models/${x.code}/years/${a.code}`));
          const valor = Number(String(p.price ?? '').replace(/[^\d,]/g, '').replace(',', '.'));
          return json({ valor, texto: p.price, codigo: p.codeFipe, referencia: p.referenceMonth, modelo: p.model, marca: p.brand, combustivel: p.fuel,
            candidatos: pont.slice(0, 5).map((y) => y.x.name) });
        }
        return json({ error: 'Não há preço FIPE para o ano ' + ano + ' nesse modelo.', candidatos: pont.slice(0, 5).map((y) => y.x.name) }, 404);
      }
      case 'cep': {
        const c = String(b.cep ?? '').replace(/\D/g, '');
        if (c.length !== 8) return json({ error: 'CEP com 8 números.' }, 400);
        const d = await cache(`cep:${c}`, 24 * 30, () => pegar(`https://brasilapi.com.br/api/cep/v2/${c}`));
        return json({ cep: c, end: [d.street, d.neighborhood].filter(Boolean).join(', '), cidade: d.city, uf: d.state });
      }
      case 'cnpj': {
        const c = String(b.cnpj ?? '').replace(/\D/g, '');
        if (c.length !== 14) return json({ error: 'CNPJ com 14 números.' }, 400);
        const d = await cache(`cnpj:${c}`, 24 * 7, () => pegar(`https://brasilapi.com.br/api/cnpj/v1/${c}`));
        return json({ nome: d.razao_social, fantasia: d.nome_fantasia, situacao: d.descricao_situacao_cadastral, cep: d.cep,
          end: [d.logradouro, d.numero, d.bairro].filter(Boolean).join(', '), cidade: d.municipio, uf: d.uf, tel: d.ddd_telefone_1 });
      }
    }
    return json({ error: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Erro inesperado.' }, 502);
  }
});
