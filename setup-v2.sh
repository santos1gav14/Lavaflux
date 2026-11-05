#!/bin/bash
# Lavaflux v2 (vários estabelecimentos): define o administrador, publica regras e índice
# e libera a publicação automática de regras pelo GitHub.
# Uso (Cloud Shell):  bash <(curl -sL https://raw.githubusercontent.com/santos1gav14/Lavaflux/main/setup-v2.sh) SEU_EMAIL_ADMIN

P=lavaflux-1da77
SAE="github-deploy@$P.iam.gserviceaccount.com"
RAW=https://raw.githubusercontent.com/santos1gav14/Lavaflux/main
ADMIN_EMAIL="$1"

ok(){ echo "   ✅ $1"; }
ruim(){ echo "   ❌ $1"; FALHOU=1; }

echo
echo "=== Lavaflux v2: vários estabelecimentos ==="
[ -z "$ADMIN_EMAIL" ] && { echo "Informe o e-mail do administrador no fim do comando."; exit 1; }
gcloud config set project "$P" -q >/dev/null 2>&1
T=$(gcloud auth print-access-token 2>/dev/null)
[ -z "$T" ] && { echo "Não foi possível obter acesso à sua conta Google."; exit 1; }
H=(-H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json")

echo "1/4 Permissões da publicação automática..."
F=0
for R in roles/firebaserules.admin roles/datastore.indexAdmin; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SAE" --role="$R" --condition=None -q >/dev/null 2>&1 || F=1
done
[ $F = 0 ] && ok "Permissões concedidas" || ruim "Falha ao conceder permissões"

echo "2/4 Definindo o administrador ($ADMIN_EMAIL)..."
UID_ADMIN=$(curl -s -X POST "${H[@]}" -d "{\"email\":[\"$ADMIN_EMAIL\"]}" \
  "https://identitytoolkit.googleapis.com/v1/projects/$P/accounts:lookup" \
  | python3 -c 'import json,sys
try: print(json.load(sys.stdin)["users"][0]["localId"])
except Exception: print("")')
if [ -n "$UID_ADMIN" ]; then
  C=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "${H[@]}" -d '{"fields":{"admin":{"booleanValue":true}}}' \
      "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/admins/$UID_ADMIN")
  [ "$C" = 200 ] && ok "Administrador definido" || ruim "Falha ao gravar administrador (HTTP $C)"
else
  ruim "Não achei uma conta com o e-mail $ADMIN_EMAIL em Authentication"
fi

echo "3/4 Publicando regras de segurança e índice..."
D=$(mktemp -d)
curl -sfL "$RAW/firestore.rules" -o "$D/firestore.rules" && curl -sfL "$RAW/deploy_firestore.py" -o "$D/deploy.py"
OUT=$(TOKEN="$T" PROJECT="$P" QUOTA_PROJECT="$P" DIR="$D" python3 "$D/deploy.py" 2>&1)
if echo "$OUT" | grep -q "Regras publicadas"; then ok "$(echo "$OUT" | tr '\n' ' ')"; else ruim "$OUT"; fi

echo "4/4 Conferindo..."
[ -n "$UID_ADMIN" ] && ok "Tudo certo para a versão nova"

echo
if [ -z "$FALHOU" ]; then
  echo "🎉 Pronto! Avise o Claude para publicar a versão nova do app."
else
  echo "⚠️  Algum passo falhou. Tire um print desta tela e mande para o Claude."
fi
