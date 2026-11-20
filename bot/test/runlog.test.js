import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRunLog } from '../src/runlog.js'

test('keeps simultaneous runs in distinct directories', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-runs-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['Date'], now: 0 })
  const first = createRunLog(dir)
  const second = createRunLog(dir)
  assert.notEqual(first.id, second.id)
  first.event('start', { policy: 'jev' })
  second.event('start', { policy: 'heuristic' })
  await Promise.all([first.close(), second.close()])
  assert.equal(JSON.parse(await readFile(join(first.dir, 'events.jsonl'), 'utf8')).policy, 'jev')
  assert.equal(JSON.parse(await readFile(join(second.dir, 'events.jsonl'), 'utf8')).policy, 'heuristic')
})
