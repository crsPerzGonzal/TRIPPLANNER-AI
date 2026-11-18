# Modelo de datos de negocio

**Estado:** Modelo implementado en código y desplegado en el stack SAM de referencia, incluidas las preferencias.

## Alcance

El modelo de negocio cubre viajes, itinerarios, reservas simuladas y preferencias de viaje. Los datos se particionan por el `sub` verificado de Cognito; no se acepta un `userId` enviado por el cliente. Las preferencias se guardan como un único registro por usuario y pueden consultarse o reemplazarse sin crear índices adicionales.

## Tabla propuesta

Se propone una tabla DynamoDB de negocio, `TripPlannerData`, con claves de partición y ordenamiento:

| Atributo | Uso |
|---|---|
| `PK` | `USER#<userId>`; agrupa los datos del usuario autenticado. |
| `SK` | Identifica el viaje, itinerario o reserva. |

Cada elemento incluye `entityType` para identificar su tipo. API Gateway valida el token de Cognito y `userId` proviene del claim `sub` verificado, no del cuerpo enviado por el navegador.

| Entidad | Clave de ordenamiento | Atributos de negocio |
|---|---|---|
| Viaje | `TRIP#<tripId>` | `tripId`, origen, destino, fechas, número de viajeros, presupuesto y moneda. |
| Itinerario | `ITINERARY#<tripId>` | `tripId`, días ordenados y actividades de cada día. |
| Reserva | `RESERVATION#<tripId>#<reservationId>` | `tripId`, `reservationId`, tipo (vuelo, hotel o actividad) y estado. |
| Preferencias | `PREFERENCES#TRAVEL` | intereses, ritmo de viaje y nivel de presupuesto. |

Los elementos llevan también marcas de tiempo de creación y actualización asignadas por el backend. Los identificadores son generados por el backend.

### Formas de los datos

- **Fechas del viaje:** `startDate` y `endDate` en formato ISO `YYYY-MM-DD`. Deben ser proporcionadas por el usuario; el escenario de demostración no fija fechas concretas.
- **Presupuesto:** cantidad numérica y moneda. El escenario usa COP; no se debe inferir ni guardar ningún dato de pago.
- **Viajeros:** cantidad entera que incluye al usuario y sus acompañantes.
- **Itinerario:** lista de días identificados por `dayNumber`; cada día contiene actividades ordenadas. No se asignan horas o detalles que no hayan sido proporcionados.
- **Reserva:** sus estados permitidos son `SIMULADA`, `PENDIENTE` y `CONFIRMADA`. En el flujo inicial, sin proveedor externo, se crea como `SIMULADA`.

## Accesos previstos

Las preferencias se leen y escriben directamente con la clave `PK=USER#<sub>` y `SK=PREFERENCES#TRAVEL`; la escritura reemplaza el conjunto completo validado de preferencias.

Todos los accesos se limitan a la partición del usuario autorizado:

1. Listar viajes: consultar `PK` y el prefijo `TRIP#`.
2. Leer o guardar el itinerario: consultar o escribir la clave `ITINERARY#<tripId>`.
3. Listar reservas de un viaje: consultar `PK` y el prefijo `RESERVATION#<tripId>#`.
4. Crear o actualizar una entidad: comprobar que el viaje y la entidad pertenecen al `userId` autenticado.

No se requieren índices secundarios para los accesos actuales. API Gateway valida el token de Cognito; Lambda obtiene el propietario del claim sub y limita las claves DynamoDB a USER#<sub>.

## Justificación y límites

Una tabla con claves por usuario permite aislar los registros y consultar viajes, itinerarios, reservas y preferencias sin agregar índices para el flujo inicial. El itinerario se guarda como un elemento agregado por viaje, adecuado para la agenda del escenario de demostración. Si su tamaño o sus patrones de consulta crecen, se deberá revisar esa decisión antes de exceder el límite de tamaño de elemento de DynamoDB.
