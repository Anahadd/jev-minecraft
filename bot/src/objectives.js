import { count, ironUnits, logCount, pickaxeTier, planksCount, stoneCount } from './items.js'

// The tech tree to a diamond is fixed, so code picks the objective and Jev picks each action.
export function chooseObjective (snapshot, world, { stockedIronPickaxes = false } = {}) {
  const inventory = snapshot.inventory
  const y = snapshot.position.y
  const tier = pickaxeTier(inventory)
  const ironPickaxes = count(inventory, 'iron_pickaxe')

  if (count(inventory, 'diamond') > 0) {
    return { id: 'done', description: 'You have a diamond. The goal is complete.' }
  }

  if (tier > 3 || ironPickaxes >= 2 || (ironPickaxes === 1 && stockedIronPickaxes)) {
    if (y > world.diamondY + 4) {
      return {
        id: 'reach_diamond_level',
        targetY: world.diamondY,
        description: `Dig down from Y=${y} to about Y=${world.diamondY}, where diamond ore is most common.`
      }
    }
    return {
      id: 'find_diamond',
      targetY: world.diamondY,
      description: 'Tunnel through the deepslate at this height and mine any visible diamond ore with the iron pickaxe.'
    }
  }

  if (tier >= 2) {
    const ironNeeded = (2 - ironPickaxes) * 3
    if (count(inventory, 'iron_ingot') >= 3) {
      return {
        id: 'craft_iron_pickaxe',
        description: `Craft ${ironPickaxes === 0 ? 'your first' : 'a spare'} iron pickaxe from 3 iron ingots and 2 sticks at a crafting table.`
      }
    }
    if (ironUnits(inventory) >= ironNeeded) {
      return {
        id: 'smelt_iron',
        description: `Smelt raw iron until you have ${ironNeeded} iron ingots for your remaining pickaxe(s). ` +
          'A furnace needs 8 cobblestone. Coal, planks, and logs work as fuel.'
      }
    }
    return {
      id: 'find_iron',
      targetY: world.ironY,
      description: `Collect ${ironNeeded} raw iron or ingots for your remaining pickaxe(s) (you have ${ironUnits(inventory)}). ` +
        `Iron ore is common in stone near Y=${world.ironY} and in cave walls. Keep 8 cobblestone for a furnace.`
    }
  }

  if (tier === 1) {
    return {
      id: 'make_stone_pickaxe',
      targetY: y - 6,
      description: `Get 3 cobblestone by mining stone (you have ${stoneCount(inventory)}), then craft a stone pickaxe with 2 sticks.`
    }
  }

  const wood = logCount(inventory) + planksCount(inventory) / 4
  return {
    id: 'make_wooden_pickaxe',
    description: `Collect at least 5 logs (you have ${Math.floor(wood)} log-equivalents); the extra wood is needed later for sticks and fuel. ` +
      'Then craft planks, sticks, and a crafting table, and craft a wooden pickaxe.'
  }
}
