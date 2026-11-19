import { createWriteStream, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export function createRunLog (runsDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  mkdirSync(runsDir, { recursive: true })
  const dir = mkdtempSync(join(runsDir, `${timestamp}-`))
  const stream = createWriteStream(join(dir, 'events.jsonl'))

  return {
    id: basename(dir),
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
