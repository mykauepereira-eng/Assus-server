#!/usr/bin/env python3
"""Monta o Sistema da Concessionária v7 a partir da página v6 + módulo do Atendente IA.

Entradas (nesta pasta):
  base_v6_local.html  página v6.0 (modo local) como estava publicada
  atd_regras.js       regras puras do atendente (também viram supabase/functions/atendente/regras.js)
  atd_ui.js, atd.css  tela 2206 e ligações com o resto do sistema

Saídas:
  index.html              modo local, documento completo (abrir no navegador, testes)
  demo/index.html         modo local, só o conteúdo (para publicar como artefato de demonstração)
  deploy/index.html       versão online (com a chave pública do Supabase)
  ../site/index.html      cópia da versão online + _headers: a pasta que vai para o Netlify
  ../supabase/functions/  regras.js do atendente e _compartilhado.ts copiado em cada função

As substituições R(a, b, n) falham de propósito se o trecho não aparece exatamente n vezes.
"""
import os
import shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
APP_V = '7.0'
CHAVE_PUBLICA = 'sb_publishable_GPHGsd8unztOgdGD-8uKwA_jloLIUoB'  # pública por desenho: quem protege os dados é o banco (RLS)
SUPA = 'https://mtdgyzfyeyoovmykaomj.supabase.co'


def ler(*p):
    with open(os.path.join(*p), encoding='utf-8') as f:
        return f.read()


def gravar(caminho, txt):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, 'w', encoding='utf-8', newline='\n') as f:
        f.write(txt)


class Montagem:
    def __init__(self, txt):
        self.s = txt

    def R(self, a, b, n=1):
        c = self.s.count(a)
        if c != n:
            raise SystemExit(f'ERRO: esperava {n}x e achei {c}x: {a[:90]!r}')
        self.s = self.s.replace(a, b)


bruto = ler(AQUI, 'base_v6_local.html')
# a página publicada vem embrulhada pelo serviço de artefatos: fica só o conteúdo
ini = bruto.index('<body>\n') + len('<body>\n')
fim = bruto.rindex('</body></html>')
m = Montagem(bruto[ini:fim].rstrip() + '\n')

# versão
m.R("SCHEMA=5,APP_V='6.0'", f"SCHEMA=5,APP_V='{APP_V}'")
# testes do atendente entram no autoteste (3304) e nos testes automáticos
m.R("if(typeof busTests==='function')busTests(t,eq);",
    "if(typeof busTests==='function')busTests(t,eq);if(typeof atdTests==='function')atdTests(t,eq);")
# cargos antigos ganham a tela 2206 (uma vez, pelo administrador)
m.R("c6=(!ONLINE||adm)&&Rnv.migCargos6(S);if(ch||a||b||c6)save()",
    "c6=(!ONLINE||adm)&&Rnv.migCargos6(S),c7=Atd.prep(S,!ONLINE||adm);if(ch||a||b||c6||c7)save()")
# início: aviso de conversas esperando vendedor
m.R("${kbHoje()}${rnvHoje()}${crmHoje()}", "${kbHoje()}${rnvHoje()}${crmHoje()}${atdHoje()}")
# 3305: cartão do atendente
m.R("${integCard({ic:'megafone',n:'Portais de anúncio'", "${atdCard()}${integCard({ic:'megafone',n:'Portais de anúncio'")
# estilo e código novos
m.R('</style>\n<svg width="0"', ler(AQUI, 'atd.css').rstrip() + '\n</style>\n<svg width="0"')
m.R('// ===== Inicialização e atalhos =====',
    ler(AQUI, 'atd_regras.js').rstrip() + '\n' + ler(AQUI, 'atd_ui.js').rstrip() + '\n\n// ===== Inicialização e atalhos =====')

conteudo = m.s
cab, corpo = conteudo.split('\n<svg width="0"', 1)
corpo = '<svg width="0"' + corpo


def documento(c, h):
    return ('<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            f'{c}\n</head><body>\n{h}</body></html>\n')


local = documento(cab, corpo)
gravar(os.path.join(AQUI, 'index.html'), local)
gravar(os.path.join(AQUI, 'demo', 'index.html'), conteudo)

on = Montagem(local)
on.R("key:'COLE_AQUI_A_CHAVE_PUBLICA'", f"key:'{CHAVE_PUBLICA}'")
gravar(os.path.join(AQUI, 'deploy', 'index.html'), on.s)
gravar(os.path.join(RAIZ, 'site', 'index.html'), on.s)
host = SUPA.replace('https://', '')
gravar(os.path.join(RAIZ, 'site', '_headers'), f"""/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: {SUPA}; font-src 'self' data:; connect-src 'self' {SUPA} wss://{host}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), payment=(), usb=()
""")

# servidor: regras do atendente como módulo e utilidades em cada função
fn = os.path.join(RAIZ, 'supabase', 'functions')
gravar(os.path.join(fn, 'atendente', 'regras.js'),
       '// GERADO por fonte/build.py a partir de fonte/atd_regras.js: não edite aqui.\n'
       + ler(AQUI, 'atd_regras.js').rstrip() + '\nexport { AtdRegras };\n')
for nome in sorted(os.listdir(fn)):
    d = os.path.join(fn, nome)
    if os.path.isdir(d) and os.path.exists(os.path.join(d, 'index.ts')):
        shutil.copyfile(os.path.join(fn, '_compartilhado.ts'), os.path.join(d, '_compartilhado.ts'))

print(f'ok · versão {APP_V} · local {len(local)//1024} KB · online {len(on.s)//1024} KB')
