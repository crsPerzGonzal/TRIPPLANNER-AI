import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeAgentCoreStream } from './agentCoreStream.js'

function createSseResponse(chunks) {
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)))
      controller.close()
    },
  })

  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

test('consumes JSON text deltas across split SSE chunks', async () => {
  const event = 'event: message\r\ndata: {"event":{"contentBlockDelta":{"delta":{"text":"Hola"}}}}\r\n\r\n'
  const split = 29
  const chunks = [event.slice(0, split), event.slice(split)]
  let output = ''

  const receivedText = await consumeAgentCoreStream(createSseResponse(chunks), (text) => {
    output += text
  })

  assert.equal(receivedText, true)
  assert.equal(output, 'Hola')
})

test('preserves plain text SSE data', async () => {
  let output = ''

  await consumeAgentCoreStream(createSseResponse(['data: respuesta simple\n\n']), (text) => {
    output += text
  })

  assert.equal(output, 'respuesta simple')
})

test('surfaces AgentCore SSE errors', async () => {
  const response = createSseResponse(['event: error\ndata: {"message":"fallo del runtime"}\n\n'])

  await assert.rejects(
    consumeAgentCoreStream(response, () => {}),
    /fallo del runtime/,
  )
})

test('surfaces errors encoded in a message event', async () => {
  const response = createSseResponse(['data: {"error":"fallo del Orchestrator"}\n\n'])

  await assert.rejects(
    consumeAgentCoreStream(response, () => {}),
    /fallo del Orchestrator/,
  )
})
