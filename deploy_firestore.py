#!/usr/bin/env python3
"""Publica firestore.rules e garante o índice (est + criadoEm) da coleção lavagens.

Variáveis: TOKEN, PROJECT, QUOTA_PROJECT (opcional), DIR (opcional).
"""
import os, sys, json, urllib.request, urllib.error

T = os.environ["TOKEN"]
P = os.environ["PROJECT"]
QP = os.environ.get("QUOTA_PROJECT")
DIR = os.environ.get("DIR", ".")


def call(method, url, body=None, ok_codes=(200,)):
    h = {"Authorization": "Bearer " + T, "Content-Type": "application/json"}
    if QP:
        h["x-goog-user-project"] = QP
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read()
            return r.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        txt = e.read().decode()
        if e.code in ok_codes:
            return e.code, {}
        sys.exit(f"ERRO {e.code} em {method} {url}: {txt[:500]}")


# 1) Regras
RULES_API = "https://firebaserules.googleapis.com/v1"
fonte = open(os.path.join(DIR, "firestore.rules")).read()
_, rs = call("POST", f"{RULES_API}/projects/{P}/rulesets",
             {"source": {"files": [{"name": "firestore.rules", "content": fonte}]}})
rel = f"projects/{P}/releases/cloud.firestore"
code, _ = call("PATCH", f"{RULES_API}/{rel}", {"release": {"name": rel, "rulesetName": rs["name"]}}, ok_codes=(200, 404))
if code == 404:
    call("POST", f"{RULES_API}/projects/{P}/releases", {"name": rel, "rulesetName": rs["name"]})
print("Regras publicadas")

# 2) Índice composto: lavagens (est ASC, criadoEm DESC)
IDX = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/collectionGroups/lavagens/indexes"
code, _ = call("POST", IDX, {
    "queryScope": "COLLECTION",
    "fields": [{"fieldPath": "est", "order": "ASCENDING"}, {"fieldPath": "criadoEm", "order": "DESCENDING"}]
}, ok_codes=(200, 409))
print("Índice já existia" if code == 409 else "Índice criado (pode levar alguns minutos para ficar pronto)")

# 3) Exclusão automática (TTL): apaga o veículo quando "expiraEm" passa (90 dias após concluir)
FIELD = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/collectionGroups/lavagens/fields/expiraEm"
h = {"Authorization": "Bearer " + T, "Content-Type": "application/json"}
if QP:
    h["x-goog-user-project"] = QP
try:
    with urllib.request.urlopen(urllib.request.Request(FIELD, headers=h)) as r:
        atual = json.loads(r.read())
except urllib.error.HTTPError:
    atual = {}
estado = (atual.get("ttlConfig") or {}).get("state")
if estado in ("ACTIVE", "CREATING"):
    print(f"Exclusão automática já configurada ({estado})")
else:
    req = urllib.request.Request(FIELD + "?updateMask=ttlConfig", data=json.dumps({"ttlConfig": {}}).encode(), method="PATCH", headers=h)
    try:
        urllib.request.urlopen(req).read()
        print("Exclusão automática ativada (leva até 24 h para começar a valer)")
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        print("AVISO: exclusão automática nativa exige o plano Blaze; até lá o app faz a limpeza." if "billing" in msg else f"AVISO: não foi possível ativar a exclusão automática ({e.code}): {msg[:300]}")
