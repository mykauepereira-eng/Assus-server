// vitrine: estoque público para o site da loja, catálogo do Facebook/Instagram e integradores.
// GET ?formato=json (padrão) | xml | csv. Só carros "Disponível" marcados para a vitrine.
// Liga e desliga em 3305 (Integrações). Não mostra custos, placa completa nem dados internos.
import { admin, cors, json } from './_compartilhado.ts';

const OPC: Record<string, string> = { ar: 'Ar-condicionado', dir: 'Direção elétrica/hidráulica', vid: 'Vidros elétricos', trv: 'Travas elétricas', alm: 'Alarme', mult: 'Multimídia', cam: 'Câmera de ré', sens: 'Sensor de estacionamento', air: 'Airbags', abs: 'Freios ABS', ctrl: 'Controle de tração/estabilidade', pil: 'Piloto automático', cou: 'Bancos de couro', teto: 'Teto solar', roda: 'Rodas de liga leve', led: 'Faróis de LED/xenon', chv: 'Chave presencial', btn: 'Partida por botão', '4x4': 'Tração 4x4', eng: 'Engate' };
const CAT: Record<string, string> = { moto: 'Moto', hatch: 'Hatch', sedan: 'Sedã', suv: 'SUV', picape: 'Picape', van: 'Van' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const csv = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const fmt = (new URL(req.url).searchParams.get('formato') ?? 'json').toLowerCase();
  try {
    const { data: conf } = await admin.from('docs').select('id,data').eq('coll', 'conf').in('id', ['integ', 'cfgs']);
    const integ = conf?.find((x) => x.id === 'integ')?.data ?? {}, cfg = conf?.find((x) => x.id === 'cfgs')?.data ?? {};
    if (!integ?.vitrine?.on) return json({ error: 'A vitrine está desligada. Ligue em 3305 (Integrações).' }, 404);
    const { data: carros, error } = await admin.from('docs').select('id,data').eq('coll', 'carros');
    if (error) throw error;
    const disp = (carros ?? []).map((x) => x.data).filter((c) => c?.st === 'disp' && c?.anun?.vitrine !== false && c?.preco?.anun > 0);
    const ids = disp.map((c) => 'pc_' + c.id);
    const { data: cards } = ids.length ? await admin.from('docs').select('id,data').eq('coll', 'cards').in('id', ids) : { data: [] };
    const paths: Record<string, string[]> = {};
    for (const k of cards ?? []) {
      const anx = (k.data?.anx ?? []).filter((a: any) => a.tipo === 'img' && a.path);
      const capa = k.data?.capa;
      anx.sort((a: any, b: any) => (a.id === capa ? -1 : b.id === capa ? 1 : 0));
      paths[k.data?.carro] = anx.slice(0, 20).map((a: any) => a.path);
    }
    const todos = Object.values(paths).flat();
    const urls: Record<string, string> = {};
    if (todos.length) {
      const { data: s } = await admin.storage.from('anexos').createSignedUrls(todos, 60 * 60 * 24 * 7);
      for (const x of s ?? []) if (x.signedUrl && x.path) urls[x.path] = x.signedUrl;
    }
    const loja = { nome: cfg.empresa ?? '', telefone: cfg.tel ?? '', cidade: cfg.cidade ?? '', uf: cfg.uf ?? '', endereco: cfg.end ?? '', site: cfg.site ?? '' };
    const vs = disp.map((c) => ({
      codigo: c.num, marca: c.marca, modelo: c.modelo, versao: c.versao ?? '', ano_fabricacao: c.anoF, ano_modelo: c.anoM,
      km: c.km, cor: c.cor, cambio: c.cambio ?? '', combustivel: c.comb ?? '', portas: c.portas ?? null, categoria: CAT[c.cat] ?? '',
      preco: c.preco.anun, final_placa: c.placa ? String(c.placa).slice(-1) : '',
      opcionais: (c.opc ?? []).map((k: string) => OPC[k] ?? k), descricao: c.anun?.txt || c.anun?.desc || '',
      fotos: (paths[c.id] ?? []).map((p) => urls[p]).filter(Boolean), atualizado: c.alt ? new Date(c.alt).toISOString() : null,
    }));
    const h = { 'Cache-Control': 'public, max-age=300' };
    if (fmt === 'xml') {
      const x = '<?xml version="1.0" encoding="UTF-8"?>\n<estoque loja="' + esc(loja.nome) + '" gerado="' + new Date().toISOString() + '">\n' + vs.map((v) =>
        '  <veiculo>\n' + Object.entries(v).map(([k, val]) => Array.isArray(val)
          ? `    <${k}>${val.map((i) => `<item>${esc(i)}</item>`).join('')}</${k}>`
          : `    <${k}>${esc(val)}</${k}>`).join('\n') + '\n  </veiculo>').join('\n') + '\n</estoque>\n';
      return new Response(x, { headers: { ...cors, ...h, 'Content-Type': 'application/xml; charset=utf-8' } });
    }
    if (fmt === 'csv') {
      const cab = ['vehicle_id', 'title', 'description', 'make', 'model', 'year', 'mileage.value', 'mileage.unit', 'price', 'transmission', 'fuel_type', 'body_style', 'exterior_color', 'state_of_vehicle', 'image[0].url', 'image[1].url', 'image[2].url', 'address.city', 'address.region', 'address.country', 'url'];
      const tr: Record<string, string> = { 'Manual': 'MANUAL', 'Automático': 'AUTOMATIC', 'CVT': 'AUTOMATIC', 'Automatizado': 'AUTOMATIC' };
      const fu: Record<string, string> = { Flex: 'FLEX', Gasolina: 'GASOLINE', Etanol: 'ETHANOL', Diesel: 'DIESEL', 'Elétrico': 'ELECTRIC', 'Híbrido': 'HYBRID', GNV: 'OTHER' };
      const linhas = vs.map((v) => [v.codigo, `${v.marca} ${v.modelo} ${v.versao} ${v.ano_fabricacao}/${v.ano_modelo}`.replace(/\s+/g, ' '), v.descricao || `${v.marca} ${v.modelo}`, v.marca, v.modelo, v.ano_modelo, v.km, 'KM',
        `${Number(v.preco).toFixed(2)} BRL`, tr[v.cambio] ?? 'OTHER', fu[v.combustivel] ?? 'OTHER', (v.categoria || 'OTHER').toUpperCase(), v.cor, 'USED', v.fotos[0] ?? '', v.fotos[1] ?? '', v.fotos[2] ?? '', loja.cidade, loja.uf, 'BR', loja.site].map(csv).join(','));
      return new Response([cab.join(','), ...linhas].join('\n') + '\n', { headers: { ...cors, ...h, 'Content-Type': 'text/csv; charset=utf-8' } });
    }
    return json({ loja, gerado: new Date().toISOString(), total: vs.length, veiculos: vs }, 200, h);
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Erro inesperado.' }, 500);
  }
});
