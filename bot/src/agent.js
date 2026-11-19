import { once } from 'node:events'
import { buildCandidates, createMemory } from './candidates.js'
import { chooseObjective } from './objectives.js'
import { createPerception } from './perception.js'
import { createSkills } from './skills.js'
import { count } from './items.js'

const FAILURE_COOLDOWN_STEPS = { collect_drops: 5, tunnel: 4, explore: 3, dig_down: 3 }
// $42 per billion input tokens; output tokens are free (docs.typesafe.ai/models).
const JEV_USD_PER_INPUT_TOKEN = 42e-9

export async function runAgent ({ bot, config, policy, runlog, say = () => {} }) {
  const memory = createMemory()
  const badPositions = new Set()
  const perception = createPerception(bot, { badPositions })
  const skills = createSkills(bot, { badPositions })
  const stats = { steps: 0, jevCalls: 0, jevLatencyMs: 0, jevInputTokens: 0, fallbacks: 0, deaths: 0, startedAt: Date.now() }
  let objectiveId = null
  let lastLife = 0
  let stockedIronPickaxes = false

  bot.on('death', () => {
    stats.deaths++
    memory.recent.push({ action: 'died', outcome: 'died before respawning' })
    runlog.event('death', { step: memory.step })
  })

  for (;;) {
    while (lastLife !== stats.deaths) {
      lastLife = stats.deaths
      if (!bot.isAlive) await once(bot, 'spawn', { signal: AbortSignal.timeout(15_000) })
      await bot.waitForChunksToLoad()
      memory.blockedUntil.clear()
      badPositions.clear()
      stockedIronPickaxes = false
    }
    const snapshot = perception.snapshot()
    const ironPickaxes = count(snapshot.inventory, 'iron_pickaxe')
    if (ironPickaxes !== 1) stockedIronPickaxes = ironPickaxes >= 2
    const objective = chooseObjective(snapshot, config.world, { stockedIronPickaxes })
    if (objective.id !== 'done' && memory.step >= config.maxSteps) break
    if (objective.id !== 'done') stats.steps = ++memory.step

    if (objective.id !== objectiveId) {
      runlog.event('objective', { step: memory.step, objective: objective.id, position: snapshot.position })
      say(`Objective: ${objective.id}`)
      objectiveId = objective.id
    }
    if (objective.id === 'done') {
      return { success: true, stats: finish(stats), position: snapshot.position }
    }

    const candidates = buildCandidates(snapshot, objective, memory)
    const decision = await policy.decide({ snapshot, objective, candidates, memory })
    if (decision.jev) {
      stats.jevCalls++
      stats.jevLatencyMs += decision.jev.latencyMs ?? 0
      stats.jevInputTokens += decision.jev.inputTokens ?? 0
    }
    if (decision.source.startsWith('heuristic_')) stats.fallbacks++

    const chosen = decision.candidate
    const started = Date.now()
    const outcome = lastLife === stats.deaths
      ? await skills.run(chosen)
      : { ok: false, detail: 'died before the action could start' }
    const durationMs = Date.now() - started

    memory.recent.push({ action: chosen.key, outcome: `${outcome.ok ? 'ok' : 'failed'}: ${outcome.detail}` })
    if (memory.recent.length > 12) memory.recent.shift()
    if (chosen.kind === 'tunnel') memory.lastTunnelDir = chosen.params.dir
    if (chosen.kind === 'explore') memory.lastExploreDir = chosen.params.dir
    if (!outcome.ok) {
      memory.blockedUntil.set(chosen.key, memory.step + (FAILURE_COOLDOWN_STEPS[chosen.kind] ?? 2))
    }

    runlog.event('step', {
      step: memory.step,
      objective: objective.id,
      position: snapshot.position,
      health: snapshot.health,
      food: snapshot.food,
      inventory: snapshot.inventory,
      candidates: candidates.map((c) => c.key),
      choice: chosen.key,
      source: decision.source,
      jev: decision.jev,
      ok: outcome.ok,
      detail: outcome.detail,
      durationMs
    })
    const confidence = decision.jev?.confidence !== undefined ? ` conf=${decision.jev.confidence.toFixed(2)}` : ''
    const latency = decision.jev?.latencyMs !== undefined ? ` ${decision.jev.latencyMs}ms` : ''
    console.log(
      `#${memory.step} y=${snapshot.position.y} hp=${Math.round(snapshot.health)} food=${snapshot.food} ` +
      `[${objective.id}] ${decision.source}${confidence}${latency} -> ${chosen.key}: ` +
      `${outcome.ok ? 'ok' : 'FAILED'} ${outcome.detail}`
    )
  }
  return { success: false, reason: `stopped after ${config.maxSteps} steps`, stats: finish(stats) }
}

function finish (stats) {
  const { startedAt, ...rest } = stats
  return {
    ...rest,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    avgJevLatencyMs: stats.jevCalls ? Math.round(stats.jevLatencyMs / stats.jevCalls) : null,
    estimatedJevCostUsd: Number((stats.jevInputTokens * JEV_USD_PER_INPUT_TOKEN).toFixed(4))
  }
}
