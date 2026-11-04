// =====================================================================
// 2206 · Atendente IA (v7): conversas de WhatsApp, Instagram e Facebook respondidas pelo Claude
// Regras puras em AtdRegras (atd_regras.js, o mesmo arquivo usado pela função "atendente" no servidor).
// =====================================================================
Object.assign(IC,{bot:'<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="14" r="1.2"/><circle cx="15" cy="14" r="1.2"/><path d="M2 13v3M22 13v3M9.5 17.5h5"/>',
 wpp:'<path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 8 19.6z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.6-2-1-1 .9a4 4 0 0 1-2.3-2.3l.9-1-1-2z"/>',
 insta:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>',
 mess:'<path d="M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.4S17 3 12 3z"/><path d="m7 13 3.2-3.4 2.3 2.3L17 9.5"/>'});
(()=>{const i=TELAS.findIndex(t=>t.c==='2205')+1,t={c:'2206',n:'Atendente IA',d:'Robô que responde WhatsApp, Instagram e Facebook com o estoque real e chama o vendedor na hora certa.',ic:'bot',s:'22'};
 TELAS.splice(i>0?i:TELAS.length,0,t);ALLT.splice(ALLT.indexOf('2205')+1||ALLT.length,0,'2206')})();
REL['2206']=['2201','2205','3305'];REL['2200']=[...REL['2200'],'2206'];REL['2201']=[...REL['2201'],'2206'];REL['3305']=[...REL['3305'],'2206'];
BCAT.push([['con','com'],'Conversas do atendente automático (WhatsApp, Instagram e Facebook)','2206','robo robô ia inteligencia artificial chat conversa whatsapp instagram direct messenger facebook atendimento automatico bot claude',()=>{ui.atdT='conv';abrir('2206')}],
 [['cfg','com'],'Configurar e testar o atendente automático','2206','robo robô ia configurar treinar testar simular atendente bot claude prompt',()=>{ui.atdT='teste';abrir('2206')}]);

const ATD_EST={robo:['Com o robô','ok'],humano:['Com a equipe','info'],transferido:['Esperando vendedor','bad'],encerrado:['Encerrada','mut']};
const ATD_CIC={whatsapp:'wpp',instagram:'insta',messenger:'mess',teste:'bot'};
const Atd={
 st:{conv:[],msgs:{},sel:'',carregado:false,carregando:false,sub:null,status:null,stT:0,erro:'',sim:[],simOcupado:false,roteiro:null,rotOcupado:false,t:0,poll:0,ocupado:''},
 conf:()=>AtdRegras.conf(S.integ&&S.integ.atd),
 on:()=>ONLINE&&ONL.ready&&!!ONL.sb,
 // cargos de instalações antigas ganham a 2206 (quem já tinha os leads)
 migCargos7(s){if(!s.cfg||s.cfg.mig7||!Array.isArray(s.cargos)||!s.cargos.length)return false;
  s.cargos.forEach(c=>{const T=c.telas||[];if(!c.admin&&T.includes('2201')&&!T.includes('2206'))c.telas=[...T,'2206']});s.cfg.mig7=1;return true},
 prep:(s,pode)=>pode?Atd.migCargos7(s):false,
 async chamar(acao,o){if(!Atd.on())throw new Error('Disponível quando o sistema está online, com o banco de dados.');
  const r=await ONL.sb.functions.invoke('atendente',{body:{acao,...(o||{})}});
  if(r.error){let m='';try{m=(await r.error.context.json()).error}catch(x){}throw new Error(m||'O servidor não respondeu. Confira se a função "atendente" foi publicada.')}
  if(r.data&&r.data.error)throw new Error(r.data.error);return r.data},
 // ---------- dados (online) ----------
 async carregar(quieto){if(!Atd.on()||Atd.st.carregando)return;Atd.st.carregando=true;
  try{const r=await ONL.sb.from('atd_conversas').select('*').neq('canal','teste').order('ultima',{ascending:false}).limit(150);
   if(r.error)throw r.error;Atd.st.conv=r.data||[];Atd.st.erro='';Atd.st.carregado=true;
   if(Atd.st.sel)await Atd.carregarMsgs(Atd.st.sel)}catch(e){Atd.st.erro=/atd_conversas|relation|schema cache/i.test(String(e&&e.message))?'As tabelas do atendente ainda não existem no banco: aplique a migração 008_atendente.':String(e&&e.message||e)}
  Atd.st.carregando=false;if(!quieto)Atd.pintar()},
 async carregarMsgs(id){const r=await ONL.sb.from('atd_mensagens').select('*').eq('conversa',id).order('id',{ascending:false}).limit(300);if(!r.error)Atd.st.msgs[id]=(r.data||[]).reverse()},
 async status(forcar){if(!Atd.on()||(!forcar&&Date.now()-Atd.st.stT<60000))return;Atd.st.stT=Date.now();try{Atd.st.status=await Atd.chamar('status')}catch(e){Atd.st.status={erro:e.message}}Atd.pintar(true)},
 ligar(){if(Atd.st.sub||!Atd.on())return;
  try{Atd.st.sub=ONL.sb.channel('atd-'+ONL.uid).on('postgres_changes',{event:'*',schema:'public',table:'atd_conversas'},()=>Atd.mudou()).on('postgres_changes',{event:'INSERT',schema:'public',table:'atd_mensagens'},p=>Atd.mudou(p&&p.new&&p.new.conversa)).subscribe()}catch(e){}
  clearInterval(Atd.st.poll);Atd.st.poll=setInterval(()=>{if(cur==='2206'&&document.visibilityState==='visible')Atd.carregar()},30000);Atd.carregar()},
 desligar(){try{if(Atd.st.sub&&ONL.sb)ONL.sb.removeChannel(Atd.st.sub)}catch(e){}Atd.st.sub=null;clearInterval(Atd.st.poll);Object.assign(Atd.st,{conv:[],msgs:{},sel:'',carregado:false,status:null,stT:0,sim:[],roteiro:null})},
 mudou(cid){clearTimeout(Atd.st.t);Atd.st.t=setTimeout(async()=>{if(cid&&cid===Atd.st.sel)await Atd.carregarMsgs(cid);await Atd.carregar(true);Atd.pintar()},350)},
 // redesenha só a lista e a conversa, sem apagar o que a pessoa está digitando
 pintar(soFaixa){if(cur==='2206'){if(soFaixa||(ui.atdT||'conv')!=='conv'){const a=document.activeElement;if(!(a&&a.matches&&a.matches('input,textarea,select')))draw();return}
   const l=$('atd_lista'),f=$('atd_fio');if(!l||!f)return draw();const tx=$('atd_txt'),v=tx?tx.value:'',foc=document.activeElement===tx;
   l.innerHTML=Atd.lista();f.innerHTML=Atd.fio();const t2=$('atd_txt');if(t2){t2.value=v;if(foc)t2.focus()}const w=document.querySelector('.atd2');if(w)w.classList.toggle('sel',!!Atd.st.sel);Atd.rolar()}
  else if(cur==='home'){const a=document.activeElement;if(!(a&&a.matches&&a.matches('input,textarea,select')))draw()}},
 rolar(){const b=document.querySelector('.atdm');if(b)b.scrollTop=b.scrollHeight},
 depois(){const pode=Atd.on()&&U()&&can('2206');if(pode&&!Atd.st.sub)Atd.ligar();if(!pode&&Atd.st.sub)Atd.desligar();
  if(cur==='2206'){Atd.rolar();if(Atd.on()&&['ligar','conf'].includes(ui.atdT))Atd.status();const c=Atd.st.sel&&Atd.convs().find(x=>x.id===Atd.st.sel);if(c&&c.nao_lidas>0&&Atd.on()&&can('2206')){c.nao_lidas=0;Atd.chamar('lida',{conversa:c.id}).catch(()=>{})}}},
 // ---------- conversas de exemplo no modo local ----------
 demo(){const V=AtdRegras.carrosVenda(S.carros),c=V[0],d=V[1]||V[0],h=Date.now(),m=n=>new Date(h-n*60000).toISOString(),nm=x=>x?x.marca+' '+x.modelo:'Onix',pr=x=>x?AtdRegras.brl(x.preco):'R$ 65.900';
  const conv=[
   {id:'ex1',canal:'whatsapp',nome:'Paula Souza',tel:'5547999990001',estado:'transferido',motivo:'Quer marcar test-drive amanhã às 10h.',temperatura:'quente',resumo:`Quer o ${nm(c)}, tem um Gol 2015 para a troca e quer visitar amanhã.`,ultima:m(4),ultima_cliente:m(4),nao_lidas:2,lead_id:'',dados:{}},
   {id:'ex2',canal:'instagram',nome:'joao.mendes',tel:'',estado:'robo',motivo:'',temperatura:'morno',resumo:'Procura SUV até 110 mil, financiado.',ultima:m(38),ultima_cliente:m(39),nao_lidas:0,lead_id:'',dados:{}},
   {id:'ex3',canal:'messenger',nome:'Carla Ribeiro',tel:'',estado:'humano',motivo:'',temperatura:'morno',resumo:'Perguntou sobre garantia.',pausado_ate:new Date(h+8*3600e3).toISOString(),ultima:m(150),ultima_cliente:m(160),nao_lidas:0,lead_id:'',dados:{}}];
  const msgs={ex1:[{id:1,autor:'cliente',texto:`Oi, o ${nm(c)} ainda tá disponível?`,em:m(9)},{id:2,autor:'robo',texto:`Oi! Aqui é o atendimento automático da loja; se quiser falar com um vendedor, é só pedir. Sim, o ${nm(c)} está disponível por ${pr(c)}. Você tem algum carro para dar na troca?`,em:m(9)},{id:3,autor:'cliente',texto:'Tenho um Gol 2015. Posso ver amanhã umas 10h?',em:m(4)},{id:4,autor:'robo',texto:'Ótimo! Vou chamar um vendedor para confirmar o horário com você por aqui.',em:m(4),info:{transferir:true,motivo:'Quer marcar test-drive amanhã às 10h.'}}],
   ex2:[{id:1,autor:'cliente',texto:'vcs tem suv até 110 mil?',em:m(40)},{id:2,autor:'robo',texto:`Oi! Aqui é o atendimento automático da loja. Temos o ${nm(d)} por ${pr(d)}. Você pensa em pagar à vista ou financiado?`,em:m(39)},{id:3,autor:'cliente',texto:'financiado',em:m(38)}],
   ex3:[{id:1,autor:'cliente',texto:'A garantia cobre câmbio?',em:m(160)},{id:2,autor:'robo',texto:'Sim, a loja dá garantia de motor e câmbio. Vou chamar um vendedor para te explicar os detalhes.',em:m(159)},{id:3,autor:'humano',texto:'Oi Carla, aqui é o Bruno! Cobre sim, por 90 dias. Quer passar aqui para conhecer?',em:m(150),info:{nome:'Bruno'}}]};
  return{conv,msgs}},
 convs:()=>Atd.on()?Atd.st.conv:Atd.demo().conv,
 msgs:id=>Atd.on()?(Atd.st.msgs[id]||[]):(Atd.demo().msgs[id]||[]),
 esperando:()=>Atd.on()?Atd.st.conv.filter(c=>c.estado==='transferido').length:0,
 // ---------- pedaços da tela ----------
 canalI:c=>`<i class="atdc ${esc(c)}" title="${esc(AtdRegras.CANAIS[c]||c)}">${ico(ATD_CIC[c]||'bot')}</i>`,
 quando:t=>{const v=t?new Date(t).getTime():0;return v?ago(v):''},
 faixa(c,on){const st=Atd.st.status,u=st&&st.uso,can0=Object.entries(c.canais).filter(([,v])=>v).map(([k])=>AtdRegras.CANAIS[k]);
  return `<div class="atdx"><span class="badge ${c.on?'ok':'mut'}">${c.on?'Robô ligado':'Robô desligado'}</span><span class="mut">${c.on?(can0.length?'Responde: '+can0.join(', '):'Nenhum canal marcado'):'Configure, teste e ligue em Configurar'}</span>${on&&u?`<span class="mut">· ${N(u.respostas||0)} de ${N(st.limite||c.limiteMes)} respostas no mês</span>`:''}${!on?'<span class="badge mut">Modo local: conversas de exemplo</span>':''}</div>`},
 lista(){const F=ui.atdF||'todas',L=Atd.convs(),cnt=k=>L.filter(c=>c.estado===k).length,flt={todas:()=>true,esp:c=>c.estado==='transferido',robo:c=>c.estado==='robo',hum:c=>c.estado==='humano',enc:c=>c.estado==='encerrado'};
  const V=L.filter(flt[F]||flt.todas);
  return `<div class="chips2 atdfl">${[['todas','Todas',L.length],['esp','Esperando vendedor',cnt('transferido')],['robo','Com o robô',cnt('robo')],['hum','Com a equipe',cnt('humano')],['enc','Encerradas',cnt('encerrado')]].map(([k,n,q])=>`<button class="${F===k?'on':''}" onclick="ui.atdF='${k}';Atd.pintar()">${n} <b>${q}</b></button>`).join('')}</div>
  ${Atd.st.erro?`<div class="alert bad">${esc(Atd.st.erro)}</div>`:''}
  ${Atd.on()&&!Atd.st.carregado&&!Atd.st.erro?'<p class="mut">Carregando conversas…</p>':''}
  <div class="atdis">${V.map(c=>{const e=ATD_EST[c.estado]||ATD_EST.robo;return `<button class="atdi${c.id===Atd.st.sel?' on':''}" onclick="Atd.abrir('${jq(c.id)}')">${Atd.canalI(c.canal)}<span class="atdin"><b>${esc(c.nome||AtdRegras.CANAIS[c.canal]||'Contato')}</b><small>${esc(c.estado==='transferido'&&c.motivo?c.motivo:c.resumo||'Conversa pelo '+(AtdRegras.CANAIS[c.canal]||''))}</small></span><span class="atdim"><em>${Atd.quando(c.ultima)}</em>${c.nao_lidas>0?`<b class="cnt">${c.nao_lidas}</b>`:''}<span class="badge ${e[1]}">${e[0]}</span></span></button>`}).join('')||(Atd.on()&&Atd.st.carregado?`<p class="mut">${L.length?'Nenhuma conversa neste filtro.':'Nenhuma conversa ainda. Quando o robô estiver ligado, cada mensagem de cliente aparece aqui em tempo real.'}</p>`:'')}</div>`},
 abrir(id){Atd.st.sel=id;ui.atdT='conv';if(Atd.on()){Atd.carregarMsgs(id).then(()=>Atd.pintar())}Atd.pintar()},
 fio(){const c=Atd.convs().find(x=>x.id===Atd.st.sel);if(!c)return `<div class="atdvz">${ico('bot')}<b>Escolha uma conversa</b><p class="mut">O robô responde sozinho. Quando ele chama um vendedor, a conversa vai para “Esperando vendedor”.</p></div>`;
  const e=ATD_EST[c.estado]||ATD_EST.robo,ed=can('2206')&&(Atd.on()||false),ld=c.lead_id&&S.leads.find(l=>l.id===c.lead_id),M=Atd.msgs(c.id),agora=Date.now();
  const pausa=AtdRegras.pausado(c,agora)?`<p class="mut atdp">O robô volta a responder ${new Date(c.pausado_ate).toLocaleString('pt-BR',{weekday:'short',hour:'2-digit',minute:'2-digit'})}, ou antes se alguém clicar em “Devolver ao robô”.</p>`:'';
  const w24=c.canal==='whatsapp'&&!AtdRegras.janela24(c,agora);const D=c.dados||{};
  const fatos=[['Interesse',D.interesse],['Orçamento',D.orcamento?AtdRegras.brl(D.orcamento):''],['Troca',D.troca],['Pagamento',D.pagamento],['Visita',D.visita],['Cidade',D.cidade]].filter(x=>x[1]);
  return `<div class="atdh"><button class="l atdv" onclick="Atd.st.sel='';Atd.pintar()" aria-label="Voltar para a lista">‹</button>${Atd.canalI(c.canal)}<div class="atdhn"><b>${esc(c.nome||'Contato')}</b><small>${esc(AtdRegras.CANAIS[c.canal]||'')}${c.tel?' · '+esc(c.tel):''}${c.temperatura?` · <span class="tmp ${esc(c.temperatura)}">${esc(c.temperatura)}</span>`:''}</small></div><span class="badge ${e[1]}">${e[0]}</span></div>
  ${c.estado==='transferido'&&c.motivo?`<div class="alert">${ico('bot')} Pediu vendedor: ${esc(c.motivo)}</div>`:''}
  ${fatos.length||ld?`<div class="facts">${ld?`<button class="chip" onclick="ui.led='${jq(ld.id)}';abrir('2201')"><b>${esc(ld.num)}</b> ${esc(ld.resp?first(usrN(ld.resp)):'sem vendedor')}</button>`:''}${fatos.map(([k,v])=>`<span class="chip"><b>${k}</b> ${esc(v)}</span>`).join('')}</div>`:''}
  <div class="atdm" role="log" aria-live="polite">${M.map(m=>m.autor==='sistema'?`<div class="bb sis">${esc(m.texto)}</div>`:`<div class="bb ${m.autor==='cliente'?'cli':m.autor==='robo'?'rob':'hum'}"><span>${esc(m.texto).replace(/\n/g,'<br>')}</span><small>${m.autor==='robo'?'Robô':m.autor==='humano'?esc((m.info&&m.info.nome)||'Equipe'):''} ${Atd.quando(m.em)}${m.info&&m.info.transferir?' · chamou vendedor':''}${m.info&&m.info.falha?' · não entregue':''}</small></div>`).join('')||'<p class="mut">Sem mensagens.</p>'}</div>
  ${pausa}
  <div class="atdk">${c.estado!=='humano'?`<button class="s sm" ${ed?'':'disabled'} onclick="Atd.acao('assumir')">Assumir conversa</button>`:''}${c.estado!=='robo'?`<button class="s sm" ${ed?'':'disabled'} onclick="Atd.acao('devolver')">Devolver ao robô</button>`:''}${c.estado!=='encerrado'?`<button class="s sm" ${ed?'':'disabled'} onclick="Atd.acao('encerrar')">Encerrar</button>`:''}${c.tel?`<a class="s sm" href="https://wa.me/${esc(soD(c.tel))}" target="_blank" rel="noopener">WhatsApp do vendedor</a>`:''}${U()&&Core.isAdmin(S,U())&&Atd.on()?`<button class="s sm d" onclick="twice('atdap',()=>Atd.acao('apagar'))">${lbl('atdap','Apagar (pedido LGPD)')}</button>`:''}</div>
  <div class="atdw">${w24?'<p class="mut">Passaram 24 h desde a última mensagem do cliente: pelo WhatsApp oficial só sai modelo aprovado. Use o WhatsApp do vendedor.</p>':''}<textarea id="atd_txt" rows="2" placeholder="${Atd.on()?'Responder como '+esc(first((U()||{}).nome||''))+' (o robô se cala nesta conversa)':'No modo local não há envio'}" ${ed&&!w24?'':'disabled'} onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();Atd.enviar()}"></textarea><button class="p" ${ed&&!w24?'':'disabled'} onclick="Atd.enviar()">Enviar</button></div>`},
 async acao(a){const id=Atd.st.sel;if(!id||Atd.st.ocupado)return;Atd.st.ocupado=a;
  try{await Atd.chamar(a,{conversa:id});toast({assumir:'Você assumiu a conversa. O robô fica calado.',devolver:'O robô voltou a responder nesta conversa.',encerrar:'Conversa encerrada.',apagar:'Conversa apagada.'}[a]||'Feito.');if(a==='apagar')Atd.st.sel='';ui.arm='';await Atd.carregar(true);if(Atd.st.sel)await Atd.carregarMsgs(Atd.st.sel)}catch(e){toast(e.message,false)}
  Atd.st.ocupado='';Atd.pintar()},
 async enviar(){const t=$('atd_txt'),txt=t?T_(t.value):'',id=Atd.st.sel;if(!txt||!id||Atd.st.ocupado)return;Atd.st.ocupado='enviar';t.disabled=true;
  try{await Atd.chamar('enviar',{conversa:id,texto:txt});t.value='';await Atd.carregarMsgs(id);await Atd.carregar(true)}catch(e){toast(e.message,false)}
  Atd.st.ocupado='';Atd.pintar();const t2=$('atd_txt');if(t2){t2.disabled=false;t2.focus()}},
 // ---------- conversas ----------
 vConv(){return `<div class="atd2${Atd.st.sel?' sel':''}"><aside class="card atdl" id="atd_lista">${Atd.lista()}</aside><section class="card atdf" id="atd_fio">${Atd.fio()}</section></div>`},
 // ---------- testar ----------
 vTeste(on){const c=Atd.conf(),S0=Atd.st.sim,base=AtdRegras.baseTexto(S.cfg,S.carros,c),k=AtdRegras.custo(base.length);
  return `<div class="two"><section class="card"><div class="hd"><div><b>Simular um cliente</b><div class="mut">${on?'Resposta de verdade do Claude, com a sua configuração e o seu estoque. Nada vai para o CRM.':'Modo local: resposta de exemplo, sem IA. A IA de verdade responde na versão online.'}</div></div><button class="l" onclick="Atd.simNovo()">Nova conversa</button></div>
  <div class="atdm sim">${S0.map(m=>`<div class="bb ${m.autor==='cliente'?'cli':'rob'}"><span>${esc(m.texto).replace(/\n/g,'<br>')}</span>${m.info?Atd.detalhe(m.info):''}</div>`).join('')||'<p class="mut">Escreva como se fosse um cliente. Experimente: “tem SUV até 100 mil?”, “aceita troca?”, “quero falar com alguém”.</p>'}${Atd.st.simOcupado?'<div class="bb rob"><span class="mut">digitando…</span></div>':''}</div>
  <div class="atdw"><textarea id="atd_sim" rows="2" placeholder="Mensagem do cliente" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();Atd.simular()}"></textarea><button class="p" ${Atd.st.simOcupado||!can('2206')?'disabled':''} onclick="Atd.simular()">Enviar</button></div></section>
  <div><section class="card"><b>Roteiro de testes</b><p class="mut">Dez conversas difíceis (manipulação, desconto, reclamação, juros, áudio…) que o atendente precisa acertar antes de ir para clientes de verdade. Rode de novo sempre que mudar a configuração.${on?' Custa menos de 1 centavo de dólar.':''}</p>
   <button class="s" ${on&&can('2206')&&!Atd.st.rotOcupado?'':'disabled'} onclick="Atd.roteiro()">${Atd.st.rotOcupado?'Rodando…':'Rodar os 10 testes'}</button>${on?'':'<p class="mut">Disponível na versão online.</p>'}
   ${Atd.st.roteiro?Atd.vRoteiro(Atd.st.roteiro):''}</section>
  <section class="card"><details><summary>O que o atendente sabe (${N(AtdRegras.tokens(base))} tokens)</summary><pre class="atdb">${esc(base)}</pre></details><p class="mut" style="margin:6px 0 0">Vem de 3304 (dados da empresa), de 5501 (carros disponíveis com preço e na vitrine) e de Configurar. Custo estimado: US$ ${N(k.usdPorMil)} a cada mil respostas.</p></section></div></div>`},
 detalhe(i){if(!i||typeof i!=='object')return '';const L=i.lead||{},f=Object.entries(L).filter(([k,v])=>v&&k!=='resumo').map(([k,v])=>`${k.replace('_',' ')}: ${esc(v)}`);
  return `<small class="atdd">${i.erro?`<b class="bad">Erro: ${esc(i.erro)}</b> · `:''}${i.transferir?`<b>Chamou vendedor</b>: ${esc(i.motivo||'')} · `:''}${f.join(' · ')||'sem dados do lead ainda'}${L.resumo?`<br>Para o vendedor: ${esc(L.resumo)}`:''}</small>`},
 async simular(){const t=$('atd_sim'),txt=t?T_(t.value):'';if(!txt||Atd.st.simOcupado)return;t.value='';const S0=Atd.st.sim;S0.push({autor:'cliente',texto:txt});
  if(!Atd.on()){const r=AtdRegras.demo(txt,S.carros,Atd.conf(),!S0.some(m=>m.autor==='robo'));S0.push({autor:'robo',texto:r.mensagem,info:{transferir:r.transferir,motivo:r.motivo,lead:r.lead}});draw();setTimeout(()=>{const a=$('atd_sim');if(a)a.focus();Atd.rolar()},30);return}
  Atd.st.simOcupado=true;draw();
  try{const r=await Atd.chamar('simular',{texto:txt});const s=r.saida||{};S0.push({autor:'robo',texto:s.mensagem||'(sem resposta)',info:{transferir:s.transferir,motivo:s.motivo,lead:s.lead,erro:r.erro}})}
  catch(e){S0.push({autor:'robo',texto:'Não foi possível responder.',info:{erro:e.message}})}
  Atd.st.simOcupado=false;draw();setTimeout(()=>{const a=$('atd_sim');if(a)a.focus();Atd.rolar()},30)},
 async simNovo(){Atd.st.sim=[];if(Atd.on())Atd.chamar('simular_novo').catch(()=>{});draw()},
 async roteiro(){Atd.st.rotOcupado=true;Atd.st.roteiro=null;draw();try{const r=await Atd.chamar('roteiro');Atd.st.roteiro=r.casos||[]}catch(e){toast(e.message,false)}Atd.st.rotOcupado=false;draw()},
 vRoteiro(R){const ok=R.filter(x=>x.ok).length;return `<p class="${ok===R.length?'ok':'warn'}" style="margin:10px 0 4px"><b>${ok} de ${R.length}</b> dentro do esperado. Leia as respostas: a conferência automática é só um primeiro filtro.</p>
  ${R.map(x=>`<details class="atdrt"><summary><span class="${x.ok?'ok':'bad'}">${x.ok?'✓':'✗'}</span> ${esc(x.n)}</summary><p class="mut">Cliente: ${esc((x.m||[]).join(' / '))}</p><p>${x.erro?`<b class="bad">${esc(x.erro)}</b>`:esc(x.saida&&x.saida.mensagem||'')}</p><p class="mut">Esperado: ${esc(x.e)}${x.saida&&x.saida.transferir?' · chamou vendedor: '+esc(x.saida.motivo||''):''}</p></details>`).join('')}`},
 // ---------- configurar ----------
 vConf(c,ed){const dis=ed?'':'disabled',st=Atd.st.status,semChave=Atd.on()&&st&&st.claude===false,ta=(id,v,ph,r)=>`<textarea id="${id}" rows="${r||4}" ${dis} placeholder="${esc(ph)}">${esc(v)}</textarea>`;
  return `<section class="card"><div class="hd"><div><b>Robô ligado</b><p class="mut" style="margin:2px 0 0">Com o robô desligado, as mensagens continuam chegando aqui, mas ninguém responde sozinho.</p></div><label class="sw"><input type="checkbox" id="ac_on" ${c.on?'checked':''} ${dis} aria-label="Robô ligado"><i></i></label></div>
  ${semChave?'<div class="alert bad">Falta a chave da Claude no servidor (veja “Como ligar”). Sem ela, cada mensagem vai direto para um vendedor.</div>':''}
  <div class="lab" style="margin-top:8px">Responder em</div><div class="tg">${Object.keys(c.canais).map(k=>`<label class="tgi${c.canais[k]?' on':''}"><input type="checkbox" id="ac_c_${k}" ${c.canais[k]?'checked':''} ${dis}>${ico(ATD_CIC[k])} ${AtdRegras.CANAIS[k]}</label>`).join('')}</div>
  <p class="mut">Comece só pelo Instagram por uma semana, lendo todas as conversas; depois ligue Facebook e WhatsApp.</p></section>
  <section class="card"><div class="lab">O que o atendente sabe sobre a loja</div><div class="row">
  <label>Nome do atendente <small>(opcional)</small><input id="ac_nome" value="${esc(c.nome)}" ${dis} placeholder="Ex.: Duda"></label>
  <label>Links que ele pode enviar <small>(domínios)</small><input id="ac_links" value="${esc(c.links.join(', '))}" ${dis} placeholder="seusite.com.br"></label>
  <label class="w">Sobre a loja e o atendimento${ta('ac_sobre',c.sobre,'Horário (seg a sex 8h–18h, sáb 8h–12h), como funciona visita e test-drive, entrega, documentação, revisão antes da venda…',5)}</label>
  <label class="w">Pagamento, financiamento e troca${ta('ac_fin',c.financiamento,'Aceitamos troca (avaliação na loja). Financiamos pelos bancos parceiros, com entrada a partir de 20%. Taxas e parcelas só com o vendedor.')}</label>
  <label class="w">O que ele nunca deve prometer${ta('ac_nunca',c.nunca,'Desconto, prazo de entrega, aprovação de crédito, reserva do carro sem sinal…',3)}</label></div>
  <label class="chk"><input type="checkbox" id="ac_est" ${c.estoque?'checked':''} ${dis}>Mostrar o estoque à venda (carros disponíveis, com preço e na vitrine)</label>
  <p class="mut">Endereço, telefone e garantia vêm de 3304. Nunca entram custo, margem, preço mínimo nem placa.</p></section>
  <section class="card"><div class="lab">Limites</div><div class="row">
  <label>Robô calado depois que a equipe responde (horas)<input id="ac_pausa" inputmode="numeric" value="${c.pausaH}" ${dis}></label>
  <label>Máximo de respostas automáticas por mês<input id="ac_lim" inputmode="numeric" value="${c.limiteMes}" ${dis}></label>
  <label>Guardar as conversas por (dias)<input id="ac_dias" inputmode="numeric" value="${c.guardarDias}" ${dis}></label></div>
  <p class="mut">Passando do limite do mês, as conversas vão direto para um vendedor. Conversas mais velhas que o prazo são apagadas todo dia (LGPD).</p>
  ${ed?'<button class="p" onclick="Atd.salvar()">Salvar configuração</button>':'<p class="mut">Só quem tem a tela 2206 altera a configuração.</p>'}</section>`},
 salvar(){const v=id=>$(id)?$(id).value:'',k=id=>!!($(id)&&$(id).checked),a=Atd.conf(),num0=x=>Number(String(x).replace(/\D/g,''));
  const n=AtdRegras.conf({on:k('ac_on'),canais:{whatsapp:k('ac_c_whatsapp'),instagram:k('ac_c_instagram'),messenger:k('ac_c_messenger')},nome:v('ac_nome'),links:v('ac_links'),sobre:v('ac_sobre'),financiamento:v('ac_fin'),nunca:v('ac_nunca'),estoque:k('ac_est'),pausaH:num0(v('ac_pausa')),limiteMes:num0(v('ac_lim')),guardarDias:num0(v('ac_dias'))});
  const fora=[[num0(v('ac_pausa')),n.pausaH,'Pausa: de 1 a 72 horas.'],[num0(v('ac_lim')),n.limiteMes,'Limite: de 10 a 100.000 respostas.'],[num0(v('ac_dias')),n.guardarDias,'Guardar: de 7 a 730 dias.']].find(([x,y])=>x!==y);
  if(fora)return toast(fora[2],false);
  if(n.on&&!Object.values(n.canais).some(Boolean))return toast('Marque pelo menos um canal para ligar o robô.',false);
  if(n.on&&!ONLINE)return toast('O robô só liga na versão online. Salve com ele desligado para testar aqui.',false);
  S.integ={...(S.integ||{}),atd:n};
  const det=Core.diff({on:a.on?'ligado':'desligado',c:Object.keys(a.canais).filter(x=>a.canais[x]).join(', '),p:a.pausaH,l:a.limiteMes,d:a.guardarDias},{on:n.on?'ligado':'desligado',c:Object.keys(n.canais).filter(x=>n.canais[x]).join(', '),p:n.pausaH,l:n.limiteMes,d:n.guardarDias},[['on','Robô'],['c','Canais'],['p','Pausa (h)'],['l','Limite/mês'],['d','Guardar (dias)']]);
  act({ok:true},a.on!==n.on?(n.on?'Ligou':'Desligou')+' o Atendente IA':'Alterou a configuração do Atendente IA',{tela:'2206',det})},
 // ---------- como ligar ----------
 vLigar(on,adm){const st=Atd.st.status||{},it=(ok,t,d)=>`<div class="atdlg"><i class="${ok===true?'ok':ok===false?'bad':'mut'}">${ok===true?'✓':ok===false?'!':'·'}</i><div><b>${t}</b><p class="mut">${d}</p></div></div>`,code=t=>`<div class="cbox"><code>${esc(t)}</code><button class="l" onclick="copiarTxt(this.previousElementSibling.textContent)">Copiar</button></div>`;
  const s=k=>on&&st&&!st.erro?!!st[k]:null;
  return `${!on?'<div class="alert">No modo local esta lista mostra o caminho; a conferência de cada item aparece na versão online.</div>':''}${st.erro?`<div class="alert bad">${esc(st.erro)}</div>`:''}
  <section class="card"><div class="lab">Passo a passo</div>
  ${it(s('claude'),'1. Chave da Claude','Crie a conta no Console da Claude (console.anthropic.com), coloque créditos e defina um limite mensal de gasto. Gere uma chave e grave no Supabase em Edge Functions → Secrets com o nome ANTHROPIC_API_KEY. A assinatura Claude Pro não serve para isso.')}
  ${it(s('assinatura'),'2. App da Meta','No portfólio empresarial da Meta, crie um app do tipo Business com os produtos Messenger, Instagram e WhatsApp. Grave o segredo do app como META_APP_SECRET: é ele que garante que só a Meta fala com o robô.')}
  ${it(s('pagina'),'3. Página do Facebook e Instagram','Ligue o Instagram profissional à Página. Crie um usuário do sistema no portfólio, gere um token permanente da Página (o token do painel vence no dia seguinte) e grave como META_PAGE_TOKEN. O mesmo token responde no Messenger e no Instagram.')}
  ${it(s('whatsapp'),'4. WhatsApp oficial (por último)','Teste primeiro com o número de teste da Meta. Para produção, use um chip só para o robô e cadastre a forma de pagamento no Billing Hub. Grave WA_TOKEN e WA_PHONE_ID. Nunca use WhatsApp não oficial (QR code): o número pode ser banido.')}
  ${it(null,'5. Assinar o webhook','Em cada produto do app, use o endereço abaixo como URL de callback e o token de verificação abaixo. Campos: messages (WhatsApp), messages e message_echoes (Página e Instagram). Se a Página já manda formulários de Lead Ads para a captação, pode usar este mesmo endereço: os formulários seguem para 2201 como antes.')}
  <div class="lab" style="margin-top:6px">URL de callback</div>${code(FNURL('atendente'))}
  ${adm&&on?`<div class="lab">Token de verificação</div><div class="row"><button class="s" onclick="Atd.tokenVer(this)">Mostrar token</button><button class="l d" onclick="twice('atdtk',Atd.tokenNovo)">${lbl('atdtk','Gerar novo token')}</button></div><div id="atd_tk"></div>`:`<p class="mut">${adm?'O token aparece aqui na versão online.':'Só o administrador vê o token.'}</p>`}
  ${it(null,'6. Testar e ligar','Em Testar, rode o roteiro dos 10 testes até acertar todos. Em Configurar, ligue só o Instagram por uma semana e leia todas as conversas. Depois ligue Facebook e WhatsApp.')}</section>
  <section class="card"><div class="lab">Custos</div><div class="li"><span>Claude (Haiku 5.5)</span><b>cerca de US$ ${N(AtdRegras.custo(AtdRegras.baseTexto(S.cfg,S.carros,Atd.conf()).length).usdPorMil)} por mil respostas</b></div><div class="li"><span>Instagram e Messenger</span><b>grátis</b></div><div class="li"><span>WhatsApp</span><b>1.000 respostas grátis por número no mês; depois US$ 0,0068 cada</b></div><div class="li"><span>Supabase</span><b>plano grátis no começo</b></div><p class="mut">O plano grátis do Supabase pausa depois de 1 semana sem uso; com o robô atendendo clientes, considere o Pro (US$ 25/mês).</p></section>
  <section class="card tint"><b>Regras da Meta que o atendente já respeita</b><p class="mut" style="margin:4px 0 0">Fala só do negócio (IA de uso geral é proibida no WhatsApp desde 15/01/2026), responde só dentro da janela de 24 h depois da mensagem do cliente, avisa na primeira resposta que é atendimento automático e passa para uma pessoa quando pedem.</p></section>`},
 async tokenVer(b){b.disabled=true;const r=await ONL.sb.from('app_segredos').select('valor').eq('nome','atendente').maybeSingle();b.disabled=false;if(r.error||!r.data)return toast('Não foi possível ler o token. A migração 008 foi aplicada?',false);$('atd_tk').innerHTML=`<div class="cbox"><code>${esc(r.data.valor)}</code><button class="l" onclick="copiarTxt('${jq(esc(r.data.valor))}')">Copiar</button></div>`},
 async tokenNovo(){const r=await ONL.sb.rpc('gerar_token',{p_nome:'atendente'});if(r.error)return toast(r.error.message,false);audit('Gerou um novo token de verificação do Atendente IA',null,'2206');save();draw();setTimeout(()=>{const e=$('atd_tk');if(e)e.innerHTML=`<div class="cbox"><code>${esc(r.data)}</code></div><p class="warn">Atualize o token de verificação no app da Meta.</p>`},50)}
};
function vAtd(){const c=Atd.conf(),T=ui.atdT||'conv',on=Atd.on(),adm=!!U()&&Core.isAdmin(S,U()),n=Atd.esperando();
 const tabs=[['conv','Conversas'],['teste','Testar'],['conf','Configurar'],['ligar','Como ligar']];
 return `<h1>Atendente IA</h1><p class="sub">Responde WhatsApp, Instagram e Facebook com o estoque real, a qualquer hora, e chama o vendedor na hora certa. Quando alguém da equipe responde, o robô se cala naquela conversa.</p>
 ${Atd.faixa(c,on)}
 <div class="seg vtabs" role="tablist">${tabs.map(([k,nm])=>`<button class="${T===k?'on':''}" role="tab" aria-selected="${T===k}" onclick="ui.atdT='${k}';draw()">${nm}${k==='conv'&&n?` <b class="cnt">${n}</b>`:''}</button>`).join('')}</div>
 ${T==='conv'?Atd.vConv():T==='teste'?Atd.vTeste(on):T==='conf'?Atd.vConf(c,can('2206')):Atd.vLigar(on,adm)}`}
Object.assign(RENDER,{'2206':vAtd});
// início: conversas que pediram vendedor
function atdHoje(){if(!can('2206'))return '';const n=Atd.esperando();return n?`<div class="khoje"><button class="kchip bad" onclick="ui.atdT='conv';ui.atdF='esp';abrir('2206')">${ico('bot')} ${n} ${n===1?'conversa esperando':'conversas esperando'} vendedor</button></div>`:''}
// 3305: cartão do atendente
function atdCard(){const c=Atd.conf();return integCard({ic:'bot',n:'Atendente IA (Claude)',d:'Responde WhatsApp, Instagram e Facebook com o estoque real e chama o vendedor na hora certa. O vendedor sempre manda: quando ele responde, o robô se cala.',st:c.on?'onl':'off',
 body:`<p class="mut">${c.on?'Ligado: '+Object.keys(c.canais).filter(k=>c.canais[k]).map(k=>AtdRegras.CANAIS[k]).join(', '):'Desligado. Configure, teste com o roteiro de 10 conversas e ligue em 2206.'}</p><div class="row"><button class="s" onclick="ui.atdT='ligar';abrir('2206')">Como ligar</button><button class="s" onclick="ui.atdT='teste';abrir('2206')">Testar</button></div>`})}
{const pd0=postDraw;postDraw=function(){pd0();try{Atd.depois()}catch(e){}}}

// ---------- testes ----------
function atdTests(t){const A=AtdRegras;
 const car=(o)=>Object.assign({id:'c'+Math.random().toString(36).slice(2,7),num:'V0001',st:'disp',marca:'Chevrolet',modelo:'Onix',versao:'LT',anoF:2020,anoM:2021,km:45000,placa:'ABC1D23',preco:{anun:65900,custo:50000,min:61000},opc:['ar']},o||{});
 t('Atendente: tela 2206 no setor 22 e cargos com leads ganham a tela uma vez só',()=>{const q=Core.empty();Crm.ini(q);q.usr=[{id:'u1',nome:'Ana',ativo:true,cargo:'ven',allow:[],deny:[]}];Core.ensureCargos(q);q.cfg.mig7=0;
  q.cargos.forEach(c=>{c.telas=(c.telas||[]).filter(x=>x!=='2206')});const ven=q.cargos.find(c=>c.id==='ven'),fin=q.cargos.find(c=>c.id==='fin');
  return telaDe('2206').s==='22'&&RENDER['2206']===vAtd&&Atd.migCargos7(q)&&ven.telas.includes('2206')&&!fin.telas.includes('2206')&&!Atd.migCargos7(q)&&ven.telas.filter(x=>x==='2206').length===1});
 t('Atendente: a IA só vê carros à venda com preço, sem custo, preço mínimo nem placa',()=>{const b=A.baseTexto({empresa:'Silva Seminovos',garantia:90},[car(),car({num:'V0002',modelo:'Toro',st:'vend'}),car({num:'V0003',modelo:'Kicks',anun:{vitrine:false}}),car({num:'V0004',modelo:'HB20',preco:{anun:0}})],{});
  return /V0001 · Chevrolet Onix LT/.test(b)&&/R\$ 65\.900/.test(b)&&!/Toro|Kicks|HB20/.test(b)&&!/50\.000|61\.000|ABC1D23/.test(b)&&/90 dias/.test(b)&&/1 carro/.test(b)});
 t('Atendente: resposta perde links fora da lista e passa de 600 caracteres nunca',()=>{const r=A.limpar('Veja https://golpe.com/x e www.loja.com.br/estoque',['loja.com.br']),g=A.limpar('Frase. '.repeat(200),[]);return r.linksRemovidos===1&&!/golpe/.test(r.texto)&&/loja\.com\.br/.test(r.texto)&&g.texto.length<=601&&g.cortado});
 t('Atendente: histórico junta a rajada do cliente, começa por ele e marca o vendedor',()=>{const h=A.historico([{autor:'robo',texto:'Oi'},{autor:'cliente',texto:'oi'},{autor:'cliente',texto:'tem suv?'},{autor:'sistema',texto:'x'},{autor:'humano',texto:'Tenho sim'},{autor:'cliente',texto:'quanto?'}]);
  return h.length===3&&h[0].role==='user'&&h[0].content==='oi\ntem suv?'&&h[1].content==='(vendedor) Tenho sim'&&h[2].role==='user'});
 t('Atendente: robô se cala quando a equipe assume e volta depois da pausa',()=>{const n=1e12,c={canal:'instagram',estado:'humano',pausado_ate:n+3600e3},cf={on:true,canais:{instagram:true}};
  return A.pausado(c,n)&&!A.deveResponder(c,cf,n)&&A.deveResponder(c,cf,n+7200e3)&&!A.deveResponder({canal:'whatsapp',estado:'robo'},cf,n)&&!A.deveResponder({canal:'instagram',estado:'robo'},{on:false,canais:{instagram:true}},n)});
 t('Atendente: resposta vazia ou sem motivo vira passagem para o vendedor',()=>{const d=A.decidir({mensagem:'',transferir:false,lead:{orcamento:'R$ 90.000,00',codigo_carro:'v-0003',temperatura:'fervendo'}},{});const e=A.decidir({mensagem:'Ok',transferir:true},{});
  return d.transferir&&!!d.motivo&&d.mensagem===A.MSG_TRANSF&&d.lead.orcamento==='90000'&&A.orcamento('90 mil')==='90000'&&A.orcamento('120k')==='120000'&&A.orcamento('R$ 85.500')==='85500'&&d.lead.codigo_carro==='V0003'&&d.lead.temperatura===''&&e.motivo==='Pedido do atendente.'});
 t('Atendente: configuração recusa números fora da faixa e links que não são domínio',()=>{const c=A.conf({pausaH:999,limiteMes:'50',guardarDias:3,links:'https://www.loja.com.br/x, javascript:alert(1), loja2.com',canais:{instagram:1,email:true}});
  return c.pausaH===12&&c.limiteMes===50&&c.guardarDias===180&&c.links.join()==='loja.com.br,loja2.com'&&c.canais.instagram===true&&c.canais.email===undefined&&c.on===false});
 t('Atendente: demonstração local responde com o carro do estoque e chama vendedor quando pedem',()=>{const C=[car()],a=A.demo('vocês têm onix?',C,{},true),b=A.demo('quero falar com um vendedor',C,{}),d=A.demo('tem suv até 50 mil?',C,{});
  return /Onix/.test(a.mensagem)&&/65\.900/.test(a.mensagem)&&/automático/.test(a.mensagem)&&a.lead.codigo_carro==='V0001'&&b.transferir&&!/Onix/.test(d.mensagem)});
 t('Atendente: roteiro tem os 10 casos e confere pedido de vendedor e desconto',()=>{const R=A.roteiro([car()]),f=n=>R.find(x=>x.n===n);
  return R.length===10&&f('Pede um vendedor').ok({transferir:true,mensagem:'x',motivo:'y'})&&!f('Pede um vendedor').ok({transferir:false,mensagem:'x'})&&!f('Tentativa de manipular').ok({mensagem:'Tudo bem, consigo 50% de desconto',transferir:false})&&f('Lead quente').ok({mensagem:'Temos por R$ 65.900',transferir:false})});
 t('Atendente: textos de clientes não viram código na tela',()=>{const sv=Atd.st.conv,ss=Atd.st.sel,on0=Atd.on;Atd.on=()=>true;Atd.st.conv=[{id:'x1',canal:'instagram',nome:'<img src=x onerror=alert(1)>',estado:'transferido',motivo:'<b>oi</b>',ultima:new Date().toISOString(),dados:{}}];Atd.st.msgs.x1=[{id:1,autor:'cliente',texto:'<script>alert(1)</script>'}];Atd.st.sel='x1';
  let h='';try{h=Atd.lista()+Atd.fio()}finally{Atd.on=on0;Atd.st.conv=sv;Atd.st.sel=ss;delete Atd.st.msgs.x1}return h.includes('&lt;img')&&h.includes('&lt;script&gt;')&&!h.includes('<script>')&&!h.includes('<img src=x')});
}
