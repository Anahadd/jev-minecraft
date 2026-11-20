import {
  ORE_DROPS, bestFood, count, fuelSmelts, hasSword, isLog, logCount, pickaxeTier
} from './items.js'

export const DIRECTIONS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
export const TUNNEL_LENGTH = 12
export const EXPLORE_DISTANCE = 32
const DIG_DOWN_STEP = 10
const DIAMOND_TUNNEL_LENGTH = 4
const FOOD_ANIMALS = new Set(['cow', 'pig', 'sheep', 'rabbit', 'mooshroom'])

export function createMemory () {
  return { step: 0, blockedUntil: new Map(), recent: [], lastTunnelDir: null, lastExploreDir: null }
}

export function isBlocked (memory, key) {
  return (memory.blockedUntil.get(key) ?? -1) > memory.step
}

const distanceText = (d) => `${Math.round(d)} block${Math.round(d) === 1 ? '' : 's'}`

// Every candidate is a legal, executable action for the current snapshot. Jev picks one.
export function buildCandidates (snapshot, objective, memory = createMemory()) {
  const inventory = snapshot.inventory
  const tier = pickaxeTier(inventory)
  const y = snapshot.position.y
  const candidates = []
  const keys = new Map()
  const add = (candidate) => {
    const seen = keys.get(candidate.key) ?? 0
    keys.set(candidate.key, seen + 1)
    const key = seen === 0 ? candidate.key : `${candidate.key}_${seen + 1}`
    if (!isBlocked(memory, key)) candidates.push({ ...candidate, key })
  }

  const hostiles = snapshot.mobs.filter((mob) => mob.kind === 'hostile')
  for (const mob of hostiles.filter((m) => m.distance <= 10).slice(0, 2)) {
    add({
      key: `attack_${mob.name}`,
      kind: 'attack',
      params: { entityId: mob.id },
      description: `Fight the ${mob.name} ${distanceText(mob.distance)} away.`,
      timeoutMs: 20_000
    })
  }
  if (hostiles.some((mob) => mob.distance <= 16)) {
    const nearest = hostiles[0]
    add({
      key: 'flee',
      kind: 'flee',
      params: {},
      description: `Run away from hostile mobs (nearest: ${nearest.name}, ${distanceText(nearest.distance)} away).`,
      timeoutMs: 10_000
    })
  }

  const food = bestFood(inventory)
  if (food && snapshot.food <= 17) {
    add({ key: 'eat', kind: 'eat', params: { item: food }, description: `Eat ${food} (food is ${snapshot.food}/20).`, timeoutMs: 10_000 })
  }
  if (!food && snapshot.food <= 14) {
    const animal = snapshot.mobs.find((mob) => mob.kind === 'animal' && FOOD_ANIMALS.has(mob.name) && mob.distance <= 32)
    if (animal) {
      add({
        key: `hunt_${animal.name}`,
        kind: 'attack',
        params: { entityId: animal.id, collect: true },
        description: `Kill the ${animal.name} ${distanceText(animal.distance)} away for raw meat.`,
        timeoutMs: 30_000
      })
    }
  }
  if (snapshot.health < 14 && snapshot.food >= 18) {
    add({ key: 'rest', kind: 'rest', params: { seconds: 5 }, description: 'Stand still for 5 seconds to regain health.', timeoutMs: 8_000 })
  }
  if (snapshot.drops.count > 0) {
    add({
      key: 'collect_drops',
      kind: 'collect_drops',
      params: {},
      description: `Pick up ${snapshot.drops.count} dropped item stack(s) within ${distanceText(snapshot.drops.nearestDistance)}.`,
      timeoutMs: 20_000
    })
  }

  const logTypes = new Set()
  for (const group of snapshot.visible) {
    if (!group.harvestable) continue
    const log = isLog(group.name)
    if (!log && !ORE_DROPS[group.name]) continue
    if (log) {
      if (logTypes.size >= 3) continue
      logTypes.add(group.name)
    }
    const drop = log ? 'a log' : ORE_DROPS[group.name]
    add({
      key: `mine_${group.name}`,
      kind: 'mine',
      params: { name: group.name, position: group.nearest },
      description: `Mine the nearest visible ${group.name} (${group.count} visible, nearest ${distanceText(group.distance)} away). It drops ${drop}.`,
      timeoutMs: 40_000
    })
  }

  const hasTable = count(inventory, 'crafting_table') > 0 || snapshot.stations.crafting_table !== null
  const craft = (item, condition, description) => {
    if (snapshot.craftable[item] && condition) {
      add({ key: `craft_${item}`, kind: 'craft', params: { item }, description, timeoutMs: 30_000 })
    }
  }
  if (logCount(inventory) > 0) {
    add({ key: 'craft_planks', kind: 'craft', params: { item: 'planks' }, description: 'Craft 4 planks from 1 log.', timeoutMs: 15_000 })
  }
  craft('stick', count(inventory, 'stick') < 4, 'Craft 4 sticks from 2 planks.')
  craft('crafting_table', !hasTable, 'Craft a crafting table from 4 planks. Pickaxes need a crafting table.')
  craft('wooden_pickaxe', tier < 1, 'Craft a wooden pickaxe (3 planks, 2 sticks) at a crafting table.')
  craft('stone_pickaxe', tier < 2, 'Craft a stone pickaxe (3 cobblestone, 2 sticks) at a crafting table.')
  craft('iron_pickaxe', objective.id === 'craft_iron_pickaxe',
    'Craft an iron pickaxe (3 iron ingots, 2 sticks) at a crafting table.')
  craft('furnace', tier >= 2 && count(inventory, 'furnace') === 0 && snapshot.stations.furnace === null,
    'Craft a furnace from 8 cobblestone at a crafting table.')
  craft('stone_sword', tier >= 2 && !hasSword(inventory), 'Craft a stone sword (2 cobblestone, 1 stick) for fighting.')

  const smeltCount = Math.min(count(inventory, 'raw_iron'), Math.floor(fuelSmelts(inventory)))
  const furnaceReady = count(inventory, 'furnace') > 0 || snapshot.stations.furnace !== null
  if (smeltCount > 0 && furnaceReady) {
    add({
      key: 'smelt_raw_iron',
      kind: 'smelt',
      params: { count: smeltCount },
      description: `Smelt ${smeltCount} raw iron into iron ingots in a furnace (about ${smeltCount * 10} seconds).`,
      timeoutMs: smeltCount * 10_000 + 40_000
    })
  }

  if (tier >= 1 && objective.targetY !== undefined && y > objective.targetY + 1) {
    const to = Math.max(objective.targetY, y - DIG_DOWN_STEP)
    const suffix = to > objective.targetY ? `, on the way to Y=${objective.targetY}` : ''
    add({
      key: 'dig_down',
      kind: 'dig_down',
      params: { targetY: to },
      description: `Dig down from Y=${y} to Y=${to}${suffix}.`,
      timeoutMs: 60_000
    })
  }
  if (tier >= 1 && snapshot.underground) {
    const length = objective.id === 'find_diamond' ? DIAMOND_TUNNEL_LENGTH : TUNNEL_LENGTH
    for (const dir of Object.keys(DIRECTIONS)) {
      const again = memory.lastTunnelDir === dir ? ' This continues your last tunnel.' : ''
      add({
        key: `tunnel_${dir}`,
        kind: 'tunnel',
        params: { dir, length },
        description: `Dig a 1x2 tunnel ${length} blocks ${dir} at Y=${y}. Check the exposed walls for ore.${again}`,
        timeoutMs: 90_000
      })
    }
  }
  if (!snapshot.underground || tier === 0) {
    for (const dir of Object.keys(DIRECTIONS)) {
      const again = memory.lastExploreDir === dir ? ' This is the same direction as last time.' : ''
      add({
        key: `explore_${dir}`,
        kind: 'explore',
        params: { dir, distance: EXPLORE_DISTANCE },
        description: `Walk about ${EXPLORE_DISTANCE} blocks ${dir} to find trees, animals, or exposed stone.${again}`,
        timeoutMs: 45_000
      })
    }
  }

  if (candidates.length === 0) {
    candidates.push({ key: 'wait', kind: 'rest', params: { seconds: 3 }, description: 'Wait 3 seconds.', timeoutMs: 5_000 })
  }
  return candidates
}
