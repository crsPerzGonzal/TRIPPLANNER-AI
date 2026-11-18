# TripPlanner AI

Aplicación web de planificación de viajes con React, autenticación Cognito, persistencia en DynamoDB y agentes Strands desplegados en Amazon Bedrock AgentCore.

## Documentación de entrega

- [Arquitectura y permisos](docs/architecture.md): diagrama, componentes, dos canales de comunicación, IAM y decisiones de diseño.
- [Modelo de datos](docs/data-model.md): claves DynamoDB, entidades, propiedad y patrones de acceso.
- [Contratos de API](docs/apis.md): rutas, autenticación, cuerpos, respuestas y límites.
- [AgentCore y MCP](docs/agentcore.md): runtimes, Tools, integración de Flights y Weather y autenticación.
- [Guía de despliegue y prueba desde cero](docs/deployment.md): requisitos, orden de despliegue, configuración local, publicación y demostración.
- [Revisión de seguridad](docs/security-review.md): aislamiento, permisos y throttling.

## Estructura

```text
frontend/          Aplicación React y Vite
backend/           Lambdas, validación y acceso a DynamoDB
agents/            Orchestrator, Flights y Weather
infrastructure/    Plantillas SAM del backend y CloudFormation del sitio
docs/              Documentación técnica y de entrega
```

## Inicio rápido local

Requiere Node.js, npm y una configuración de Cognito/API ya desplegada. Crea `frontend/.env.local` a partir de `frontend/.env.example`, usa los valores de las salidas de SAM y ejecuta:

```powershell
npm ci --prefix frontend
npm run dev --prefix frontend
```

Vite informa la dirección local (normalmente `http://localhost:5173`). Para el procedimiento completo, incluidos agentes y despliegue AWS, consulta [docs/deployment.md](docs/deployment.md).

## Estado de despliegue de referencia

La instancia que se probó está publicada en [https://d1smsb07arsjuq.cloudfront.net](https://d1smsb07arsjuq.cloudfront.net), con origen S3 privado. Sus IDs y endpoints específicos pertenecen a esa cuenta AWS; para una instalación nueva deben usarse las salidas de las plantillas y la configuración de AgentCore de la cuenta destino. No copies credenciales o tokens al repositorio.
