#!/usr/bin/env python3
"""Publica index.html e logo.svg no Firebase Hosting (API REST).

Variáveis: TOKEN (access token), PROJECT, SITE (opcional), QUOTA_PROJECT (opcional), DIR (opcional).
Usado pelo GitHub Actions a cada atualização e pelo setup-hosting.sh na primeira vez.
"""
import os, sys, json, gzip, hashlib, urllib.request, urllib.error

T = os.environ["TOKEN"]
P = os.environ["PROJECT"]
SITE = os.environ.get("SITE")
QP = os.environ.get("QUOTA_PROJECT")
DIR = os.environ.get("DIR", ".")
API = "https://firebasehosting.googleapis.com/v1beta1"
ARQUIVOS = ["index.html", "app.html", "logo.svg", "og.png"]


def call(method, url, body=None, raw=None):
    h = {"Authorization": "Bearer " + T}
    if QP:
        h["x-goog-user-project"] = QP
    data = None
    if raw is not None:
        data, h["Content-Type"] = raw, "application/octet-stream"
    elif body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"ERRO {e.code} em {method} {url}: {e.read().decode()[:500]}")


if not SITE:
    sites = call("GET", f"{API}/projects/{P}/sites").get("sites", [])
    if not sites:
        sys.exit("ERRO: nenhum site de Hosting encontrado no projeto.")
    proprios = [s for s in sites if s.get("type") != "DEFAULT_SITE"]
    SITE = (proprios or sites)[0]["name"].split("/")[-1]

comprimidos, hashes = {}, {}
for f in ARQUIVOS:
    b = gzip.compress(open(os.path.join(DIR, f), "rb").read(), mtime=0)
    h = hashlib.sha256(b).hexdigest()
    comprimidos[h], hashes["/" + f] = b, h

config = {"cleanUrls": True, "headers": [{"glob": "**", "headers": {"Cache-Control": "no-cache"}}]}
versao = call("POST", f"{API}/sites/{SITE}/versions", {"config": config})["name"]
pf = call("POST", f"{API}/{versao}:populateFiles", {"files": hashes})
for h in pf.get("uploadRequiredHashes", []):
    call("POST", f"{pf['uploadUrl']}/{h}", raw=comprimidos[h])
call("PATCH", f"{API}/{versao}?update_mask=status", {"status": "FINALIZED"})
call("POST", f"{API}/sites/{SITE}/releases?versionName={versao}", {})
print(f"Publicado em https://{SITE}.web.app")
