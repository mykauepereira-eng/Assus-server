// Partes puras do atendente (sem banco e sem rede): testadas em nucleo_test.ts.
// deno-lint-ignore-file no-explicit-any

export type Entrada = {
  canal: 'whatsapp' | 'instagram' | 'messenger';
  externo: string; // número do WhatsApp ou id do contato na Meta
  nome: string;
  tel: string;
  texto: string;
  metaId: string;
  eco: boolean; // mensagem enviada pela própria Página (pelo atendente ou por alguém da equipe no app da Meta)
  appId: string;
};

const ANEXO: Record<string, string> = {
  audio: 'áudio', voice: 'áudio', image: 'foto', video: 'vídeo', sticker: 'figurinha', document: 'documento',
  file: 'arquivo', location: 'localização', contacts: 'contato', reaction: 'reação', share: 'link compartilhado', story_mention: 'menção nos stories',
};
export const tipoAnexo = (t: unknown) => ANEXO[String(t ?? '')] ?? 'anexo';

// Lê o corpo do webhook da Meta (WhatsApp Cloud API, Messenger e Instagram) e devolve as mensagens de texto.
export function lerEventos(b: any): Entrada[] {
  const out: Entrada[] = [];
  if (!b || typeof b !== 'object') return out;
  if (b.object === 'whatsapp_business_account') {
    for (const e of b.entry ?? []) for (const ch of e.changes ?? []) {
      if (ch?.field !== 'messages') continue;
      const v = ch.value ?? {};
      const nomes: Record<string, string> = {};
      for (const c of v.contacts ?? []) if (c?.wa_id) nomes[String(c.wa_id)] = String(c.profile?.name ?? '');
      for (const m of v.messages ?? []) {
        if (!m?.from || !m?.id) continue;
        let texto = '';
        if (m.type === 'text') texto = String(m.text?.body ?? '');
        else if (m.type === 'button') texto = String(m.button?.text ?? '');
        else if (m.type === 'interactive') texto = String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '');
        else if (m.type === 'reaction') continue; // emoji em mensagem anterior: não é pergunta
        else texto = `[anexo: ${tipoAnexo(m.type)}]` + (m[m.type]?.caption ? ' ' + String(m[m.type].caption) : '');
        out.push({ canal: 'whatsapp', externo: String(m.from), nome: nomes[String(m.from)] ?? '', tel: String(m.from), texto, metaId: String(m.id), eco: false, appId: '' });
      }
    }
  } else if (b.object === 'page' || b.object === 'instagram') {
    const canal = b.object === 'page' ? 'messenger' : 'instagram';
    for (const e of b.entry ?? []) for (const ev of e.messaging ?? []) {
      const msg = ev?.message;
      if (!msg || msg.is_deleted || msg.is_unsupported) continue;
      const eco = !!msg.is_echo;
      const externo = String((eco ? ev.recipient?.id : ev.sender?.id) ?? '');
      const at = Array.isArray(msg.attachments) ? msg.attachments : [];
      const texto = msg.text ? String(msg.text) : at.length ? `[anexo: ${tipoAnexo(at[0]?.type)}]` : '';
      if (!externo || !texto || !msg.mid) continue;
      out.push({ canal, externo, nome: '', tel: '', texto, metaId: String(msg.mid), eco, appId: String(msg.app_id ?? '') });
    }
  }
  return out;
}

// A Meta manda Lead Ads (formulários) e mensagens da Página para o mesmo endereço: os formulários seguem para a função "leads".
export const temLeadgen = (b: any) => b?.object === 'page' && (b.entry ?? []).some((e: any) => (e.changes ?? []).some((c: any) => c?.field === 'leadgen'));

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function assinatura(segredo: string, corpo: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'sha256=' + hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(corpo))));
}
export function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Resposta do Claude → objeto (ou null se não veio JSON válido)
export function lerJson(txt: string): Record<string, unknown> | null {
  try { const o = JSON.parse(txt); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}
