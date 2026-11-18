import { restoreSession } from './cognito.js'
import { consumeAgentCoreStream } from './agentCoreStream.js'

const runtimeArn = import.meta.env.VITE_AGENTCORE_RUNTIME_ARN
const runtimeRegion = import.meta.env.VITE_AGENTCORE_REGION
const endpointName = import.meta.env.VITE_AGENTCORE_ENDPOINT_NAME

export function isAgentCoreConfigured() {
  return Boolean(runtimeArn && runtimeRegion && endpointName)
}

function getRuntimeUrl() {
  if (!isAgentCoreConfigured()) {
    throw new Error('Configura el runtime de AgentCore en frontend/.env.local.')
  }

  return `https://bedrock-agentcore.${runtimeRegion}.amazonaws.com/runtimes/${encodeURIComponent(runtimeArn)}/invocations?qualifier=${encodeURIComponent(endpointName)}`
}

export async function invokeAgentCore(prompt, sessionId, { signal, onText }) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Escribe un mensaje antes de enviarlo.')
  }
  if (typeof sessionId !== 'string' || sessionId.length < 33 || sessionId.length > 256) {
    throw new Error('No se pudo iniciar una sesión válida con el asistente.')
  }

  const user = await restoreSession()
  if (!user?.accessToken || !user?.idToken) {
    throw new Error('Tu sesión de Cognito terminó. Inicia sesión nuevamente para conversar.')
  }

  const response = await fetch(getRuntimeUrl(), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
      'X-TripPlanner-Business-Token': user.idToken,
    },
    body: JSON.stringify({ prompt }),
    signal,
  })

  if (!response.ok) {
    const body = await response.text()
    let message
    if (body) {
      try {
        const payload = JSON.parse(body)
        if (payload && typeof payload === 'object') {
          message = payload.message ?? payload.error?.message
        }
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }

    throw new Error(
      (typeof message === 'string' && message)
      || `La solicitud a AgentCore falló (HTTP ${response.status}).`,
    )
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('text/event-stream')) {
    throw new Error(`AgentCore devolvió un formato de respuesta inesperado: ${contentType || 'sin Content-Type'}.`)
  }

  return consumeAgentCoreStream(response, onText)
}
