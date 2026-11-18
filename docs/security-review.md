# Revisión de seguridad

## Resultado

La revisión de código y configuración desplegada confirma aislamiento por usuario y permisos de DynamoDB acotados por función. El rol Orchestrator invoca únicamente los runtimes Flights y Weather. La etapa `prod` tiene un objetivo compartido de 10 solicitudes por segundo y una ráfaga de 20; no es una cuota por usuario.

## Aislamiento por usuario

- API Gateway aplica el autorizador Cognito por defecto a las rutas de negocio. Las rutas `OPTIONS` no requieren token porque solo responden a preflight CORS y no acceden a DynamoDB.
- `backend/common/api.py` obtiene el propietario desde `requestContext.authorizer.claims.sub`; no usa un `userId` enviado por el cliente.
- `backend/common/storage.py` construye todas las claves de partición como `USER#<sub>`. Las lecturas, escrituras y consultas incluyen esa partición.
- Itinerarios y reservas verifican primero que el viaje pertenezca a esa misma partición. Las preferencias se guardan bajo `PREFERENCES#TRAVEL` dentro de la partición del usuario.

## Permisos IAM

Las funciones tienen políticas inline limitadas al ARN de `TripPlannerTable` y solo a las acciones que usan:

| Función | Acciones DynamoDB |
|---|---|
| `TripsFunction` | `GetItem`, `PutItem`, `Query`, `UpdateItem` |
| `ItinerariesFunction` | `GetItem`, `PutItem`, `UpdateItem` |
| `ReservationsFunction` | `GetItem`, `PutItem`, `Query`, `UpdateItem` |
| `PreferencesFunction` | `GetItem`, `PutItem` |
| `CorsFunction` | Sin acceso a DynamoDB |

La política IAM limita tabla y acciones; la separación entre usuarios se aplica en Lambda mediante `PK=USER#<sub>`, porque las funciones comparten un rol de ejecución por tipo de operación.

La política `InvokeSpecialistAgents` del rol Orchestrator está restringida a los dos ARN de runtime usados por el código. Se verificó en la cuenta de referencia al desplegar las versiones 40/41. Esta política se corrigió directamente en IAM porque el proyecto AgentCore que la administra no está incluido en el repositorio; vuelve a comprobarla después de cada despliegue de AgentCore.

## Throttling

`infrastructure/template.yaml` aplica en `prod` `ThrottlingRateLimit: 10` y `ThrottlingBurstLimit: 20` para todos los métodos y recursos. Es un objetivo compartido para la etapa, no una cuota individual por usuario. API Gateway usa límites best-effort y puede responder `429 Too Many Requests` al excederlos; no se deben tratar como topes de costo o protección absoluta. El Dashboard consulta las reservas en lotes de cinco para reducir ráfagas desde la interfaz.

No se añadió un API key ni Usage Plan: no sustituye Cognito como autorización y no se requiere identificación de clientes por clave para este uso. Si el producto necesita límites independientes o protección fuerte contra abuso/costos, habrá que definir controles adicionales, como una política de AWS WAF por IP y monitoreo de presupuesto.

## Alcance de esta revisión

Es una revisión de implementación y configuración, no una auditoría independiente ni una prueba de penetración. La seguridad de cada cuenta nueva depende de desplegar las plantillas y los roles AgentCore con los recursos y permisos restringidos descritos en [architecture.md](architecture.md). No se deben copiar roles amplios ni secretos entre entornos. El preflight del endpoint AgentCore de referencia devuelve `Access-Control-Allow-Origin: *`; el endpoint sigue exigiendo su JWT Cognito, pero CORS no limita ese runtime a un origen específico.
