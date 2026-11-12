#!/usr/bin/env bash
# VetFlow - deploy completo no Azure pelo Cloud Shell (Bash) do portal.azure.com
#
#   curl -sO https://raw.githubusercontent.com/<SEU-GITHUB>/vetflow-bff/main/deploy/azure-deploy.sh
#   bash azure-deploy.sh config      # pergunta Docker Hub, GitHub e MongoDB; grava ~/vetflow.env
#   bash azure-deploy.sh infra       # Resource Group, Azure SQL (free), Service Bus + fila
#   bash azure-deploy.sh services    # Container Apps: ms-pets e ms-appointments (imagens do Docker Hub)
#   bash azure-deploy.sh function    # Function App + deploy do código (repo vetflow-functions)
#   bash azure-deploy.sh bff         # Container App do BFF
#   bash azure-deploy.sh apim        # API Gateway (Azure API Management, Consumption)
#   bash azure-deploy.sh urls        # mostra todas as URLs para o README, o PDF e o vídeo
#
# Cada etapa grava o que criou em ~/vetflow.env, então dá para rodar uma etapa por vez
# (o Cloud Shell expira depois de 20 min parado, mas o arquivo continua lá).
set -euo pipefail
ENV_FILE="$HOME/vetflow.env"
touch "$ENV_FILE"
# shellcheck disable=SC1090
source "$ENV_FILE"

save() { sed -i "/^$1=/d" "$ENV_FILE"; printf '%s=%q\n' "$1" "$2" >> "$ENV_FILE"; export "$1=$2"; }
need() { if [ -z "${!1:-}" ]; then echo "Falta $1. Rode antes: bash azure-deploy.sh $2"; exit 1; fi; }
step() { echo; echo "==> $*"; }

cmd_config() {
  read -rp "Região do Azure permitida na sua assinatura [brazilsouth]: " v; save LOC "${v:-brazilsouth}"
  read -rp "Resource Group [rg-vetflow]: " v; save RG "${v:-rg-vetflow}"
  read -rp "Usuário do Docker Hub: " v; save DH "$v"
  read -rp "Usuário do GitHub: " v; save GH "$v"
  read -rp "Connection string do MongoDB Atlas (mongodb+srv://...): " v; save MONGO "$v"
  [ -n "${SUFFIX:-}" ] || save SUFFIX "$(tr -dc a-z0-9 </dev/urandom | head -c 5)"
  [ -n "${SQLPASS:-}" ] || save SQLPASS "Vf#$(tr -dc A-Za-z0-9 </dev/urandom | head -c 16)9a"
  [ -n "${GW_SECRET:-}" ] || save GW_SECRET "$(tr -dc a-f0-9 </dev/urandom | head -c 32)"
  echo "Configuração salva em $ENV_FILE"
}

cmd_infra() {
  need RG config; need LOC config
  step "Resource Group $RG ($LOC)"
  az group create -n "$RG" -l "$LOC" -o none

  step "Azure SQL Database (oferta gratuita, serverless)"
  save SQLSERVER "vetflow-sql-$SUFFIX"
  az sql server create -g "$RG" -n "$SQLSERVER" -l "$LOC" --admin-user vetflowadmin --admin-password "$SQLPASS" -o none
  az sql server firewall-rule create -g "$RG" -s "$SQLSERVER" -n AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none
  if ! az sql db create -g "$RG" -s "$SQLSERVER" -n vetflow-agenda --edition GeneralPurpose --compute-model Serverless \
       --family Gen5 --capacity 2 --backup-storage-redundancy Local --use-free-limit --free-limit-exhaustion-behavior AutoPause -o none; then
    echo "Oferta gratuita indisponível por CLI; criando Basic (5 DTU, ~US\$5/mês, coberto pelo crédito do Azure for Students)"
    az sql db create -g "$RG" -s "$SQLSERVER" -n vetflow-agenda --service-objective Basic -o none
  fi
  save SQL "Server=tcp:$SQLSERVER.database.windows.net,1433;Database=vetflow-agenda;User Id=vetflowadmin;Password=$SQLPASS;Encrypt=true;TrustServerCertificate=false;Connection Timeout=60"

  step "Azure Service Bus (Basic) + fila vetflow-eventos"
  save SBNS "vetflow-bus-$SUFFIX"
  az servicebus namespace create -g "$RG" -n "$SBNS" -l "$LOC" --sku Basic -o none
  az servicebus queue create -g "$RG" --namespace-name "$SBNS" -n vetflow-eventos --max-delivery-count 5 -o none
  save SB "$(az servicebus namespace authorization-rule keys list -g "$RG" --namespace-name "$SBNS" -n RootManageSharedAccessKey --query primaryConnectionString -o tsv)"
  echo "Infra pronta."
}

fqdn() { az containerapp show -n "$1" -g "$RG" --query properties.configuration.ingress.fqdn -o tsv; }

cmd_services() {
  need DH config; need SQL infra; need SB infra; need MONGO config
  step "Container Apps environment"
  az extension add --name containerapp --upgrade -y -o none 2>/dev/null || true
  az provider register -n Microsoft.App --wait -o none
  az provider register -n Microsoft.OperationalInsights --wait -o none
  az containerapp env show -n env-vetflow -g "$RG" -o none 2>/dev/null || az containerapp env create -n env-vetflow -g "$RG" -l "$LOC" -o none

  step "ms-pets (MongoDB Atlas)"
  az containerapp create -n vetflow-ms-pets -g "$RG" --environment env-vetflow \
    --image "docker.io/$DH/vetflow-ms-pets:v1" --target-port 3001 --ingress external \
    --min-replicas 1 --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
    --secrets mongo-uri="$MONGO" --env-vars MONGODB_URI=secretref:mongo-uri -o none
  save PETS "https://$(fqdn vetflow-ms-pets)"

  step "ms-appointments (Azure SQL + Service Bus)"
  az containerapp create -n vetflow-ms-appointments -g "$RG" --environment env-vetflow \
    --image "docker.io/$DH/vetflow-ms-appointments:v1" --target-port 3002 --ingress external \
    --min-replicas 1 --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
    --secrets sql-conn="$SQL" sb-conn="$SB" \
    --env-vars SQL_CONNECTION_STRING=secretref:sql-conn SERVICEBUS_CONNECTION=secretref:sb-conn SERVICEBUS_QUEUE=vetflow-eventos -o none
  save APPTS "https://$(fqdn vetflow-ms-appointments)"

  echo "Aguardando os serviços subirem..."; sleep 40
  curl -s "$PETS/health"; echo; curl -s "$APPTS/health"; echo
}

cmd_function() {
  need SB infra; need GH config
  save FN "vetflow-fn-$SUFFIX"
  save ST "vetflowst$SUFFIX"
  step "Storage + Function App $FN (Node 22)"
  az storage account create -n "$ST" -g "$RG" -l "$LOC" --sku Standard_LRS --allow-blob-public-access false -o none
  if ! az functionapp create -n "$FN" -g "$RG" --storage-account "$ST" --flexconsumption-location "$LOC" \
       --runtime node --runtime-version 22 -o none; then
    echo "Flex Consumption indisponível nessa região; usando Consumption (Linux)"
    az functionapp create -n "$FN" -g "$RG" --storage-account "$ST" --consumption-plan-location "$LOC" \
      --os-type Linux --runtime node --runtime-version 22 --functions-version 4 -o none
  fi
  az functionapp config appsettings set -n "$FN" -g "$RG" -o none \
    --settings "SERVICEBUS_CONNECTION=$SB" SERVICEBUS_QUEUE=vetflow-eventos NOTIFICATIONS_TABLE=notificacoes

  step "Deploy do código (github.com/$GH/vetflow-functions)"
  rm -rf "$HOME/vetflow-functions"
  git clone -q "https://github.com/$GH/vetflow-functions.git" "$HOME/vetflow-functions"
  (cd "$HOME/vetflow-functions" && npm install --omit=dev --no-audit --no-fund)
  if command -v func >/dev/null; then
    (cd "$HOME/vetflow-functions" && func azure functionapp publish "$FN" --javascript)
  else
    (cd "$HOME/vetflow-functions" && rm -f ../fn.zip && zip -qr ../fn.zip . -x '.git/*' 'tests/*')
    az functionapp deployment source config-zip -g "$RG" -n "$FN" --src "$HOME/fn.zip" -o none
  fi
  save FNURL "https://$(az functionapp show -n "$FN" -g "$RG" --query properties.defaultHostName -o tsv)/api"
  sleep 20; curl -s "$FNURL/health"; echo
}

cmd_bff() {
  need PETS services; need APPTS services; need FNURL function
  step "BFF"
  az containerapp create -n vetflow-bff -g "$RG" --environment env-vetflow \
    --image "docker.io/$DH/vetflow-bff:v1" --target-port 3000 --ingress external \
    --min-replicas 1 --max-replicas 1 --cpu 0.25 --memory 0.5Gi \
    --secrets gw-secret="$GW_SECRET" \
    --env-vars PETS_SERVICE_URL="$PETS" APPOINTMENTS_SERVICE_URL="$APPTS" FUNCTIONS_URL="$FNURL" \
      GATEWAY_SECRET=secretref:gw-secret CORS_ORIGIN='*' -o none
  save BFF "https://$(fqdn vetflow-bff)"
  sleep 30
  curl -s "$BFF/health"; echo
  echo "Chamada direta ao BFF (deve dar 401, só aceita pelo API Gateway):"
  curl -s "$BFF/aggregated-data"; echo
}

cmd_apim() {
  need BFF bff
  save APIM "vetflow-apim-$SUFFIX"
  step "Azure API Management (Consumption) - leva alguns minutos"
  az apim show -n "$APIM" -g "$RG" -o none 2>/dev/null || \
    az apim create -n "$APIM" -g "$RG" -l "$LOC" --sku-name Consumption --publisher-name VetFlow --publisher-email "vetflow@example.com" -o none
  az apim nv create -g "$RG" --service-name "$APIM" --named-value-id gateway-secret --display-name gateway-secret \
    --value "$GW_SECRET" --secret true -o none 2>/dev/null || true

  step "Importando o OpenAPI do BFF como API 'vetflow'"
  az apim api import -g "$RG" --service-name "$APIM" --api-id vetflow --path vetflow --display-name "VetFlow BFF" \
    --specification-format OpenApiJson --specification-url "$BFF/docs/openapi.json" --service-url "$BFF" \
    --protocols https -o none
  az apim api update -g "$RG" --service-name "$APIM" --api-id vetflow --subscription-required false -o none
  # Preflight CORS: repassa OPTIONS para o BFF, que responde com os cabeçalhos CORS
  az apim api operation create -g "$RG" --service-name "$APIM" --api-id vetflow --operation-id cors-preflight \
    --display-name "CORS preflight" --method OPTIONS --url-template "/*" -o none 2>/dev/null || true

  step "Política: injeta x-gateway-secret, limita requisições por IP e registra o gateway"
  SUB=$(az account show --query id -o tsv)
  python3 - "$SUB" "$RG" "$APIM" <<'PY'
import json, subprocess, sys
sub, rg, apim = sys.argv[1:4]
policy = """<policies>
  <inbound>
    <base />
    <rate-limit-by-key calls="120" renewal-period="60" counter-key="@(context.Request.IpAddress)" />
    <set-header name="x-gateway-secret" exists-action="override"><value>{{gateway-secret}}</value></set-header>
    <set-header name="x-forwarded-by" exists-action="override"><value>azure-api-management</value></set-header>
  </inbound>
  <backend><base /></backend>
  <outbound>
    <base />
    <set-header name="x-api-gateway" exists-action="override"><value>vetflow-apim</value></set-header>
  </outbound>
  <on-error><base /></on-error>
</policies>"""
url = f"https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.ApiManagement/service/{apim}/apis/vetflow/policies/policy?api-version=2022-08-01"
def put(xml):
    body = json.dumps({"properties": {"format": "rawxml", "value": xml}})
    return subprocess.run(["az", "rest", "--method", "put", "--uri", url, "--body", body, "-o", "none"]).returncode
if put(policy) != 0:
    print("rate-limit-by-key não aceito neste tier; aplicando a política sem ele")
    lines = [l for l in policy.splitlines() if "rate-limit" not in l]
    if put("\n".join(lines)) != 0:
        sys.exit("Falha ao aplicar a política do API Management")
PY
  save GATEWAY "https://$APIM.azure-api.net/vetflow"
  az containerapp update -n vetflow-bff -g "$RG" --set-env-vars GATEWAY_PUBLIC_URL="$GATEWAY" -o none
  sleep 10
  echo "Pelo API Gateway:"; curl -s "$GATEWAY/health" ; echo
  curl -s "$GATEWAY/aggregated-data" | head -c 400; echo
  echo
  echo "Agora configure o frontend: no repo vetflow-frontend, Settings > Secrets and variables > Actions > Variables:"
  echo "   VETFLOW_API_URL = $GATEWAY"
  echo "e rode o workflow 'Testes e deploy no GitHub Pages' (Actions > Run workflow)."
}

cmd_urls() {
  cat <<EOF

================ LINKS DO VETFLOW (para README, PDF e vídeo) ================
Frontend (GitHub Pages)      https://${GH:-<github>}.github.io/vetflow-frontend/
API Gateway (APIM)           ${GATEWAY:-<rode apim>}
  aggregated-data            ${GATEWAY:-}/aggregated-data
BFF                          ${BFF:-}
  Swagger BFF                ${BFF:-}/docs/
ms-pets (MongoDB)            ${PETS:-}
  Swagger                    ${PETS:-}/docs/
ms-appointments (Azure SQL)  ${APPTS:-}
  Swagger                    ${APPTS:-}/docs/
  AsyncAPI (eventos)         ${APPTS:-}/docs/events/
  Eventos (outbox)           ${APPTS:-}/events
Azure Function               ${FNURL:-}
  health / notificacoes      ${FNURL:-}/health   ${FNURL:-}/notificacoes
GitHub                       https://github.com/${GH:-}/vetflow-{frontend,bff,ms-pets,ms-appointments,functions}
Docker Hub                   https://hub.docker.com/r/${DH:-}/vetflow-{bff,ms-pets,ms-appointments}
=============================================================================
EOF
}

case "${1:-}" in
  config|infra|services|function|bff|apim|urls) "cmd_$1" ;;
  all) cmd_infra; cmd_services; cmd_function; cmd_bff; cmd_apim; cmd_urls ;;
  *) sed -n '2,15p' "$0" ;;
esac
