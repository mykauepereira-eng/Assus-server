// deno test supabase/functions/atendente/nucleo_test.ts
import { assinatura, iguais, lerEventos, lerJson, temLeadgen } from './nucleo.ts';
import { AtdRegras as A } from './regras.js';

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };

Deno.test('WhatsApp: texto, nome do contato e anexo viram mensagens; reação é ignorada', () => {
  const b = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ wa_id: '5547999990000', profile: { name: 'Paula' } }],
    messages: [
      { from: '5547999990000', id: 'wamid.1', type: 'text', text: { body: 'Tem Onix?' } },
      { from: '5547999990000', id: 'wamid.2', type: 'audio', audio: {} },
      { from: '5547999990000', id: 'wamid.3', type: 'reaction', reaction: { emoji: '👍' } },
      { from: '5547999990000', id: 'wamid.4', type: 'image', image: { caption: 'esse aqui' } },
    ] } }, { field: 'statuses', value: {} }] }] };
  const e = lerEventos(b);
  ok(e.length === 3, 'três mensagens');
  ok(e[0].canal === 'whatsapp' && e[0].nome === 'Paula' && e[0].tel === '5547999990000' && e[0].texto === 'Tem Onix?' && !e[0].eco, 'texto');
  ok(e[1].texto === '[anexo: áudio]', 'áudio');
  ok(e[2].texto === '[anexo: foto] esse aqui', 'foto com legenda');
});

Deno.test('Messenger e Instagram: remetente certo, eco marcado, sem mensagem vazia', () => {
  const p = { object: 'page', entry: [{ messaging: [
    { sender: { id: 'PSID1' }, recipient: { id: 'PAGE' }, message: { mid: 'm1', text: 'Oi' } },
    { sender: { id: 'PAGE' }, recipient: { id: 'PSID1' }, message: { mid: 'm2', text: 'Olá!', is_echo: true, app_id: 123 } },
    { sender: { id: 'PSID1' }, recipient: { id: 'PAGE' }, read: { watermark: 1 } },
  ] }] };
  const e = lerEventos(p);
  ok(e.length === 2 && e[0].canal === 'messenger' && e[0].externo === 'PSID1' && !e[0].eco, 'mensagem do cliente');
  ok(e[1].eco && e[1].externo === 'PSID1' && e[1].appId === '123', 'eco aponta para o cliente');
  const i = lerEventos({ object: 'instagram', entry: [{ messaging: [{ sender: { id: 'IG1' }, recipient: { id: 'ME' }, message: { mid: 'x', attachments: [{ type: 'image' }] } }] }] });
  ok(i.length === 1 && i[0].canal === 'instagram' && i[0].texto === '[anexo: foto]', 'instagram com foto');
  ok(lerEventos({ object: 'outro' }).length === 0 && lerEventos(null).length === 0, 'objeto desconhecido');
});

Deno.test('Lead Ads no mesmo endereço é reconhecido para repasse', () => {
  ok(temLeadgen({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: '1' } }] }] }), 'leadgen');
  ok(!temLeadgen({ object: 'page', entry: [{ messaging: [] }] }), 'mensagem não é leadgen');
});

Deno.test('Assinatura da Meta (HMAC SHA-256) e comparação em tempo constante', async () => {
  const s = await assinatura('segredo', '{"a":1}');
  ok(/^sha256=[0-9a-f]{64}$/.test(s), 'formato');
  ok(iguais(s, await assinatura('segredo', '{"a":1}')) && !iguais(s, await assinatura('outro', '{"a":1}')), 'confere');
  ok(!iguais(s, s.slice(0, -1)), 'tamanho diferente');
});

Deno.test('JSON do Claude e regras compartilhadas rodam no servidor', () => {
  ok(lerJson('{"mensagem":"oi"}')?.mensagem === 'oi' && lerJson('nada') === null && lerJson('[1]') === null, 'lerJson');
  const d = A.decidir({ mensagem: 'Veja golpe.com e fale comigo', transferir: false, lead: {} }, { links: [] });
  ok(!/golpe/.test(d.mensagem) && d.linksRemovidos === 1, 'travas de link');
  ok(A.ESQUEMA.required.length === 4 && A.MODELO === 'claude-haiku-5-5', 'esquema e modelo');
});
