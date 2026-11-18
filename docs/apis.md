# Contratos de API de negocio

**Estado:** API de desarrollo desplegada en `us-east-1`. Las operaciones se exponen por API Gateway y son ejecutadas por Lambdas.

## Convenciones

- Los cuerpos y respuestas usan JSON.
- API Gateway valida el token de Amazon Cognito. El `userId` se obtiene de `requestContext.authorizer.claims.sub`; no se acepta un `userId` enviado por el frontend.
- Los identificadores de viajes e itinerarios son generados por el backend.
- Las fechas usan `YYYY-MM-DD`; el presupuesto contiene cantidad y moneda.
- Lambda valida tipos, rangos, fechas, estado de reserva y pertenencia al usuario antes de leer o modificar datos.
- La plantilla SAM configura un autorizador de Cognito y exige el origen frontend exacto para CORS. El token de usuario es distinto de las credenciales AWS de despliegue; no se agregan credenciales AWS al frontend. El documento base exige autorización, IAM de privilegios mínimos, CORS restringido y límites de uso.

## Operaciones

La etapa `prod` limita todas las rutas a un objetivo compartido de 10 solicitudes por segundo y una ráfaga de 20. El cliente debe tratar `429 Too Many Requests` como una respuesta temporal. Estos límites protegen la API a nivel de etapa; no asignan cuotas individuales por usuario.

| Método y ruta | Operación de negocio | Propósito |
|---|---|---|
| `POST /trips` | `CreateTrip` | Crear un viaje propiedad del usuario autenticado. |
| `GET /trips` | `GetTrips` | Listar los viajes del usuario autenticado. |
| `GET /preferences` | `GetTravelPreferences` | Recuperar las preferencias del usuario autenticado. |
| `PUT /preferences` | `SaveTravelPreferences` | Guardar o reemplazar las preferencias del usuario autenticado. |
| `GET /trips/{tripId}` | Consulta de viaje | Recuperar un viaje específico para la pantalla de detalle. |
| `PATCH /trips/{tripId}` | `UpdateTrip` | Actualizar origen, destino, fechas, viajeros o presupuesto. |
| `GET /trips/{tripId}/itinerary` | Consulta de itinerario | Recuperar la agenda asociada al viaje. |
| `PUT /trips/{tripId}/itinerary` | `CreateItinerary` / `UpdateItinerary` | Crear o reemplazar la agenda del viaje. |
| `POST /trips/{tripId}/reservations` | `CreateReservation` | Registrar una reserva asociada al viaje. En el alcance inicial, su estado es `SIMULADA`. |
| `GET /trips/{tripId}/reservations` | `GetReservations` | Listar las reservas asociadas al viaje. |
| `PATCH /trips/{tripId}/reservations/{reservationId}` | `UpdateReservation` | Actualizar los datos permitidos o el estado de una reserva propia. |

Las rutas de consulta de viaje e itinerario complementan las Tools listadas en el documento base para permitir que la interfaz recupere los datos persistidos.

El frontend ya usa `GET /trips` para cargar los viajes del usuario y `POST /trips` para guardar un viaje nuevo. Ambas solicitudes envían el ID token de Cognito en `Authorization`; la identidad propietaria se determina exclusivamente en API Gateway y Lambda.

El itinerario se consulta con `GET /trips/{tripId}/itinerary` y se crea o actualiza con `PUT` en la misma ruta. El backend limita `dayNumber` al rango inclusivo de fechas del viaje; cada día puede contener actividades con nombre.

La sección de reservas consulta y registra elementos simulados por viaje mediante `GET` y `POST /trips/{tripId}/reservations`, y actualiza estados con `PATCH /trips/{tripId}/reservations/{reservationId}`. Solo permite `SIMULADA` y `PENDIENTE`; `CONFIRMADA` requiere una integración futura con un proveedor.

## Cuerpos de solicitud

### Preferencias de viaje

`GET /preferences` devuelve `preferences: null` cuando el usuario aún no las ha guardado. `PUT /preferences` crea o reemplaza el registro y recibe `interests` (lista sin duplicados de `culture`, `nature`, `gastronomy`, `adventure`, `relaxation` y `shopping`), `travelPace` (`relaxed`, `balanced` o `active`) y `budgetStyle` (`economy`, `balanced` o `comfort`). La identidad se deriva del claim `sub`; no se acepta un identificador de usuario en el cuerpo.

### Crear o actualizar un viaje

`POST /trips` recibe `origin`, `destination`, `startDate`, `endDate`, `travelerCount` y `budget` (`amount`, `currency`). `PATCH /trips/{tripId}` acepta una o más de esas propiedades.

El backend verifica que las fechas sean válidas y que `endDate` no sea anterior a `startDate`; `travelerCount` debe ser un entero positivo y el presupuesto una cantidad no negativa. Los valores concretos, incluidas las fechas del viaje, deben provenir del usuario o del flujo de planificación, no de datos inventados por la API.

### Crear o actualizar el itinerario

`PUT /trips/{tripId}/itinerary` recibe `days`, una lista de días con `dayNumber` y las actividades correspondientes. Cada actividad debe tener un nombre; el orden de la lista representa el orden de la agenda. Los días deben corresponder al viaje.

### Crear o actualizar una reserva

`POST /trips/{tripId}/reservations` recibe el tipo de reserva (`flight`, `hotel` o `activity`). En este incremento de reserva simulada no se integra un proveedor ni se recopilan datos de pago; el backend asigna `SIMULADA`.

`PATCH /trips/{tripId}/reservations/{reservationId}` solo permite los campos editables y los estados definidos por el proyecto. `CONFIRMADA` se reserva para una futura confirmación válida de proveedor; no se habilita esa transición en el flujo simulado inicial.

## Respuestas y errores

- `201 Created`: viaje, itinerario o reserva creados.
- `200 OK`: consulta o actualización completada.
- `400 Bad Request`: cuerpo inválido o campos fuera de rango.
- `401 Unauthorized`: falta una identidad autenticada válida.
- `404 Not Found`: entidad inexistente o que no pertenece al usuario autenticado.
- `500 Internal Server Error`: error no esperado, con un mensaje público sin detalles internos.

La respuesta de creación incluye el identificador generado y el recurso persistido. Las respuestas de consulta solo incluyen registros del usuario autorizado. No se devuelven credenciales ni datos de pago.

## Correspondencia con arquitectura

```text
Frontend → API Gateway → Lambda (validación y autorización de propiedad) → DynamoDB
```

La memoria de AgentCore no reemplaza estas operaciones ni la persistencia de DynamoDB.

## Conversación con AgentCore

La conversación del asistente usa un canal separado de las operaciones de negocio:

```text
Frontend → HTTP streaming directo → AgentCore Orchestrator
```

El frontend envía el access token de Cognito como bearer token y el mensaje como `{ "prompt": "..." }`. AgentCore valida el JWT y devuelve eventos `text/event-stream`. Cada conversación mantiene un identificador de sesión aleatorio; el Orchestrator deriva el actor de memoria del claim `sub` validado para evitar compartir recuerdos entre usuarios. El endpoint `COGNITO` usa autenticación JWT; el endpoint `DEFAULT` existente conserva IAM SigV4.

Este canal no pasa por API Gateway ni modifica la persistencia de viajes, itinerarios o reservas. Flights y Weather se invocan internamente por el Orchestrator mediante A2A; Flights usa Alice Flights MCP y Weather ejecuta weather-forecast-server MCP en STDIO. Estas consultas no crean reservas ni escriben datos de negocio.
