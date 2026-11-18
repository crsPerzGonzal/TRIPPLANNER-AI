function extractTextDelta(data) {
  if (data === '[DONE]') return ''

  let payload
  try {
    payload = JSON.parse(data)
  } catch (error) {
    if (error instanceof SyntaxError) return data
    throw error
  }

  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return ''

  const event = payload.event && typeof payload.event === 'object'
    ? payload.event
    : payload
  if (payload.error || event.error) throw new Error(getStreamError(data))

  const delta = event.contentBlockDelta?.delta?.text
    ?? event.delta?.text
    ?? event.textDelta

  if (typeof delta === 'string') return delta
  if (typeof payload.data === 'object') return extractTextDelta(JSON.stringify(payload.data))
  if (typeof payload.data === 'string') return extractTextDelta(payload.data)
  return ''
}

function getStreamError(data) {
  try {
    const payload = JSON.parse(data)
    if (payload && typeof payload === 'object') {
      const message = payload.message
        ?? payload.error?.message
        ?? payload.error
        ?? payload.detail
      if (typeof message === 'string') return message
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }

  return data || 'AgentCore reportó un error durante la respuesta.'
}

export async function consumeAgentCoreStream(response, onText) {
  if (!response.body) {
    throw new Error('AgentCore no devolvió un flujo de respuesta.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'
  let dataLines = []
  let receivedText = false

  const dispatchEvent = () => {
    if (!dataLines.length) {
      eventName = 'message'
      return
    }

    const data = dataLines.join('\n')
    if (eventName === 'error') throw new Error(getStreamError(data))

    const text = extractTextDelta(data)
    if (text) {
      onText(text)
      receivedText = true
    }

    dataLines = []
    eventName = 'message'
  }

  const processLine = (line) => {
    if (!line) {
      dispatchEvent()
    } else if (line.startsWith(':')) {
      return
    } else if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      let data = line.slice(5)
      if (data.startsWith(' ')) data = data.slice(1)
      dataLines.push(data)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(processLine)

      if (done) {
        if (buffer) processLine(buffer)
        dispatchEvent()
        return receivedText
      }
    }
  } finally {
    reader.releaseLock()
  }
}
