// Testes automáticos da página: node fonte/testes/rodar_testes.js [arquivo.html]
// Modo local (padrão, fonte/index.html): cria o administrador, roda o autoteste (todas as regras),
// abre todas as telas procurando erro, exercita a 2206 e tira fotos em fonte/testes/telas/.
// Versão online (deploy/index.html ou site/index.html): confere que a página abre sem erro de código.
// Imprime RESULTADO: OK ou RESULTADO: FALHOU.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const arq = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
  const online = /deploy|site/.test(arq);
  const fotos = path.join(__dirname, 'telas');
  fs.mkdirSync(fotos, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const erros = [], falhas = [];
  p.on('pageerror', (e) => erros.push('erro de código: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource|ERR_/i.test(m.text())) erros.push('console: ' + m.text()); });
  await p.goto('file://' + arq);
  await p.waitForTimeout(1200);

  if (online) {
    const r = await p.evaluate(() => ({ online: ONLINE, v: APP_V, titulo: document.title, telas: ALLT.length, tem2206: ALLT.includes('2206') }));
    console.log('Versão online:', JSON.stringify(r));
    if (!r.online) falhas.push('a versão online está sem a chave pública');
    if (!r.tem2206) falhas.push('tela 2206 ausente');
  } else {
    // primeiro acesso: cria o administrador
    await p.fill('#su_emp', 'Silva Seminovos');
    await p.fill('#su_nome', 'Kauê Teste');
    await p.fill('#su_pw', 'teste12345');
    await p.fill('#su_pw2', 'teste12345');
    await p.click('.authc button.p');
    await p.waitForTimeout(2500);
    if (!(await p.evaluate(() => !!U()))) { falhas.push('não entrou depois da configuração inicial'); }

    // autoteste: todas as regras do sistema, inclusive as do atendente
    const t = await p.evaluate(() => selfTest());
    const ruins = t.filter((x) => !x[1]);
    const atd = t.filter((x) => /^Atendente:/.test(x[0]));
    console.log(`Autoteste: ${t.length - ruins.length} de ${t.length} aprovados (atendente: ${atd.filter((x) => x[1]).length} de ${atd.length})`);
    ruins.forEach((x) => falhas.push('autoteste: ' + x[0]));

    // estoque de exemplo para a 2206
    const seed = await p.evaluate(() => {
      const base = { cor: 'Prata', comb: 'Flex', cambio: 'Manual', doc: { ipva: 'pago', crlv: true, lic: true } };
      const L = [
        { marca: 'Chevrolet', modelo: 'Onix', versao: 'LT 1.0', anoF: '2020', anoM: '2021', placa: 'ABC1D23', km: '45200', cat: 'hatch', preco: { anun: '65900', min: '62000' }, ent: { data: hoje(), origem: 'compra', forn: { nome: 'João' }, valor: '52000', pag: 'vista' } },
        { marca: 'Hyundai', modelo: 'Creta', versao: 'Limited 1.0 Turbo', anoF: '2022', anoM: '2022', placa: 'DEF2G34', km: '31000', cat: 'suv', cambio: 'Automático', preco: { anun: '109900', min: '104000' }, ent: { data: hoje(), origem: 'compra', forn: { nome: 'Maria' }, valor: '92000', pag: 'vista' } },
        { marca: 'Fiat', modelo: 'Toro', versao: 'Freedom', anoF: '2021', anoM: '2022', placa: 'GHI3J45', km: '58000', cat: 'picape', comb: 'Diesel', preco: { anun: '129900', min: '123000' }, ent: { data: hoje(), origem: 'compra', forn: { nome: 'Pedro' }, valor: '108000', pag: 'vista' } },
      ];
      const out = [];
      for (const f of L) { const r = Core.addCarro(S, { ...base, ...f }, Date.now(), SID); if (!r.ok) { out.push(r.e); continue; } const c = S.carros[S.carros.length - 1]; const s2 = Core.setSt(S, c.id, 'disp'); if (!s2.ok) out.push(s2.e); }
      save(); draw(); return { erros: out, disp: S.carros.filter((c) => c.st === 'disp').length };
    });
    if (seed.erros.length || seed.disp !== 3) falhas.push('não conseguiu montar o estoque de exemplo: ' + JSON.stringify(seed));

    // todas as telas abrem sem erro
    const telas = await p.evaluate(() => ALLT.slice());
    for (const c of telas) {
      const r = await p.evaluate((c) => { const ok = abrir(c); const m = document.querySelector('#main'); return { ok, bad: !!m && /Não foi possível abrir esta tela/.test(m.innerText) }; }, c);
      if (r.bad) falhas.push('tela ' + c + ' não abriu');
    }
    console.log(`Telas abertas: ${telas.length} (inclui 2206: ${telas.includes('2206')})`);

    // 2206: abas, simulação local, configuração, cartão em 3305 e busca
    await p.evaluate(() => { ui.atdT = 'conv'; abrir('2206'); });
    await p.waitForTimeout(300);
    if ((await p.locator('.atdi').count()) !== 3) falhas.push('2206: conversas de exemplo não apareceram');
    await p.click('.atdi >> nth=0');
    await p.waitForTimeout(300);
    if ((await p.locator('.atdm .bb').count()) < 3) falhas.push('2206: conversa de exemplo sem mensagens');
    await p.screenshot({ path: path.join(fotos, '2206-conversas.png') });

    await p.evaluate(() => { ui.atdT = 'teste'; draw(); });
    for (const msg of ['Oi, vocês têm Creta?', 'tem suv até 120 mil?', 'quero falar com um vendedor']) {
      await p.fill('#atd_sim', msg);
      await p.press('#atd_sim', 'Enter');
      await p.waitForTimeout(250);
    }
    const sim = await p.evaluate(() => Atd.st.sim.map((m) => [m.autor, m.texto, !!(m.info && m.info.transferir)]));
    if (sim.length !== 6 || !/Creta/.test(sim[1][1]) || !/automático/.test(sim[1][1]) || !sim[5][2]) falhas.push('2206: simulação local respondeu errado: ' + JSON.stringify(sim));
    await p.screenshot({ path: path.join(fotos, '2206-testar.png'), fullPage: true });

    await p.evaluate(() => { ui.atdT = 'conf'; draw(); });
    await p.fill('#ac_sobre', 'Seg a sex 8h às 18h, sábado 8h ao meio-dia. Rua das Flores, 100.');
    await p.fill('#ac_pausa', '6');
    await p.click('button:has-text("Salvar configuração")');
    await p.waitForTimeout(300);
    const cf = await p.evaluate(() => ({ c: S.integ.atd, aud: S.aud.slice(-1)[0] }));
    if (!cf.c || cf.c.pausaH !== 6 || !/Rua das Flores/.test(cf.c.sobre) || !/Atendente IA/.test(cf.aud.acao)) falhas.push('2206: configuração não salvou: ' + JSON.stringify(cf.c));
    await p.locator('label.sw:has(#ac_on)').click();
    await p.locator('label.tgi:has(#ac_c_instagram)').click();
    await p.click('button:has-text("Salvar configuração")');
    await p.waitForTimeout(300);
    if (await p.evaluate(() => S.integ.atd.on)) falhas.push('2206: deixou ligar o robô no modo local');
    await p.screenshot({ path: path.join(fotos, '2206-configurar.png'), fullPage: true });

    await p.evaluate(() => { ui.atdT = 'ligar'; draw(); });
    await p.waitForTimeout(200);
    if (!(await p.locator('text=URL de callback').count())) falhas.push('2206: passo a passo sem a URL de callback');
    await p.screenshot({ path: path.join(fotos, '2206-como-ligar.png'), fullPage: true });

    await p.evaluate(() => abrir('3305'));
    if (!(await p.locator('text=Atendente IA (Claude)').count())) falhas.push('3305: cartão do atendente ausente');
    const busca = await p.evaluate(() => bBusca('robo whatsapp', BCAT.map((e, i) => ({ i, g: e[0], t: e[1], c: e[2], k: e[3], go: e[4], req: e[5] }))).map((e) => e.c));
    if (!busca.includes('2206')) falhas.push('busca: "robo whatsapp" não acha a 2206');

    // celular
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { ui.atdT = 'conv'; Atd.st.sel = ''; abrir('2206'); });
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(fotos, '2206-celular-lista.png') });
    await p.click('.atdi >> nth=0');
    await p.waitForTimeout(300);
    const larg = await p.evaluate(() => document.documentElement.scrollWidth);
    if (larg > 392) falhas.push('celular: a página rola para o lado (' + larg + 'px)');
    await p.screenshot({ path: path.join(fotos, '2206-celular-conversa.png') });

    // tema escuro
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; ui.atdT = 'conv'; abrir('2206'); });
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(fotos, '2206-escuro.png') });
  }

  erros.forEach((e) => falhas.push(e));
  await b.close();
  if (falhas.length) { console.log('\nProblemas:\n- ' + falhas.join('\n- ')); console.log('\nRESULTADO: FALHOU'); process.exit(1); }
  console.log('\nRESULTADO: OK');
})().catch((e) => { console.error(e); console.log('RESULTADO: FALHOU'); process.exit(1); });
