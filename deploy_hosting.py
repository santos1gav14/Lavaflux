#!/usr/bin/env python3
"""Publica o site e o app no Firebase Hosting (API REST).

Variáveis: TOKEN (access token), PROJECT, SITE (opcional), QUOTA_PROJECT (opcional), DIR (opcional),
PRODUTO (opcional: "pet" publica o Petflux, com o mesmo app e a página/logo da pasta pet/;
"escala" publica o Escalaflux, que tem app e site próprios na pasta escala/).
Usado pelo GitHub Actions a cada atualização e pelo setup-hosting.sh na primeira vez.
"""
import os, sys, json, gzip, hashlib, urllib.request, urllib.error

T = os.environ["TOKEN"]
P = os.environ["PROJECT"]
SITE = os.environ.get("SITE")
QP = os.environ.get("QUOTA_PROJECT")
DIR = os.environ.get("DIR", ".")
API = "https://firebasehosting.googleapis.com/v1beta1"
ARQUIVOS = ["index.html", "app.html", "logo.svg", "og.png", "img/painel.png", "img/cliente.png"]
PRODUTO = os.environ.get("PRODUTO", "")
PET = PRODUTO == "pet"
if PRODUTO == "escala":
    ARQUIVOS = ["index.html", "app.html", "logo.svg", "og.png", "img/coordenacao.png", "img/medico.png"]
    ORIGEM = {f: "escala/" + f for f in ARQUIVOS}
else:
    # No Petflux, o app é o mesmo arquivo; a página inicial, a logo e as imagens vêm da pasta pet/
    ORIGEM = {f: (f if f == "app.html" or not PET else "pet/" + f) for f in ARQUIVOS}
PREFIXO = {"pet": "petflux", "escala": "escalaflux"}.get(PRODUTO)
# privacidade.html e termos.html são RASCUNHOS: entram aqui só depois de revisados e aprovados


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
    sites = [s["name"].split("/")[-1] for s in call("GET", f"{API}/projects/{P}/sites").get("sites", [])]
    if PREFIXO:
        SITE = next((s for s in sites if s.startswith(PREFIXO)), None)
        if not SITE:   # primeira publicação: cria o site do produto (o nome precisa estar livre no Firebase)
            for nome in [PREFIXO, PREFIXO + "-app", PREFIXO + "-br"]:
                req = urllib.request.Request(f"{API}/projects/{P}/sites?siteId={nome}", data=b"{}", method="POST",
                                             headers={"Authorization": "Bearer " + T, "Content-Type": "application/json", **({"x-goog-user-project": QP} if QP else {})})
                try:
                    urllib.request.urlopen(req).read(); SITE = nome; print("Site criado:", nome); break
                except urllib.error.HTTPError as e:
                    print(f"Nome {nome} indisponível ({e.code}): {e.read().decode()[:200]}")
            if not SITE:
                sys.exit("ERRO: não foi possível criar o site " + PREFIXO)
    else:
        SITE = "lavaflux" if "lavaflux" in sites else next((s for s in sites if not s.startswith(("petflux", "escalaflux"))), None)
        if not SITE:
            sys.exit("ERRO: nenhum site de Hosting encontrado no projeto.")

comprimidos, hashes = {}, {}
for f in ARQUIVOS:
    b = gzip.compress(open(os.path.join(DIR, ORIGEM[f]), "rb").read(), mtime=0)
    h = hashlib.sha256(b).hexdigest()
    comprimidos[h], hashes["/" + f] = b, h

config = {"cleanUrls": True, "headers": [{"glob": "**", "headers": {"Cache-Control": "no-cache"}}]}
versao = call("POST", f"{API}/sites/{SITE}/versions", {"config": config})["name"]
pf = call("POST", f"{API}/{versao}:populateFiles", {"files": hashes})
for h in pf.get("uploadRequiredHashes", []):
    call("POST", f"{pf['uploadUrl']}/{h}", raw=comprimidos[h])
call("PATCH", f"{API}/{versao}?update_mask=status", {"status": "FINALIZED"})
CANAL = os.environ.get("CHANNEL")   # canal de prévia: endereço separado, não altera o site em produção
if CANAL:
    req = urllib.request.Request(f"{API}/sites/{SITE}/channels?channelId={CANAL}", data=json.dumps({"ttl": "1209600s"}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + T, "Content-Type": "application/json", **({"x-goog-user-project": QP} if QP else {})})
    try: urllib.request.urlopen(req).read()
    except urllib.error.HTTPError as e:
        if e.code != 409: sys.exit(f"ERRO {e.code} ao criar canal: {e.read().decode()[:300]}")
    call("POST", f"{API}/sites/{SITE}/channels/{CANAL}/releases?versionName={versao}", {})
    print("Prévia publicada em", call("GET", f"{API}/sites/{SITE}/channels/{CANAL}").get("url"))
else:
    call("POST", f"{API}/sites/{SITE}/releases?versionName={versao}", {})
    print(f"Publicado em https://{SITE}.web.app")
