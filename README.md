# VetFlow · BFF (Backend for Frontend)

Backend dedicado ao microfrontend do VetFlow, em **Node.js + Express**. O frontend só conversa com o BFF (através do **API Gateway**), e o BFF:
- **agrega** dados: `GET /aggregated-data` chama em paralelo o **ms-pets (MongoDB)**, o **ms-appointments (Azure SQL)** e a **Azure Function**, e devolve um único JSON;
- **repassa** o CRUD (proxy) de pets, prontuário, consultas, serviços, eventos e notificações;
- **orquestra** o agendamento: busca o pet no ms-pets e completa nome e e-mail do tutor antes de criar a consulta no ms-appointments.

**Alunos:** Bernardo Vieira · Murilo Regnier
PUCPR · Engenharia de Software · Arquitetura e Soluções Cloud · PJBL Entrega 3

## Links (nuvem)
| Item | URL |
|---|---|
| BFF (Azure Container Apps) | `https://vetflow-bff.<ambiente>.azurecontainerapps.io` |
| Swagger do BFF | `https://vetflow-bff.<ambiente>.azurecontainerapps.io/docs/` |
| Pelo API Gateway | `https://<apim>.azure-api.net/vetflow/aggregated-data` |
| Imagem Docker Hub | `https://hub.docker.com/r/<usuario>/vetflow-bff` |

## Fluxo do `GET /aggregated-data`
1. O frontend chama `GET /aggregated-data` no API Gateway, que encaminha ao BFF com o cabeçalho `x-gateway-secret`.
2. O BFF chama em paralelo `GET /pets` (MongoDB), `GET /appointments` e `GET /services` (Azure SQL) e `GET /api/notificacoes` (Function).
3. Com as consultas em mãos, chama `POST /api/indicadores` na Function, que calcula os indicadores.
4. Monta um único JSON: `sources` (status e tempo de cada chamada), `summary`, `upcoming`, `pets`, `appointments` (com os dados do pet anexados), `services`, `indicators` e `notifications`.
5. Se um serviço cair, a resposta continua (status `error` naquela fonte e `summary.degraded = true`).

Toda chamada leva o `x-correlation-id`, então a mesma requisição pode ser seguida nos logs do BFF e dos microserviços.

## Arquitetura
```
src/
  domain/          dashboard.js (montagem da resposta agregada), errors.js (UpstreamError)
  application/
    ports.js       ServiceClient, Clock
    shared/        upstream.js (callJson, timed)
    features/      GetAggregatedData, CreateAppointment, ForwardRequest
  infrastructure/  HttpServiceClient (fetch com timeout, retry de GET e correlation id), config
  api/             features/<Feature>/endpoint.js, http/gateway.js (exige o API Gateway), openapi.js
  main.js          composition root
```
O BFF não tem regra de negócio: os erros 400/404/409 dos microserviços são repassados com o mesmo status.

## Endpoints
`GET /aggregated-data` · `GET|POST /pets` · `GET|PUT|DELETE /pets/{id}` · `POST /pets/{id}/records` · `GET|POST /appointments` · `GET|PUT|DELETE /appointments/{id}` · `PATCH /appointments/{id}/confirm` · `PATCH /appointments/{id}/cancel` · `GET /services` · `GET /events` · `GET /notifications` · `GET /health` · `GET /docs/`

## Tecnologias
Node.js 22, Express 4, `fetch` nativo, Docker, GitHub Actions, `node:test`.

## Variáveis
| Variável | Exemplo |
|---|---|
| `PETS_SERVICE_URL` | `https://vetflow-ms-pets.<ambiente>.azurecontainerapps.io` |
| `APPOINTMENTS_SERVICE_URL` | `https://vetflow-ms-appointments.<ambiente>.azurecontainerapps.io` |
| `FUNCTIONS_URL` | `https://<function-app>.azurewebsites.net/api` |
| `GATEWAY_SECRET` | segredo que o API Gateway injeta em `x-gateway-secret` (sem ele, chamada direta recebe 401) |
| `GATEWAY_PUBLIC_URL` | URL do API Gateway (aparece no Swagger) |
| `CORS_ORIGIN` | `*` ou a URL do frontend |

## Como rodar localmente
```bash
npm install
npm test
npm start      # padrão: ms-pets :3001, ms-appointments :3002, functions :7071
```

## Docker
```bash
docker build -t <usuario-dockerhub>/vetflow-bff:v1 .
docker login
docker push <usuario-dockerhub>/vetflow-bff:v1
```
