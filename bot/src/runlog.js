import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function createRunLog (runsDir) {
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(runsDir, id)
  mkdirSync(dir, { recursive: true })
  const stream = createWriteStream(join(dir, 'events.jsonl'), { flags: 'a' })

  return {
    id,
    dir,
    event (type, data = {}) {
      stream.write(JSON.stringify({ t: new Date().toISOString(), type, ...data }) + '\n')
    },
    summary (data) {
      writeFileSync(join(dir, 'summary.json'), JSON.stringify(data, null, 2) + '\n')
    },
    close () {
      return new Promise((resolve) => stream.end(resolve))
    }
  }
}
