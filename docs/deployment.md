# Despliegue y prueba desde cero

Esta guía separa la infraestructura de negocio (SAM), los runtimes AgentCore y el sitio web (CloudFormation/S3). SAM no despliega los runtimes AgentCore. En una cuenta nueva se deben aprovisionar y enlazar esos runtimes antes de probar el chat, Flights y Weather.

## 1. Requisitos

- Git, PowerShell, Node.js/npm y Python 3.10 o posterior.
- AWS CLI configurado con un perfil de despliegue y región `us-east-1` (o la región elegida). La identidad requiere permisos para CloudFormation/SAM, API Gateway, Lambda, Cognito, DynamoDB, IAM y S3/CloudFront al publicar.
- AWS SAM CLI; acceso de modelo Amazon Nova Lite en Bedrock en la región destino.
- Acceso de despliegue a Amazon Bedrock AgentCore y capacidad para crear/configurar runtimes, permisos y memoria.
- Un bucket de artefactos de SAM (el flujo guiado puede crearlo).
- Para Flights: credenciales OAuth de Alice y un secreto de Secrets Manager. Para Weather: acceso HTTPS de salida a las fuentes que usa el paquete.

No guardes claves AWS, tokens OAuth ni secretos en Git, en el frontend o en archivos `.env` versionados. Los IDs públicos de Cognito y URLs sí se configuran en el frontend.

## 2. Obtener el código y preparar el entorno

```powershell
# Clona el repositorio con su URL y entra en la carpeta creada.
npm ci --prefix frontend
aws sts get-caller-identity
```

Usa el nombre real de la carpeta creada por `git clone`. Confirma que la cuenta y perfil AWS sean los esperados antes de desplegar.

## 3. Desplegar backend, Cognito y persistencia

Define los orígenes exactos del navegador, sin rutas ni barra final. En desarrollo:

```powershell
$origins = "http://localhost:5173,http://127.0.0.1:5173"
sam validate --template-file infrastructure\template.yaml
sam build --template-file infrastructure\template.yaml
sam deploy --guided --template-file .aws-sam\build\template.yaml --stack-name tripplanner-ai-dev --region us-east-1 --capabilities CAPABILITY_IAM --parameter-overrides "AllowedOrigin=$origins"
```

En las preguntas de SAM elige o crea el bucket de artefactos y guarda la configuración en `samconfig.toml` solo si deseas reutilizarla en este entorno. Revisa el change set antes de aprobar. Para desplegar el origen web publicado, incluye también su dominio exacto en `AllowedOrigin` y ejecuta de nuevo `sam build` y `sam deploy`.

Obtén URLs e IDs desde las salidas de CloudFormation:

```powershell
aws cloudformation describe-stacks --stack-name tripplanner-ai-dev --region us-east-1 --query "Stacks[0].Outputs" --output table
```

El backend crea Cognito, API Gateway (`prod`), la tabla DynamoDB y las Lambdas de viajes, itinerarios, reservas y preferencias. Las rutas de negocio requieren token Cognito; las rutas `OPTIONS` solo sirven preflight CORS.

## 4. Configurar frontend para desarrollo

```powershell
Copy-Item frontend\.env.example frontend\.env.local
```

Edita `frontend/.env.local` con `UserPoolId`, `UserPoolClientId` y `BusinessApiUrl` de las salidas del stack. Añade los valores del Orchestrator una vez que AgentCore esté desplegado: `VITE_AGENTCORE_REGION`, `VITE_AGENTCORE_RUNTIME_ARN` y `VITE_AGENTCORE_ENDPOINT_NAME=COGNITO`.

Arranca Vite:

```powershell
npm run dev --prefix frontend
```

Abre la URL impresa por Vite, crea una cuenta y verifica el correo. Prueba primero viajes/preferencias, que dependen de SAM; el chat requiere AgentCore.

## 5. Desplegar y enlazar agentes AgentCore

El código fuente vive en `agents/orchestrator`, `agents/flight` y `agents/weather`. Las dependencias están declaradas en sus `pyproject.toml`; las notas específicas y la autenticación externa están en sus README.

1. Despliega Flights y Weather como runtimes A2A en AgentCore. Configura el modelo Bedrock indicado por `agents/*/model/load.py`.
2. En Flights, crea el secreto de Alice y realiza el consentimiento OAuth con PKCE según [agents/flight/README.md](../agents/flight/README.md). Asigna al rol solo `secretsmanager:GetSecretValue` y `secretsmanager:PutSecretValue` sobre ese secreto.
3. En Weather, instala la dependencia `weather-forecast-server`; el agente lanza el MCP por STDIO. No requiere API key.
4. Despliega Orchestrator y configura `FLIGHTS_AGENT_ARN`, `WEATHER_AGENT_ARN`, `TRIPPLANNER_BUSINESS_API_URL` y, si se habilita memoria, `TRIP_MEMORY_ID`. Añade al rol permisos de invocación limitados a los dos runtimes A2A, modelo y memoria que usa.
5. Configura un endpoint AgentCore con autorización Cognito/JWT (nombre `COGNITO` en la configuración frontend), el issuer y app client correctos del User Pool. Permite en la lista de headers `Authorization` y `X-TripPlanner-Business-Token`; revisa CORS del runtime para el origen exacto del frontend, método POST y headers que envía el cliente.
6. Configura la API de negocio desplegada en `TRIPPLANNER_BUSINESS_API_URL`, incluido `/prod/`. En una cuenta nueva, usa las salidas del stack, no los valores de la instancia de referencia.
7. Copia el ARN del runtime Orchestrator al `.env.local` y vuelve a iniciar/reconstruir el frontend.

Las APIs de AgentCore y su proceso de publicación son distintos de `sam deploy`; este repositorio contiene el código de los runtimes, pero no una plantilla declarativa ni scripts de aprovisionamiento AgentCore. Por ello, el operador debe crear/desplegar los runtimes con AgentCore en la cuenta destino y registrar los ARN/roles resultantes en su configuración. La instancia de referencia tiene el Orchestrator con `COGNITO` en la versión 43 (JWT) y `DEFAULT` en la 44 (IAM SigV4), ambos `READY`. El prompt limita el Orchestrator a la planificación y gestión de viajes, con redirección amable para solicitudes ajenas. Su política `InvokeSpecialistAgents` permite invocar solo Flights y Weather. No consideres funcional el chat en una instalación nueva hasta verificar endpoint JWT, runtime, ARN de agentes, permisos IAM y secreto OAuth.

## 6. Crear el hosting S3 + CloudFront

El sitio usa S3 privado detrás de CloudFront para servir HTTPS. El nombre de bucket debe ser globalmente único. El nombre siguiente y el ID de distribución en el paso de publicación son los del despliegue de referencia; cámbialos por el nombre que elijas y las salidas de CloudFormation en otra cuenta:

```powershell
$siteBucket = "tripplanner-ai-frontend-656022989453-us-east-1"
aws cloudformation deploy --template-file infrastructure\website.yaml --stack-name tripplanner-ai-frontend --region us-east-1 --parameter-overrides "SiteBucketName=$siteBucket"
aws cloudformation describe-stacks --stack-name tripplanner-ai-frontend --region us-east-1 --query "Stacks[0].Outputs" --output table
```

Anota `FrontendUrl`, `FrontendBucketName` y `CloudFrontDistributionId`. Añade el dominio de `FrontendUrl` a `AllowedOrigin` y vuelve a desplegar SAM conforme al paso 3.

Para que el navegador publicado pueda llamar a la API, actualiza el parámetro CORS después de crear CloudFront:

```powershell
$origins = "http://localhost:5173,http://127.0.0.1:5173,https://<DOMINIO_CLOUDFRONT>"
sam build --template-file infrastructure\template.yaml
sam deploy --resolve-s3 --template-file .aws-sam\build\template.yaml --stack-name tripplanner-ai-dev --region us-east-1 --capabilities CAPABILITY_IAM --parameter-overrides "AllowedOrigin=$origins"
```

Reemplaza `<DOMINIO_CLOUDFRONT>` por el host de `FrontendUrl`, sin `https://` ni barra final.

## 7. Construir y publicar el frontend

Configura `frontend/.env.local` con la API y Cognito de la cuenta destino y las variables AgentCore. Vite incorpora estas variables públicas en el bundle; nunca pongas secretos en ellas.

```powershell
$siteBucket = "tripplanner-ai-frontend-656022989453-us-east-1"
$distributionId = "E14YS8T1A8D0RC"
npm run build --prefix frontend
aws s3 sync frontend\dist "s3://$siteBucket" --exclude index.html --cache-control "public,max-age=31536000,immutable"
aws s3 cp frontend\dist\index.html "s3://$siteBucket/index.html" --cache-control "no-cache,no-store,must-revalidate" --content-type "text/html; charset=utf-8"
aws cloudfront create-invalidation --distribution-id $distributionId --paths "/*"
```

El bucket debe permanecer bloqueado al público; CloudFront accede mediante Origin Access Control. Comprueba la URL HTTPS de la salida `FrontendUrl`.

## 8. Prueba funcional de entrega

1. Abre el sitio publicado, registra un usuario y verifica su correo.
2. En Mis viajes, crea un viaje con origen, destino, fechas, viajeros y presupuesto; recarga e inicia sesión nuevamente para confirmar persistencia.
3. Guarda y recupera preferencias; consulta el Dashboard, el detalle del viaje y el itinerario.
4. En Clima, consulta una ciudad y comprueba que cada tarjeta diaria corresponda a una fecha que devolvió Weather MCP.
5. En Vuelos, proporciona origen/destino y fecha válidos y revisa las ofertas devueltas por Alice MCP.
6. En el asistente, pide explícitamente generar y guardar itinerario para un viaje existente. Confirma que el chat informa éxito solo después de que la Tool complete la escritura; vuelve a Mis viajes y valida los días.
7. Registra una reserva simulada, confirma que aparece con estado `SIMULADA` y que no se solicitaron datos de pago.
8. Revisa los logs/trazas de AgentCore para confirmar invocaciones de Tools/MCP y los logs de API/Lambda para persistencia. El texto generado por el modelo no es por sí solo evidencia de que una fuente externa fue consultada.

La URL de referencia desplegada para este proyecto es [https://d1smsb07arsjuq.cloudfront.net](https://d1smsb07arsjuq.cloudfront.net). IDs, URLs, usuarios y secretos de esa cuenta no se deben reutilizar en otra cuenta.

## 9. Despliegues posteriores

- Backend: `sam build --template-file infrastructure\template.yaml`, revisar y ejecutar `sam deploy` con el stack y los orígenes correctos.
- Frontend: `npm run build --prefix frontend`, sincronizar assets con nombres versionados, copiar `index.html` con no-cache e invalidar CloudFront.
- AgentCore: desplegar cada runtime con el mecanismo AgentCore establecido en la cuenta y comprobar endpoint `COGNITO`, variables, permisos, allowlist de headers y versión activa.

## 10. Limpieza

Eliminar stacks destruye los recursos gestionados por ellos. El stack SAM borra Cognito y DynamoDB y, por tanto, las cuentas/datos guardados. El stack web elimina infraestructura de hosting. Revisa el plan y conserva/exporta lo necesario antes de borrar. El bucket de artefactos de SAM puede ser independiente y compartido.
