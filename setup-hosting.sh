#!/bin/bash
# Cria o link lavaflux.web.app no Firebase Hosting e liga a publicação automática pelo GitHub.
# Uso (no Cloud Shell do console Firebase):
#   bash <(curl -sL https://raw.githubusercontent.com/santos1gav14/Lavaflux/main/setup-hosting.sh)

P=lavaflux-1da77
PN=744979919279
REPO_ID=1445813233          # ID fixo do repositório santos1gav14/Lavaflux no GitHub
SA=github-deploy
SAE="$SA@$P.iam.gserviceaccount.com"
RAW=https://raw.githubusercontent.com/santos1gav14/Lavaflux/main
API=https://firebasehosting.googleapis.com/v1beta1

ok(){ echo "   ✅ $1"; }
ruim(){ echo "   ❌ $1"; FALHOU=1; }

echo
echo "=== Lavaflux: criando o link .web.app ==="
gcloud config set project "$P" -q >/dev/null 2>&1
T=$(gcloud auth print-access-token 2>/dev/null)
[ -z "$T" ] && { echo "Não foi possível obter acesso à sua conta Google."; exit 1; }
H=(-H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json")

echo "1/6 Ativando serviços (pode levar 1 min)..."
gcloud services enable firebasehosting.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudresourcemanager.googleapis.com -q >/dev/null 2>&1 \
  && ok "Serviços ativos" || ruim "Falha ao ativar serviços"

echo "2/6 Reservando o endereço..."
SITE=""
for S in lavaflux lavaflux-app lavafluxapp lavaflux-br app-lavaflux; do
  C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${H[@]}" -d '{}' "$API/projects/$P/sites?siteId=$S")
  if [ "$C" = 200 ]; then SITE=$S; break; fi
  C=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" "$API/projects/$P/sites/$S")
  if [ "$C" = 200 ]; then SITE=$S; break; fi
done
[ -n "$SITE" ] && ok "Endereço: https://$SITE.web.app" || ruim "Nenhum dos nomes estava livre"

echo "3/6 Liberando login da equipe no novo endereço..."
CFG="https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config"
DOMS=$(curl -s "${H[@]}" "$CFG" | python3 -c 'import json,sys
try: print(json.dumps(json.load(sys.stdin).get("authorizedDomains",[])))
except Exception: print("[]")')
NOVO=$(D="$DOMS" S="$SITE" python3 -c 'import json,os
d=json.loads(os.environ["D"]); s=os.environ["S"]
for x in (s+".web.app", s+".firebaseapp.com"):
    if x not in d: d.append(x)
print(json.dumps({"authorizedDomains":d}))')
C=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "${H[@]}" -d "$NOVO" "$CFG?updateMask=authorizedDomains")
[ "$C" = 200 ] && ok "Domínio autorizado" || ruim "Falha ao autorizar domínio (HTTP $C)"

echo "4/6 Criando a conta de publicação automática..."
gcloud iam service-accounts describe "$SAE" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA" --display-name="Publicação GitHub" -q >/dev/null 2>&1
sleep 5
gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SAE" --role=roles/firebasehosting.admin \
  --condition=None -q >/dev/null 2>&1 && ok "Conta pronta" || ruim "Falha ao dar permissão à conta"

echo "5/6 Conectando ao repositório do GitHub..."
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub" -q >/dev/null 2>&1
gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --display-name="GitHub" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
    --attribute-condition="assertion.repository_id=='$REPO_ID'" -q >/dev/null 2>&1
gcloud iam service-accounts add-iam-policy-binding "$SAE" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID" \
  -q >/dev/null 2>&1 && ok "GitHub conectado" || ruim "Falha ao conectar o GitHub"

echo "6/6 Publicando o app..."
if [ -n "$SITE" ]; then
  D=$(mktemp -d)
  curl -sfL "$RAW/index.html" -o "$D/index.html" && curl -sfL "$RAW/logo.svg" -o "$D/logo.svg" && curl -sfL "$RAW/deploy_hosting.py" -o "$D/deploy.py"
  OUT=$(TOKEN="$T" PROJECT="$P" SITE="$SITE" QUOTA_PROJECT="$P" DIR="$D" python3 "$D/deploy.py" 2>&1)
  echo "$OUT" | grep -q "^Publicado" && ok "$OUT" || ruim "$OUT"
else
  ruim "Sem endereço para publicar"
fi

echo
if [ -z "$FALHOU" ]; then
  echo "🎉 Pronto! Novo link: https://$SITE.web.app"
else
  echo "⚠️  Algum passo falhou. Tire um print desta tela e mande para o Claude."
fi
