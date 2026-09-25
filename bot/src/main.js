import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import { runAgent } from './agent.js'
import { loadConfig } from './config.js'
import { createJevClient } from './jev.js'
import { createPolicy } from './policy.js'
import { createRunLog } from './runlog.js'

const config = loadConfig()
const runlog = createRunLog(config.runsDir)
console.log(`Run ${runlog.id}: policy=${config.policy} provider=${config.jev.provider} model=${config.jev.model}`)
console.log(`Connecting to ${config.mc.host}:${config.mc.port} as ${config.mc.username} (Minecraft ${config.mc.version})`)

const bot = mineflayer.createBot({
  host: config.mc.host,
  port: config.mc.port,
  username: config.mc.username,
  version: config.mc.version,
  auth: 'offline'
})
bot.loadPlugin(pathfinderPkg.pathfinder)

bot.on('kicked', (reason) => {
  console.error('Kicked:', reason)
  runlog.event('kicked', { reason: String(reason) })
})
bot.on('error', (error) => {
  console.error('Bot error:', error.message)
  runlog.event('bot_error', { message: error.message })
})
bot.on('end', async (reason) => {
  runlog.event('disconnected', { reason })
  await runlog.close()
  process.exit(process.exitCode ?? 0)
})

bot.once('spawn', async () => {
  if (config.viewerPort) {
    try {
      const viewerModule = await import('prismarine-viewer')
      const { mineflayer: startViewer } = viewerModule.default ?? viewerModule
      startViewer(bot, { port: config.viewerPort, firstPerson: false })
      console.log(`Viewer: http://localhost:${config.viewerPort}`)
    } catch (error) {
      console.warn(`Viewer disabled (${error.message.split('\n')[0]}). The run continues without it.`)
    }
  }
  await bot.waitForChunksToLoad()

  const jev = config.policy === 'jev' ? createJevClient(config.jev) : null
  const policy = createPolicy({
    mode: config.policy,
    jev,
    minConfidence: config.jev.minConfidence,
    log: (type, data) => runlog.event(type, data)
  })
  runlog.event('start', { policy: config.policy, provider: config.jev.provider, model: config.jev.model, world: config.world })

  let result
  try {
    result = await runAgent({ bot, config, policy, runlog, say: (text) => bot.chat(text) })
  } catch (error) {
    console.error('Agent stopped:', error.message)
    result = { success: false, reason: error.message }
    process.exitCode = 1
  }
  runlog.summary({ run: runlog.id, policy: config.policy, model: config.jev.model, ...result })
  console.log(result.success ? `Found a diamond! ${JSON.stringify(result.stats)}` : `No diamond: ${result.reason}`)
  console.log(`Run log: ${runlog.dir}`)
  if (!result.success) process.exitCode = 1
  bot.quit()
})
