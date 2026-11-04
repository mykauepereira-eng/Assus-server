# Sistema da Concessionária · versão 7.0

CRM + ERP para revenda de seminovos (pátio, estoque, vendas, financeiro, leads, Renave), com banco no Supabase.
A versão 7.0 traz o **Atendente IA** (tela **2206**): um atendente automático que responde WhatsApp, Instagram e
Facebook com o estoque real da loja, a qualquer hora, e chama o vendedor na hora certa.

A partir desta versão, **este repositório é a fonte do sistema** (antes era o arquivo `sistema-concessionaria.zip`).

## De onde veio

| Quando | Projeto | O que virou |
|---|---|---|
| 20/10 | Custos e Estoque | custo por lavagem e estoque de produtos |
| 22/10 | Lavação Móvel (repositório `lavacao`) | área 11 do sistema |
| 22/10 | Sistema de Gestão (este repositório, `historico/`) | telas por código (0000, 2201…), setores e permissões |
| 26/10 | Automação de leads com Claude (documento) | plano do atendente: canais da Meta, custos, regras, roteiro de testes |
| 31/10 a 01/11 | Sistema da Concessionária 3.0 a 6.0 | CRM, quadros, Renave, integrações, banco Supabase no ar |
| 04/11 | **7.0: Atendente IA** | o plano de 26/10 construído dentro do sistema |

## O Atendente IA (2206)

- **Conversas**: tudo que chega de WhatsApp, Instagram e Messenger aparece em tempo real. Filtros: esperando vendedor,
  com o robô, com a equipe, encerradas. Botões: assumir, devolver ao robô, encerrar, apagar (pedido LGPD, só administrador).
- **O vendedor manda**: quando alguém da equipe responde (pela 2206 ou pelo app da Meta), o robô se cala naquela conversa
  pelo tempo escolhido (padrão 12 h).
- **Chama o vendedor** quando o cliente pede, reclama, quer negociar preço, simular parcela, marcar visita ou test-drive,
  ou pergunta algo que não está na base. A conversa vai para "Esperando vendedor" e aparece no início do sistema.
- **Vira lead em 2201** sozinho, com o rodízio de vendedores, sem duplicar (WhatsApp usa o telefone; Instagram e Messenger,
  a conversa). O que o cliente contou (interesse, orçamento, troca, pagamento, visita) vai para o lead.
- **Testar**: simulador de cliente e o roteiro dos 10 testes difíceis (manipulação, desconto, juros, reclamação, áudio…).
- **Configurar**: liga e desliga, canais, o que dizer sobre a loja, financiamento e troca, o que nunca prometer,
  links permitidos, limite de respostas por mês e por quanto tempo guardar as conversas.
- **Como ligar**: passo a passo da Meta e da chave da Claude, com a conferência de cada segredo.

Modelo: Claude Haiku 5.5 (escolhido no plano de 26/10: rápido e barato). Custo estimado: cerca de US$ 0,20 a cada mil respostas
com um estoque de 20 carros. O atendente nunca vê custo, margem, preço mínimo nem placa.

### Travas de segurança
- Só a Meta fala com o robô (assinatura `X-Hub-Signature-256` com `META_APP_SECRET`); a mesma mensagem nunca entra duas vezes.
- Resposta de no máximo 600 caracteres; links fora da lista são retirados; resposta vazia ou fora do formato vira "chamar vendedor".
- Rajada de mensagens (o cliente manda 5 seguidas) vira uma resposta só (espera 8 segundos).
- Limite mensal de respostas (padrão 1.000): passando dele, tudo vai para um vendedor.
- Tudo que vem do cliente é limpo antes de aparecer na tela (teste automático confere).
- Conversas são apagadas sozinhas depois do prazo (padrão 180 dias), todo dia às 03:45 (Brasília).

## Pastas

```
site/                      a pasta que vai para o Netlify (index.html + _headers de segurança)
fonte/
  base_v6_local.html       a página v6.0 como estava publicada
  atd_regras.js            regras puras do atendente (as mesmas rodam no servidor)
  atd_ui.js, atd.css       tela 2206 e ligações com o resto do sistema
  build.py                 monta tudo: python3 fonte/build.py
  testes/rodar_testes.js   testa no navegador: node fonte/testes/rodar_testes.js
  index.html, demo/, deploy/   gerados pelo build
supabase/
  migrations/001…008       banco (001 a 007 já estavam no ar; 008 é o atendente)
  functions/               admin-users, leads, vitrine, integracoes, renave e atendente
  checkup_atendente.sql    checkup do atendente (rode depois do checkup.sql de sempre)
historico/                 o Sistema de Gestão original deste repositório
```

## Como publicar a versão 7.0

1. **Banco**: aplicar `supabase/migrations/008_atendente.sql` (só cria coisas novas; não mexe em dados).
2. **Função**: publicar `supabase/functions/atendente` (arquivos `index.ts`, `nucleo.ts`, `regras.js`, `_compartilhado.ts`)
   com verificação de JWT desligada (a função confere quem chama por dentro, como as outras).
3. **Site**: no Netlify, aba Deploys, arrastar a pasta `site`. O endereço continua o mesmo.
4. Entrar no sistema e abrir **2206 → Como ligar**. Seguir os passos (chave da Claude primeiro).
5. **2206 → Testar**: rodar o roteiro dos 10 testes até acertar todos.
6. **2206 → Configurar**: ligar só o Instagram por uma semana, lendo todas as conversas. Depois Facebook e WhatsApp.

Os passos 1 e 2 podem ser feitos pelo Claude com o conector do Supabase (o Supabase pede sua aprovação na tela).
Se o site for publicado antes do passo 1, a 2206 avisa que falta a migração; o resto do sistema funciona normal.

### Segredos (Supabase → Edge Functions → Secrets)

| Nome | Para quê |
|---|---|
| `ANTHROPIC_API_KEY` | chave da API da Claude (Console da Claude, com limite mensal de gasto). A assinatura Claude Pro não serve. |
| `META_APP_SECRET` | segredo do app da Meta (já usado pela captação de leads) |
| `META_PAGE_TOKEN` | token permanente da Página (responde no Messenger e no Instagram) |
| `WA_TOKEN`, `WA_PHONE_ID` | WhatsApp Cloud API (número exclusivo para o robô) |
| `META_APP_ID` | opcional: separa os ecos do robô das respostas da equipe com certeza |

Chave nenhuma fica na página nem neste repositório.

## Testar

```
python3 fonte/build.py                       # deve terminar com "ok"
node fonte/testes/rodar_testes.js            # modo local: RESULTADO: OK (133 regras + todas as telas + 2206)
node fonte/testes/rodar_testes.js site/index.html   # versão online abre sem erro
deno test supabase/functions/atendente/nucleo_test.ts   # webhook da Meta e assinatura
```

## Voltar atrás

- **Site**: Netlify → Deploys → versão anterior → Publish deploy.
- **Atendente**: em 2206 → Configurar, desligar o robô (as mensagens continuam chegando, ninguém responde sozinho).
- **Função**: apagar a função `atendente` no Supabase ou publicar de novo a versão anterior.
- **Banco**: migrações só andam para frente. A 008 não altera nada existente; para remover, uma migração nova apaga as tabelas `atd_*`.

## Se você ainda usa o zip antigo (`fonte/` com `build.py`, `kb.js`, `crm_*.js`)

Copie `atd_regras.js`, `atd_ui.js` e `atd.css` para lá, injete os dois JS antes de `// ===== Inicialização e atalhos =====`
e o CSS no `<style>`, e repita as 5 substituições do começo de `fonte/build.py` deste repositório (versão, testes,
migração de cargos, aviso no início e cartão em 3305).

## Observações

- As conversas do atendente ficam fora do backup diário (que guarda os registros do sistema). Os leads gerados por elas entram no backup normalmente.
- O banco está nos EUA (Oregon). Para levar a São Paulo, crie um projeto novo e aplique as migrações 001 a 008 em ordem.
- O plano grátis do Supabase pausa depois de 1 semana sem uso. Com o robô atendendo clientes, considere o Pro (US$ 25/mês).
