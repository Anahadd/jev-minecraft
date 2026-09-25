export const PICKAXE_TIER = {
  wooden_pickaxe: 1,
  golden_pickaxe: 1,
  stone_pickaxe: 2,
  iron_pickaxe: 3,
  diamond_pickaxe: 4,
  netherite_pickaxe: 4
}

export const TIER_NAMES = ['none', 'wooden', 'stone', 'iron', 'diamond']

export const STONE_ITEMS = ['cobblestone', 'cobbled_deepslate', 'blackstone']

export const SWORDS = ['wooden_sword', 'stone_sword', 'golden_sword', 'iron_sword', 'diamond_sword', 'netherite_sword']

// Smelts per item, from the vanilla furnace fuel table.
export const FUEL_SMELTS = { coal: 8, charcoal: 8, coal_block: 80 }

// Raw chicken and rotten flesh are left out on purpose: they can cause hunger.
export const FOOD_ITEMS = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'cooked_chicken',
  'cooked_rabbit', 'cooked_cod', 'baked_potato', 'bread', 'beef', 'porkchop', 'mutton', 'rabbit',
  'apple', 'carrot', 'melon_slice', 'sweet_berries', 'cod', 'salmon', 'potato', 'cookie', 'dried_kelp'
]

export const ORE_DROPS = {
  stone: 'cobblestone',
  deepslate: 'cobbled_deepslate',
  coal_ore: 'coal',
  deepslate_coal_ore: 'coal',
  iron_ore: 'raw_iron',
  deepslate_iron_ore: 'raw_iron',
  diamond_ore: 'diamond',
  deepslate_diamond_ore: 'diamond'
}

export const isLog = (name) => name.endsWith('_log')
export const isPlanks = (name) => name.endsWith('_planks')
export const isDiamondOre = (name) => name === 'diamond_ore' || name === 'deepslate_diamond_ore'
export const isIronOre = (name) => name === 'iron_ore' || name === 'deepslate_iron_ore'
export const isCoalOre = (name) => name === 'coal_ore' || name === 'deepslate_coal_ore'
export const isStoneBlock = (name) => name === 'stone' || name === 'deepslate'

export function count (inventory, name) {
  return inventory[name] ?? 0
}

export function countWhere (inventory, predicate) {
  let total = 0
  for (const [name, amount] of Object.entries(inventory)) {
    if (predicate(name)) total += amount
  }
  return total
}

export function pickaxeTier (inventory) {
  let tier = 0
  for (const [name, level] of Object.entries(PICKAXE_TIER)) {
    if (count(inventory, name) > 0) tier = Math.max(tier, level)
  }
  return tier
}

export const logCount = (inventory) => countWhere(inventory, isLog)
export const planksCount = (inventory) => countWhere(inventory, isPlanks)
export const stoneCount = (inventory) => countWhere(inventory, (name) => STONE_ITEMS.includes(name))
export const ironUnits = (inventory) => count(inventory, 'raw_iron') + count(inventory, 'iron_ingot')
export const hasSword = (inventory) => SWORDS.some((name) => count(inventory, name) > 0)

// Logs and planks burn for 1.5 smelts each; sticks for 0.5.
export function fuelSmelts (inventory) {
  let smelts = 0
  for (const [name, amount] of Object.entries(inventory)) {
    if (FUEL_SMELTS[name]) smelts += FUEL_SMELTS[name] * amount
    else if (isLog(name) || isPlanks(name)) smelts += 1.5 * amount
  }
  return smelts
}

export function bestFood (inventory) {
  return FOOD_ITEMS.find((name) => count(inventory, name) > 0) ?? null
}

export function plankNameForLog (logName) {
  return logName.replace(/^stripped_/, '').replace(/_log$/, '_planks')
}
