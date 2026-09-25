import {
  count, fuelSmelts, isCoalOre, isDiamondOre, isIronOre, isLog, isStoneBlock, logCount, planksCount, stoneCount
} from './items.js'

// A scripted policy. It runs when POLICY=heuristic, and as the fallback when Jev is unsure or unavailable.
export function pickHeuristic (candidates, snapshot, objective, memory) {
  const inventory = snapshot.inventory
  const byKey = (key) => candidates.find((c) => c.key === key)
  const byPrefix = (prefix) => candidates.find((c) => c.key.startsWith(prefix))
  const mine = (predicate) => candidates.find((c) => c.kind === 'mine' && predicate(c.params.name))
  const first = (...options) => options.find(Boolean) ?? null

  const nearestHostile = snapshot.mobs.find((mob) => mob.kind === 'hostile')
  if (nearestHostile && nearestHostile.distance <= 6) {
    const pick = snapshot.health <= 8 ? first(byKey('flee'), byPrefix('attack_')) : first(byPrefix('attack_'), byKey('flee'))
    if (pick) return pick
  }
  if (snapshot.food <= 12) {
    const pick = first(byKey('eat'), byPrefix('hunt_'))
    if (pick) return pick
  }
  if (snapshot.health < 10) {
    const pick = byKey('rest')
    if (pick) return pick
  }
  if (snapshot.drops.count > 0 && snapshot.drops.nearestDistance <= 5) {
    const pick = byKey('collect_drops')
    if (pick) return pick
  }

  const craftChain = (target) => first(
    byKey(`craft_${target}`),
    byKey('craft_crafting_table'),
    count(inventory, 'stick') < 2 ? byKey('craft_stick') : null,
    planksCount(inventory) < 4 ? byKey('craft_planks') : null
  )
  const stone = () => first(mine(isStoneBlock))
  const onward = () => first(byKey('dig_down'), tunnel(candidates, memory), explore(candidates, memory))

  let pick = null
  switch (objective.id) {
    case 'make_wooden_pickaxe': {
      const wood = logCount(inventory) + planksCount(inventory) / 4
      pick = first(
        byKey('craft_wooden_pickaxe'),
        wood < 5 ? mine(isLog) : null,
        craftChain('wooden_pickaxe'),
        mine(isLog),
        explore(candidates, memory)
      )
      break
    }
    case 'make_stone_pickaxe':
      pick = first(
        byKey('craft_stone_pickaxe'),
        stoneCount(inventory) < 3 ? stone() : null,
        craftChain('stone_pickaxe'),
        onward()
      )
      break
    case 'find_iron':
      pick = first(
        mine(isIronOre),
        count(inventory, 'coal') < 1 ? mine(isCoalOre) : null,
        stoneCount(inventory) < 8 ? stone() : null,
        count(inventory, 'stone_sword') === 0 ? byKey('craft_stone_sword') : null,
        onward()
      )
      break
    case 'smelt_iron':
      pick = first(
        byKey('smelt_raw_iron'),
        byKey('craft_furnace'),
        stoneCount(inventory) < 8 ? stone() : null,
        byKey('craft_crafting_table'),
        fuelSmelts(inventory) < count(inventory, 'raw_iron') ? first(mine(isCoalOre), mine(isLog)) : null,
        tunnel(candidates, memory),
        explore(candidates, memory)
      )
      break
    case 'craft_iron_pickaxe':
      pick = first(craftChain('iron_pickaxe'), mine(isLog), explore(candidates, memory), tunnel(candidates, memory))
      break
    case 'reach_diamond_level':
      pick = first(mine(isDiamondOre), byKey('dig_down'), tunnel(candidates, memory))
      break
    case 'find_diamond':
      pick = first(mine(isDiamondOre), tunnel(candidates, memory), byKey('dig_down'))
      break
  }
  return pick ?? candidates[0]
}

function keepDirection (candidates, prefix, lastDir) {
  const options = candidates.filter((c) => c.key.startsWith(prefix))
  if (options.length === 0) return null
  return options.find((c) => c.params.dir === lastDir) ?? options[Math.floor(Math.random() * options.length)]
}

const tunnel = (candidates, memory) => keepDirection(candidates, 'tunnel_', memory.lastTunnelDir)
const explore = (candidates, memory) => keepDirection(candidates, 'explore_', memory.lastExploreDir)
