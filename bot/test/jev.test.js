import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JevError, buildChoiceRequest, createJevClient, parseChoiceResponse } from '../src/jev.js'

const options = [
  { key: 'mine_oak_log', description: 'Mine the nearest oak log.' },
  { key: 'explore_north', description: 'Walk north.' }
]

function jsonResponse (status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

const okBody = {
  model: 'jev-1.13.0',
  answers: {
    action: {
      type: 'choice',
      choice: 'mine_oak_log',
      probabilities: { mine_oak_log: 0.9, explore_north: 0.1 },
      confidence: 0.84
    }
  },
  usage: { input_tokens: 812, output_tokens: 20 }
}

test('builds a choice request in the documented systemone shape', () => {
  const body = buildChoiceRequest({ model: 'jev-latest', state: { y: 64 }, instructions: 'Pick one.', options })
  assert.deepEqual(body, {
    model: 'jev-latest',
    state: { y: 64 },
    questions: {
      action: {
        type: 'choice',
        instructions: 'Pick one.',
        criteria: { mine_oak_log: 'Mine the nearest oak log.', explore_north: 'Walk north.' }
      }
    }
  })
})

test('sends state as a JSON string for providers that need it', () => {
  const body = buildChoiceRequest({ model: 'm', state: { y: 64 }, instructions: 'x', options, stateAsString: true })
  assert.equal(body.state, '{"y":64}')
})

test('rejects option counts the API does not accept', () => {
  assert.throws(() => buildChoiceRequest({ model: 'm', state: {}, instructions: 'x', options: options.slice(0, 1) }), JevError)
  const many = Array.from({ length: 256 }, (_, i) => ({ key: `a${i}`, description: 'd' }))
  assert.throws(() => buildChoiceRequest({ model: 'm', state: {}, instructions: 'x', options: many }), JevError)
})

test('maps the chosen key back to the option', () => {
  const parsed = parseChoiceResponse(okBody, options)
  assert.equal(parsed.option, options[0])
  assert.equal(parsed.confidence, 0.84)
  assert.equal(parsed.usage.input_tokens, 812)
})

test('rejects an answer that names an unknown option', () => {
  const body = structuredClone(okBody)
  body.answers.action.choice = 'fly_away'
  assert.throws(() => parseChoiceResponse(body, options), /unknown option "fly_away"/)
})

test('client posts to the endpoint with a bearer key', async () => {
  let seen
  const client = createJevClient({
    url: 'https://api.typesafe.ai/v1/systemone',
    apiKey: 'sk-test',
    model: 'jev-latest',
    timeoutMs: 1000,
    fetchImpl: async (url, init) => {
      seen = { url, init }
      return jsonResponse(200, okBody)
    }
  })
  const result = await client.choose({ state: { y: 1 }, instructions: 'Pick.', options })
  assert.equal(seen.url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test')
  assert.equal(JSON.parse(seen.init.body).questions.action.type, 'choice')
  assert.equal(result.option.key, 'mine_oak_log')
  assert.equal(result.attempts, 1)
})

test('client retries 429 and 529 with backoff, then succeeds', async () => {
  const statuses = [429, 529, 200]
  const delays = []
  const client = createJevClient({
    url: 'u',
    apiKey: 'k',
    model: 'm',
    timeoutMs: 1000,
    sleep: async (ms) => { delays.push(ms) },
    fetchImpl: async () => {
      const status = statuses.shift()
      return status === 200 ? jsonResponse(200, okBody) : jsonResponse(status, { error: 'busy' }, { 'retry-after': '1' })
    }
  })
  const result = await client.choose({ state: {}, instructions: 'x', options })
  assert.equal(result.attempts, 3)
  assert.deepEqual(delays, [1000, 1000])
})

test('client does not retry an invalid key', async () => {
  let calls = 0
  const client = createJevClient({
    url: 'u',
    apiKey: 'bad',
    model: 'm',
    timeoutMs: 1000,
    sleep: async () => {},
    fetchImpl: async () => {
      calls++
      return jsonResponse(401, { error: 'invalid key' })
    }
  })
  await assert.rejects(client.choose({ state: {}, instructions: 'x', options }), (error) => error.status === 401)
  assert.equal(calls, 1)
})
