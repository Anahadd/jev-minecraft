import { pickHeuristic } from './heuristic.js'
import { TIER_NAMES, pickaxeTier } from './items.js'

export const CHOICE_INSTRUCTIONS =
  'Pick the one action that best advances `current_objective` right now while keeping the player alive. ' +
  'Deal with danger in `player` and `nearby_mobs` first. ' +
  'Prefer continuing a step that is working over switching. ' +
  'Do not repeat an action that just failed in `recent_actions`.'

export const RULES = [
  '1 log crafts 4 planks. 2 planks craft 4 sticks. 4 planks craft a crafting table.',
  'Pickaxes, swords, and furnaces need a crafting table. A wooden pickaxe needs 3 planks and 2 sticks.',
  'Stone mined with a pickaxe drops cobblestone, and deepslate drops cobbled deepslate. Both craft stone tools and furnaces.',
  'Iron ore needs a stone pickaxe or better and drops raw iron. A furnace (8 cobblestone) smelts raw iron with coal, planks, or logs as fuel.',
  'An iron pickaxe needs 3 iron ingots and 2 sticks. Diamond ore needs an iron pickaxe; a weaker pickaxe destroys it.',
  'Diamond ore is below Y=16 and most common near Y=-58. Iron ore is common near Y=16.',
  'Hostile mobs appear at night and in dark caves. Health regenerates when food is 18 or more.'
]

export function toJevState (snapshot, objective, memory) {
  const round = (n) => Math.round(n * 10) / 10
  return {
    goal: 'Get one diamond in survival Minecraft without cheats.',
    current_objective: objective.description,
    player: {
      health: `${Math.round(snapshot.health)}/20`,
      food: `${snapshot.food}/20`,
      y: snapshot.position.y,
      time: snapshot.isNight ? 'night' : 'day',
      underground: snapshot.underground,
      in_water: snapshot.inWater,
      holding: snapshot.held,
      best_pickaxe: TIER_NAMES[pickaxeTier(snapshot.inventory)]
    },
    inventory: snapshot.inventory,
    visible_blocks: snapshot.visible.map((group) => ({ block: group.name, visible: group.count, nearest_blocks_away: round(group.distance) })),
    nearby_mobs: snapshot.mobs.slice(0, 6).map((mob) => ({ mob: mob.name, hostile: mob.kind === 'hostile', blocks_away: round(mob.distance) })),
    nearby_stations: {
      crafting_table: snapshot.stations.crafting_table === null ? 'none' : `${round(snapshot.stations.crafting_table)} blocks away`,
      furnace: snapshot.stations.furnace === null ? 'none' : `${round(snapshot.stations.furnace)} blocks away`
    },
    recent_actions: memory.recent.slice(-6),
    rules: RULES
  }
}

// Jev decides; code falls back to the scripted pick when Jev is unsure or fails.
export function createPolicy ({ mode, jev, minConfidence, log = () => {} }) {
  async function decide ({ snapshot, objective, candidates, memory }) {
    const fallback = () => pickHeuristic(candidates, snapshot, objective, memory)

    if (mode === 'heuristic') return { candidate: fallback(), source: 'heuristic' }
    if (candidates.length === 1) return { candidate: candidates[0], source: 'only_option' }

    const state = toJevState(snapshot, objective, memory)
    try {
      const result = await jev.choose({ state, instructions: CHOICE_INSTRUCTIONS, options: candidates })
      const jevInfo = {
        confidence: result.confidence,
        probabilities: result.probabilities,
        latencyMs: result.latencyMs,
        model: result.model,
        inputTokens: result.usage?.input_tokens
      }
      if (typeof result.confidence === 'number' && result.confidence < minConfidence) {
        return { candidate: fallback(), source: 'heuristic_low_confidence', jev: { ...jevInfo, choice: result.option.key } }
      }
      return { candidate: result.option, source: 'jev', jev: jevInfo }
    } catch (error) {
      log('jev_error', { message: error.message, status: error.status, body: error.body })
      if (error.status === 401 || error.status === 403) throw error
      return { candidate: fallback(), source: 'heuristic_jev_error' }
    }
  }

  return { decide }
}
