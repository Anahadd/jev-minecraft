import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

test('writes a failed summary when the server disconnects before spawn', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jev-startup-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const server = createServer((socket) => socket.destroy())
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const main = fileURLToPath(new URL('../src/main.js', import.meta.url))
  await assert.rejects(run(process.execPath, [main], {
    env: {
      ...process.env,
      POLICY: 'heuristic',
      MC_HOST: '127.0.0.1',
      MC_PORT: String(server.address().port),
      MC_VERSION: '1.20.4',
      RUNS_DIR: dir
    },
    timeout: 10_000
  }), { code: 1 })

  const [runId] = await readdir(dir)
  const summary = JSON.parse(await readFile(join(dir, runId, 'summary.json'), 'utf8'))
  assert.equal(summary.success, false)
  assert.match(summary.reason, /disconnected|ECONNRESET|EPIPE/)
  const events = (await readFile(join(dir, runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(events.at(-1).type, 'disconnected')
})
