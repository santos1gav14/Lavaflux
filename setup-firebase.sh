#!/bin/bash
# Configura o Firebase do Lavaflux: banco, regras, login por e-mail e usuário admin.
# Uso (no Cloud Shell do console Firebase/Google Cloud):
#   bash <(curl -sL https://raw.githubusercontent.com/santos1gav14/Lavaflux/main/setup-firebase.sh)

P=lavaflux-1da77
EMAIL=santos1gav14@gmail.com

ok(){ echo "   ✅ $1"; }
ruim(){ echo "   ❌ $1"; FALHOU=1; }

echo
echo "=== Lavaflux: configurando o Firebase ($P) ==="
gcloud config set project "$P" -q >/dev/null 2>&1
T=$(gcloud auth print-access-token 2>/dev/null)
if [ -z "$T" ]; then echo "Não foi possível obter acesso à sua conta Google."; exit 1; fi
H=(-H "Authorization: Bearer $T" -H "x-goog-user-project: $P" -H "Content-Type: application/json")

echo "1/4 Ativando serviços (pode levar 1 min)..."
gcloud services enable firestore.googleapis.com firebaserules.googleapis.com identitytoolkit.googleapis.com -q >/dev/null 2>&1 \
  && ok "Serviços ativos" || ruim "Falha ao ativar serviços"

echo "2/4 Criando banco de dados em São Paulo..."
if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  ok "Banco já existia"
else
  gcloud firestore databases create --location=southamerica-east1 -q >/dev/null 2>&1 \
    && ok "Banco criado" || ruim "Falha ao criar o banco"
fi

echo "3/4 Publicando regras de segurança..."
RULES=$(cat <<'EOF'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function ehEquipe() {
      return request.auth != null &&
             request.auth.token.email in [
               "santos1gav14@gmail.com"
             ];
    }
    match /lavagens/{id} {
      allow get: if true;
      allow list, create, update, delete: if ehEquipe();
    }
  }
}
EOF
)
BODY=$(RULES="$RULES" python3 -c 'import json,os;print(json.dumps({"source":{"files":[{"name":"firestore.rules","content":os.environ["RULES"]}]}}))')
RS=$(curl -s -X POST "${H[@]}" -d "$BODY" "https://firebaserules.googleapis.com/v1/projects/$P/rulesets" \
     | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("name",""))
except Exception: print("")')
if [ -n "$RS" ]; then
  REL="projects/$P/releases/cloud.firestore"
  C=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "${H[@]}" \
      -d "{\"release\":{\"name\":\"$REL\",\"rulesetName\":\"$RS\"}}" "https://firebaserules.googleapis.com/v1/$REL")
  if [ "$C" != 200 ]; then
    C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${H[@]}" \
        -d "{\"name\":\"$REL\",\"rulesetName\":\"$RS\"}" "https://firebaserules.googleapis.com/v1/projects/$P/releases")
  fi
  [ "$C" = 200 ] && ok "Regras publicadas" || ruim "Falha ao publicar as regras (HTTP $C)"
else
  ruim "Falha ao enviar as regras"
fi

echo "4/4 Ativando login por e-mail e criando seu usuário..."
CFG="https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired"
AUTHBODY='{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}'
R=$(curl -s -X PATCH "${H[@]}" -d "$AUTHBODY" "$CFG")
if echo "$R" | grep -q "CONFIGURATION_NOT_FOUND"; then
  curl -s -X POST "${H[@]}" -d '{}' "https://identitytoolkit.googleapis.com/v2/projects/$P/identityPlatform:initializeAuth" >/dev/null
  sleep 3
  R=$(curl -s -X PATCH "${H[@]}" -d "$AUTHBODY" "$CFG")
fi
if echo "$R" | grep -q '"signIn"'; then
  ok "Login por e-mail ativado"
  echo
  while :; do
    read -r -s -p "   Crie uma senha para $EMAIL (mínimo 6 caracteres): " PW </dev/tty; echo
    [ ${#PW} -ge 6 ] && break
    echo "   Senha curta demais, tente de novo."
  done
  UB=$(E="$EMAIL" S="$PW" python3 -c 'import json,os;print(json.dumps({"email":os.environ["E"],"password":os.environ["S"]}))')
  unset PW
  R=$(curl -s -X POST "${H[@]}" -d "$UB" "https://identitytoolkit.googleapis.com/v1/projects/$P/accounts")
  if echo "$R" | grep -q localId; then ok "Usuário $EMAIL criado"
  elif echo "$R" | grep -q EMAIL_EXISTS; then ok "Usuário $EMAIL já existia (senha não alterada)"
  else ruim "Falha ao criar o usuário: $(echo "$R" | grep -o '"message": *"[^"]*"' | head -1)"; fi
else
  ruim "Falha ao ativar o login: $(echo "$R" | grep -o '"message": *"[^"]*"' | head -1)"
fi

echo
if [ -z "$FALHOU" ]; then
  echo "🎉 Tudo pronto! Abra https://santos1gav14.github.io/lavaflux/ e entre com $EMAIL"
else
  echo "⚠️  Algum passo falhou. Tire um print desta tela e mande para o Claude."
fi
