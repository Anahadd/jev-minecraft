const RETRYABLE = new Set([429, 500, 502, 503, 504, 529])

export class JevError extends Error {
  constructor (message, { status, body } = {}) {
    super(message)
    this.name = 'JevError'
    this.status = status
    this.body = body
  }
}

export function buildChoiceRequest ({ model, state, instructions, options, stateAsString = false }) {
  if (options.length < 2) throw new JevError('A choice needs at least two options')
  if (options.length > 255) throw new JevError('A choice accepts at most 255 options')
  return {
    model,
    state: stateAsString ? JSON.stringify(state) : state,
    questions: {
      action: {
        type: 'choice',
        instructions,
        criteria: Object.fromEntries(options.map((option) => [option.key, option.description]))
      }
    }
  }
}

export function parseChoiceResponse (body, options) {
  const answer = body?.answers?.action
  if (!answer || answer.type !== 'choice') {
    throw new JevError('Response has no choice answer for "action"', { body })
  }
  const option = options.find((candidate) => candidate.key === answer.choice)
  if (!option) {
    throw new JevError(`Response chose an unknown option "${answer.choice}"`, { body })
  }
  return {
    option,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    model: body.model,
    usage: body.usage
  }
}

function retryDelayMs (attempt, retryAfter) {
  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000)
  return Math.min(250 * 2 ** attempt, 4000) + Math.random() * 100
}

export function createJevClient ({ url, apiKey, model, timeoutMs, stateAsString, fetchImpl = fetch, maxRetries = 3, sleep }) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

  async function choose ({ state, instructions, options }) {
    const body = JSON.stringify(buildChoiceRequest({ model, state, instructions, options, stateAsString }))
    const started = performance.now()
    for (let attempt = 0; ; attempt++) {
      let response
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(timeoutMs)
        })
      } catch (error) {
        if (attempt < maxRetries) {
          await wait(retryDelayMs(attempt))
          continue
        }
        throw new JevError(`Jev request failed: ${error.message}`)
      }

      if (RETRYABLE.has(response.status) && attempt < maxRetries) {
        await wait(retryDelayMs(attempt, response.headers.get('retry-after')))
        continue
      }
      if (!response.ok) {
        const text = await response.text()
        throw new JevError(`Jev returned HTTP ${response.status}`, { status: response.status, body: text.slice(0, 500) })
      }
      const parsed = parseChoiceResponse(await response.json(), options)
      return { ...parsed, latencyMs: Math.round(performance.now() - started), attempts: attempt + 1 }
    }
  }

  return { choose }
}
