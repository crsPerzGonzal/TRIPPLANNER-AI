# Integración de AgentCore

Para el diagrama completo, permisos y despliegue de una cuenta nueva, consulta [architecture.md](architecture.md) y [deployment.md](deployment.md).

## Versión desplegada de referencia

El Orchestrator usa dos versiones para separar autenticación: `COGNITO` está `READY` en la versión 43 con autorizador JWT del User Pool y encabezados permitidos para el frontend; `DEFAULT` está `READY` en la versión 44 con IAM SigV4. Ambos contienen el prompt que limita al Orchestrator a planificación y gestión de viajes y redirige amablemente solicitudes fuera de ese alcance. CORS respondió al preflight del dominio CloudFront con los encabezados requeridos; AgentCore devuelve `Access-Control-Allow-Origin: *`.

## Flujo

El chat se conecta directamente con el runtime Orchestrator mediante `InvokeAgentRuntime` y `text/event-stream`. Las operaciones de negocio siguen usando API Gateway, Lambda y DynamoDB; AgentCore no se convierte en intermediario de esos datos.

El frontend envía `{ "prompt": "..." }`, un access token de Cognito como `Authorization: Bearer ...`, el ID token como `X-TripPlanner-Business-Token` y un `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` aleatorio. El cliente procesa los eventos SSE progresivamente y muestra los errores del runtime.

## Autenticación y memoria

- El endpoint `COGNITO` valida access tokens del User Pool mediante su documento OIDC y el app client configurado.
- `DEFAULT` permanece en IAM SigV4 y `COGNITO` sirve la versión con JWT. AgentCore avanza automáticamente `DEFAULT` al actualizar el runtime; después de cada despliegue hay que verificar que `DEFAULT` siga en IAM y que `COGNITO` apunte a la versión JWT.
- El Orchestrator localiza `Authorization` sin distinguir mayúsculas/minúsculas en los encabezados del contexto o de la petición HTTP original y usa el claim `sub` del access token validado por AgentCore como `actor_id` de AgentCore Memory; rechaza tokens ausentes, malformados o que no sean de tipo `access`.
- El runtime requiere un identificador de sesión de 33 a 256 caracteres. El frontend crea un UUID por conversación.
- El Orchestrator usa el ID token solo al invocar la API de negocio; API Gateway valida ese token y Lambda obtiene el propietario desde sus claims. El token nunca forma parte de los argumentos visibles de las Tools.
- No se distribuyen credenciales AWS al navegador. Los runtimes Flights y Weather siguen siendo agentes independientes invocados por A2A.

## Variables de entorno del frontend

| Variable | Propósito |
|---|---|
| `VITE_AGENTCORE_REGION` | Región del runtime. |
| `VITE_AGENTCORE_RUNTIME_ARN` | ARN público del Orchestrator. |
| `VITE_AGENTCORE_ENDPOINT_NAME` | Endpoint JWT; en desarrollo es `COGNITO`. |

## Integración de Flights y Weather

El Orchestrator delega en los runtimes A2A existentes; no sustituye la arquitectura
multiagente:

```text
Orchestrator → Flights Agent → Alice Flights MCP (Streamable HTTP + OAuth 2.0)
Orchestrator → Weather Agent → weather-forecast-server MCP (STDIO)
```

Alice Flights es de solo lectura y exige un consentimiento OAuth inicial. El cliente usa
PKCE y guarda únicamente el client ID y refresh token en AWS Secrets Manager. El runtime
Flights necesita `secretsmanager:GetSecretValue` y `secretsmanager:PutSecretValue` sobre ese
secreto para renovar tokens que roten; no deben incluirse tokens en variables de entorno ni
en el repositorio. La guía de autorización está en [agents/flight/README.md](../agents/flight/README.md).
Para iniciar esa autorización desde una terminal con credenciales AWS, ejecuta
`python agents\flight\authorize_alice.py --region us-east-1` y acepta el consentimiento en
el navegador. El callback local escucha solo en `127.0.0.1`.

Weather ejecuta `weather-forecast-server` como proceso STDIO dentro del runtime Weather,
sin API key. El servidor consulta wttr.in y usa Open-Meteo como alternativa. Su pronóstico
cubre hasta tres días y no siempre proporciona probabilidad de lluvia; el agente no debe
inventar información ausente. La atribución y limitaciones están en
[agents/weather/README.md](../agents/weather/README.md).

## Tools registradas

Las Tools de negocio de Strands están en `agents/orchestrator/business_tools.py`. Todas usan el ID token validado por API Gateway y no reciben un `userId` del modelo:

| Tool | Operación |
|---|---|
| `create_trip`, `get_trips`, `update_trip` | Crear, listar y actualizar viajes. |
| `get_travel_preferences`, `save_travel_preferences` | Consultar y guardar preferencias. |
| `get_itinerary`, `create_itinerary`, `update_itinerary` | Leer, crear y reemplazar itinerarios. |
| `create_reservation`, `get_reservations`, `update_reservation` | Crear reserva simulada, listar y actualizar estado. |
| `ask_flights`, `ask_weather` | Delegar consultas al agente A2A correspondiente. |

Flights expone las Tools anunciadas por Alice MCP; el código exige que exista `search_flights`. Weather expone las Tools de `weather-forecast-server` y exige `get_weather`. Los nombres efectivos se consultan desde cada servidor MCP en el arranque, por lo que la disponibilidad externa puede cambiar.

## Configuración del runtime

| Variable | Propósito |
|---|---|
| `TRIPPLANNER_BUSINESS_API_URL` | URL base desplegada de API Gateway, incluido el stage (por ejemplo, `/prod`). |
| `ALICE_OAUTH_SECRET_ID` | Identificador de AWS Secrets Manager que contiene las credenciales renovables de Alice; solo se configura en Flights. |

El runtime debe incluir `Authorization` y `X-TripPlanner-Business-Token` en `requestHeaderConfiguration.requestHeaderAllowlist`. Además, el preflight CORS debe permitir el origen del frontend, `POST`, ambos encabezados de autenticación, `Content-Type` y el encabezado de sesión de AgentCore. CORS y la allowlist del runtime son configuraciones distintas.

No se invoca el agente en las pruebas automatizadas; las llamadas reales pueden activar el modelo y las tools existentes.
