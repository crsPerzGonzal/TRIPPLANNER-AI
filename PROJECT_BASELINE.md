# TripPlanner AI — documento base del proyecto

## 1. Propósito

Evolucionar TripPlanner, una solución multiagente existente construida con Strands Agents y desplegada en Amazon Bedrock AgentCore, a una aplicación web funcional para planificar y gestionar viajes.

La aplicación permitirá conversar con los agentes, consultar vuelos y clima, crear viajes e itinerarios, registrar reservas y recuperar la información guardada.

## 2. Objetivo del proyecto

Construir una aplicación web que integre:

- Una experiencia de usuario con seis módulos funcionales.
- La arquitectura multiagente existente, conectada mediante HTTP streaming.
- Un backend serverless con AWS Lambda y Amazon API Gateway.
- Persistencia de negocio en Amazon DynamoDB.
- Tools de negocio para que los agentes puedan ejecutar operaciones.

## 3. Restricciones y principios obligatorios

- Conservar los tres agentes existentes: **Orchestrator Agent**, **Flight Agent** y **Weather Agent**.
- No sustituir la arquitectura multiagente por un único agente ni simular los agentes desde el frontend.
- Mantener dos canales separados:
  - **Operaciones de negocio:** frontend → API Gateway → Lambda → DynamoDB.
  - **Interacción agéntica:** frontend → HTTP streaming directo → AgentCore → Orchestrator Agent.
- El streaming de AgentCore no requiere API Gateway como intermediario. Si se agrega un proxy, debe documentarse y justificarse.
- El frontend no accede directamente a DynamoDB. El acceso a los datos pasa por Lambda.
- La memoria conversacional de los agentes no sustituye la persistencia transaccional. DynamoDB es la fuente de verdad para los datos del negocio.
- Las reservas pueden ser simuladas, pero deben persistirse en DynamoDB.
- No solicitar ni almacenar números de tarjeta, CVV ni datos de pago.

## 4. Tecnologías indicadas

| Tecnología | Uso |
|---|---|
| Python | Agentes, Tools y funciones Lambda. |
| Strands Agents | Comportamiento, herramientas y memoria de los agentes. |
| Amazon Bedrock AgentCore | Ejecución y exposición de agentes mediante HTTP streaming. |
| MCP (Model Context Protocol) | Herramientas especializadas de vuelos y clima. |
| AWS Lambda | Lógica de negocio y validaciones. |
| Amazon API Gateway | Exposición de APIs HTTP al frontend para operaciones de negocio. |
| Amazon DynamoDB | Persistencia de usuarios, preferencias, viajes, itinerarios y reservas. |
| Amazon Cognito User Pools | **Adición aprobada posteriormente por el usuario:** autorregistro con correo verificado y autenticación; no figuraba en la lista original del documento. |
| React, Angular, Vue o HTML/CSS/JavaScript | Opciones para desarrollar el frontend. |
| Amazon S3 | Publicación del frontend. |
| Amazon CloudFront | Distribución opcional del frontend. |
| AWS SAM | Herramienta recomendada para definir infraestructura como código. |
| IAM | Roles y políticas de mínimo privilegio. |

## 5. Componentes y responsabilidades

| Componente | Responsabilidad |
|---|---|
| Frontend | Experiencia de usuario, formularios, pantallas y presentación visual de resultados. |
| Orchestrator Agent | Interpreta las solicitudes y coordina a los agentes especialistas y Tools. |
| Flight Agent | Especialista en consultas de vuelos; interactúa con el MCP de vuelos. |
| Weather Agent | Especialista en consultas meteorológicas; interactúa con el MCP de clima. |
| AgentCore | Ejecuta y expone los agentes mediante HTTP streaming. |
| MCP | Proporciona las herramientas especializadas de vuelos y clima. |
| Lambda | Valida y ejecuta la lógica de negocio. |
| API Gateway | Publica las APIs HTTP de operaciones de negocio para el frontend. |
| DynamoDB | Persiste la información del negocio. |
| S3 | Aloja el frontend publicado. |
| IAM | Controla permisos de acceso con privilegios mínimos. |

## 6. Canales de comunicación

### 6.1 Operaciones de negocio

```text
Frontend → API Gateway → Lambda → DynamoDB
```

Este canal respalda las pantallas, formularios y operaciones para crear, consultar y editar viajes, itinerarios y reservas.

### 6.2 Interacción agéntica

```text
Frontend → HTTP streaming directo → AgentCore → Orchestrator Agent
```

El Orchestrator puede coordinar a Flight Agent, Weather Agent y las Tools de negocio. El frontend debe mostrar indicadores de procesamiento, mantener el contexto de la conversación y presentar los resultados de forma visual.

## 7. Flujo de una consulta agéntica

```text
Usuario
  → escribe una solicitud en el frontend
  → el frontend se conecta directamente con AgentCore mediante HTTP streaming
  → Orchestrator interpreta la solicitud y decide qué agente o Tool utilizar
  → Flight Agent consulta vuelos por medio del MCP de vuelos, si aplica
  → Weather Agent consulta clima por medio del MCP de clima, si aplica
  → los resultados vuelven al Orchestrator
  → el frontend presenta la respuesta y los resultados en componentes visuales
```

El documento recomienda que los agentes entreguen datos estructurados, por ejemplo JSON, junto con el texto explicativo, para facilitar su presentación como componentes.

## 8. Tools de negocio mínimas

Cada Tool debe estar respaldada por una operación implementada mediante Lambda.

| Tool | Propósito |
|---|---|
| `CreateTrip` | Crear un viaje del usuario. |
| `GetTrips` | Consultar los viajes del usuario. |
| `UpdateTrip` | Actualizar los datos de un viaje. |
| `CreateItinerary` | Crear el itinerario de un viaje. |
| `UpdateItinerary` | Modificar un itinerario. |
| `CreateReservation` | Registrar una reserva asociada a un viaje. |
| `GetReservations` | Consultar reservas. |
| `UpdateReservation` | Actualizar una reserva o su estado. |

El ciclo esperado para una operación iniciada por un agente es:

```text
Usuario → Orchestrator → Tool → Lambda (valida y ejecuta) → DynamoDB
        ← respuesta con el resultado ← agente
```

## 9. Información que debe persistirse

- **Usuario:** identificador y datos básicos.
- **Preferencias:** gustos y restricciones de viaje, como presupuesto y tipo de actividades.
- **Viajes:** destino, origen, fechas, número de viajeros y presupuesto.
- **Itinerarios:** actividades organizadas por día y asociadas a un viaje.
- **Reservas:** vuelos, hoteles y actividades asociadas a un viaje.
- **Estados de reserva:** simulada, pendiente o confirmada.

El diseño de tablas y claves de DynamoDB queda a decisión del equipo y debe justificarse en la documentación.

## 10. Funcionalidades mínimas del frontend

1. **Dashboard:** resumen del usuario, próximos viajes, reservas recientes y accesos rápidos.
2. **Asistente conversacional:** chat con el Orchestrator mediante HTTP streaming.
3. **Consulta de vuelos:** búsqueda y comparación mediante tarjetas.
4. **Información meteorológica:** temperatura, condiciones y probabilidad de lluvia cuando esté disponible.
5. **Mis viajes e itinerarios:** viajes guardados, agenda por día y preferencias.
6. **Gestión de reservas:** listado con estados, creación, edición y asociación a un viaje.

Los resultados deben mostrarse con componentes apropiados: tarjetas para vuelos, clima y viajes; agenda o calendario para itinerarios; y listado con estados para reservas.

## 11. Estados de las reservas

| Estado | Significado | Presentación requerida |
|---|---|---|
| `SIMULADA` | Registrada por el sistema sin intervención de un proveedor externo; es el caso esperado. | Etiqueta “Simulada”. |
| `PENDIENTE` | Registrada y a la espera de confirmación. | Etiqueta “Pendiente”. |
| `CONFIRMADA` | Confirmada por un proveedor real, si se integra uno. | Etiqueta “Confirmada”. |

No es obligatorio integrar proveedores comerciales reales.

## 12. Seguridad y validaciones

- Aplicar IAM con privilegios mínimos para cada Lambda y agente.
- No incluir credenciales ni secretos de AWS en el frontend.
- Validar en Lambda tipos, rangos, fechas y estados permitidos.
- Controlar que cada usuario solo pueda leer y modificar sus viajes y reservas.
- Proteger las APIs con autorización, CORS restringido y límites de uso.
- Devolver códigos HTTP correctos y mensajes claros sin exponer detalles internos.
- No almacenar datos de tarjetas bancarias.

## 13. Escenario obligatorio de demostración

Solicitud: organizar cuatro días en Cartagena, con salida desde Bogotá, para el usuario y dos acompañantes, y un presupuesto de cinco millones de pesos.

Flujo requerido:

```text
Ingresar al frontend
  → conversar con el asistente mediante streaming
  → Orchestrator interpreta la solicitud
  → Flight Agent consulta vuelos mediante MCP
  → Weather Agent consulta clima mediante MCP
  → frontend muestra vuelos y clima
  → usuario solicita crear el viaje
  → se genera el itinerario
  → se registra una reserva simulada
  → los datos quedan guardados en DynamoDB
  → usuario sale y vuelve a ingresar
  → recupera sus datos persistidos
```

La demostración debe ejecutarse funcionalmente sobre la infraestructura desplegada; no se aceptan pantallas estáticas.

## 14. Entregables

1. Aplicación frontend publicada en Amazon S3; CloudFront es opcional.
2. Backend serverless con Lambdas y API Gateway funcionando.
3. Tablas DynamoDB con persistencia funcional.
4. Diagrama de arquitectura que muestre los dos canales y los servicios utilizados.
5. Repositorio Git con código de frontend, agentes, Lambdas e infraestructura.
6. Documentación técnica.
7. Demostración en vivo del escenario obligatorio.

La documentación técnica debe incluir arquitectura y decisiones de diseño, modelo de datos, APIs, Lambdas y validaciones, permisos IAM, Tools, integración de agentes e instrucciones para desplegar y probar desde cero.

## 15. Plan de trabajo indicado

| Días | Etapa | Actividades |
|---|---|---|
| 1–2 | Diseño y arquitectura | Wireframes, modelo DynamoDB, diseño de APIs y diagrama de arquitectura. |
| 3–5 | Backend y persistencia | DynamoDB, Lambdas, API Gateway, plantilla AWS SAM recomendada y pruebas de operaciones. |
| 6–8 | Frontend | Dashboard, navegación, chat, pantallas de viajes e integración de APIs. |
| 9–11 | Integración agéntica | HTTP streaming, AgentCore, Flight y Weather, y nuevas Tools. |
| 12–13 | Pruebas | Flujo completo, persistencia, recuperación de datos, seguridad y corrección de errores. |
| 14–15 | Documentación y entrega | README, diagramas, evidencias, despliegue y sustentación. |

Hitos: diseño aprobado (día 2), backend operativo (día 5), frontend navegable (día 8), integración completa (día 11) y entrega final (día 15).

## 16. Criterios de evaluación

| Criterio | Porcentaje |
|---|---:|
| Experiencia de usuario y frontend | 25% |
| Integración agéntica y HTTP streaming | 15% |
| Nuevas Tools y capacidades | 15% |
| Backend Lambda y API Gateway | 15% |
| DynamoDB y persistencia | 15% |
| Arquitectura y seguridad | 10% |
| Documentación y demostración | 5% |

## 17. Funcionalidades opcionales

Agente de hoteles, agente de actividades turísticas, recomendaciones gastronómicas, comparador de presupuestos, mapas y rutas, recomendaciones personalizadas, notificaciones, exportación PDF, gestión de múltiples viajeros e integración con proveedores reales.

Son opcionales y no sustituyen los requisitos obligatorios. Se consideran después de tener funcionando el flujo completo.

## 18. Prioridad de implementación

La prioridad indicada por el documento es completar primero el flujo de crear un viaje, guardar su itinerario y una reserva, y recuperar la información. Las funcionalidades adicionales se desarrollan después.

## 19. Estructura propuesta del proyecto

El documento define los componentes del sistema, pero no exige una estructura específica de carpetas. Se propone organizar el repositorio de esta manera:

```text
tripplanner-ai/
│
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── dashboard/
│       │   ├── assistant/
│       │   ├── flights/
│       │   ├── weather/
│       │   ├── trips/
│       │   └── reservations/
│       ├── components/
│       └── services/
│           ├── agent-streaming/
│           └── business-api/
│
├── agents/
│   ├── orchestrator/
│   ├── flight/
│   └── weather/
│
├── backend/
│   └── lambdas/
│       ├── trips/
│       ├── itineraries/
│       └── reservations/
│
├── infrastructure/
│   └── template.yaml
│
└── docs/
    ├── architecture.md
    ├── data-model.md
    ├── apis.md
    └── deployment.md
```

### Responsabilidad de las carpetas

- **`frontend/`**: módulos de interfaz. Separa en `services/` la conexión de streaming con AgentCore de las llamadas de negocio a API Gateway.
- **`agents/`**: código de los tres agentes existentes: Orchestrator, Flight y Weather.
- **`backend/lambdas/`**: lógica de negocio y validaciones agrupadas por viajes, itinerarios y reservas. Las operaciones Lambda respaldan las APIs y las Tools.
- **`infrastructure/`**: infraestructura como código para Lambda, API Gateway, tablas DynamoDB y permisos IAM. AWS SAM es la opción recomendada por el documento.
- **`docs/`**: documentación técnica de arquitectura, modelo de datos, APIs e instrucciones de despliegue y prueba.

Esta organización es una propuesta para separar responsabilidades, no un requisito del trabajo. El framework del frontend sigue a elección del equipo: React, Angular, Vue o HTML/CSS/JavaScript. El documento tampoco determina cómo agrupar las funciones Lambda.

## 20. Decisiones visuales aprobadas

- Se eligió **React**, una de las opciones de frontend permitidas por el documento.
- La interfaz prioriza el uso en portátil y se adapta a pantallas de tablet y móvil.
- Se aprobó la paleta teal y coral: `#0F766E`, `#CCFBF1`, `#F97316` y `#FFEDD5`, junto con los neutros y colores semánticos definidos por el equipo.
- La interfaz incluye un control para ampliar el texto y respeta la preferencia del sistema para mayor contraste.
- La versión visual inicial muestra contenido de ejemplo e indica qué integraciones siguen pendientes; no simula consultas reales de agentes ni persistencia.
- El asistente incorpora un avatar TalkingHead como apoyo visual para probar expresiones; no utiliza voz, sincronización labial ni conexión con AgentCore.
- El modelo de muestra `brunette.glb` está identificado como CC BY-NC 4.0 y es solo para prototipos no comerciales; debe sustituirse por un modelo con licencia adecuada antes de publicar.
- **Cambio de alcance aprobado por el usuario:** Amazon Cognito User Pools para autorregistro con verificación de correo y autenticación de usuarios. API Gateway valida los tokens y utiliza su claim `sub` para aislar los datos. El frontend no recibe credenciales AWS.
