#!/usr/bin/env python3
"""Migração de privacidade dos veículos já registrados (NÃO EXECUTAR SEM AUTORIZAÇÃO).

Registros antigos guardam o telefone do cliente, o histórico com nomes da equipe e o
nome de quem marcou cada etapa no documento público lavagens/{código}. A versão nova
guarda isso em lavagens/{código}/privado/dados, que só a equipe lê.

Etapas (cada uma precisa ser pedida explicitamente):
  (sem opção)  SIMULAÇÃO: só lista o que seria feito. Não grava nada.
  --copiar     Cria/atualiza privado/dados com telefone e histórico (não apaga nada).
  --limpar     Depois de copiar e conferir: remove telefone e histórico do documento
               público e troca checks {em, por} por apenas o horário. (destrutivo:
               só rode depois de conferir o resultado do --copiar)

Não altera "concluido", não preenche "retirado" (a entrega não é deduzida da conclusão).

Uso no Cloud Shell:
  TOKEN=$(gcloud auth print-access-token) python3 migrar_privacidade.py            # simulação
  TOKEN=$(gcloud auth print-access-token) python3 migrar_privacidade.py --copiar
  TOKEN=$(gcloud auth print-access-token) python3 migrar_privacidade.py --limpar
"""
import os, sys, json, urllib.request, urllib.error

P = os.environ.get("PROJECT", "lavaflux-1da77")
T = os.environ["TOKEN"]
BASE = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
COPIAR, LIMPAR = "--copiar" in sys.argv, "--limpar" in sys.argv


def call(method, url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + T, "x-goog-user-project": P, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        sys.exit(f"ERRO {e.code} {method} {url}: {e.read().decode()[:400]}")


def todos():
    tok = ""
    while True:
        r = call("GET", f"{BASE}/lavagens?pageSize=300" + (f"&pageToken={tok}" if tok else ""))
        for d in (r or {}).get("documents", []):
            yield d
        tok = (r or {}).get("nextPageToken")
        if not tok:
            break


n = {"total": 0, "com_dados_publicos": 0, "copiados": 0, "limpos": 0}
for d in todos():
    nome, f = d["name"], d.get("fields", {})
    n["total"] += 1
    checks = f.get("checks", {}).get("mapValue", {}).get("fields", {})
    checks_com_nome = {k: v for k, v in checks.items() if "mapValue" in v}
    if not ("telefone" in f or "historico" in f or checks_com_nome):
        continue
    n["com_dados_publicos"] += 1
    cod = nome.rsplit("/", 1)[1]
    print(f"- {cod}: telefone={'sim' if 'telefone' in f else 'não'}, histórico={len(f.get('historico', {}).get('arrayValue', {}).get('values', []))}, etapas com nome={len(checks_com_nome)}")
    if COPIAR:
        priv = call("GET", f"{nome}/privado/dados") or {"fields": {}}
        pf = priv.get("fields", {})
        hist_novo = pf.get("historico", {}).get("arrayValue", {}).get("values", [])
        hist_antigo = f.get("historico", {}).get("arrayValue", {}).get("values", [])
        campos = {"est": f["est"], "historico": {"arrayValue": {"values": hist_antigo + [h for h in hist_novo if h not in hist_antigo]}}}
        if "telefone" in f and "telefone" not in pf:
            campos["telefone"] = f["telefone"]
        if "expiraEm" in f:
            campos["expiraEm"] = f["expiraEm"]
        mask = "&".join(f"updateMask.fieldPaths={k}" for k in campos)
        call("PATCH", f"{nome}/privado/dados?{mask}", {"fields": campos})
        n["copiados"] += 1
    if LIMPAR:
        priv = call("GET", f"{nome}/privado/dados")
        if not priv:
            print(f"  pulado: {cod} ainda não foi copiado (rode --copiar antes)")
            continue
        novos_checks = {k: (v["mapValue"]["fields"].get("em", {"nullValue": None}) if "mapValue" in v else v) for k, v in checks.items()}
        campos = {"checks": {"mapValue": {"fields": novos_checks}}}
        # campos ausentes no corpo + presentes na máscara = removidos
        mask = "&".join(f"updateMask.fieldPaths={k}" for k in ["checks", "telefone", "historico"])
        call("PATCH", f"{nome}?{mask}&currentDocument.exists=true", {"fields": campos})
        n["limpos"] += 1

modo = "LIMPEZA" if LIMPAR else "CÓPIA" if COPIAR else "SIMULAÇÃO (nada foi gravado)"
print(f"\n{modo}: {n['total']} veículos lidos, {n['com_dados_publicos']} com dados privados no documento público, "
      f"{n['copiados']} copiados, {n['limpos']} limpos.")
