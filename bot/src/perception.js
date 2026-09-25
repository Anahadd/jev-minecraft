const CRAFT_TARGETS = ['stick', 'crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'furnace', 'stone_sword']
const ORES = [
  'coal_ore', 'deepslate_coal_ore', 'iron_ore', 'deepslate_iron_ore', 'diamond_ore', 'deepslate_diamond_ore'
]

export const positionKey = (p) => `${p.x},${p.y},${p.z}`

// The bot only reports blocks in line of sight, so ore behind stone stays hidden. There is no x-ray.
export function createPerception (bot, { badPositions }) {
  const registry = bot.registry
  const blockIds = (names) => names.map((name) => registry.blocksByName[name]?.id).filter((id) => id !== undefined)
  const logIds = Object.values(registry.blocksByName)
    .filter((block) => block.name.endsWith('_log'))
    .map((block) => block.id)

  const scans = [
    { ids: logIds, maxDistance: 32, count: 64 },
    { ids: blockIds(ORES), maxDistance: 24, count: 96 },
    { ids: blockIds(['stone', 'deepslate']), maxDistance: 8, count: 48 },
    { ids: blockIds(['lava']), maxDistance: 12, count: 24 }
  ]
  const tableId = registry.blocksByName.crafting_table.id
  const furnaceIds = blockIds(['furnace', 'lit_furnace'])

  function inventoryCounts () {
    const counts = {}
    for (const item of bot.inventory.items()) counts[item.name] = (counts[item.name] ?? 0) + item.count
    return counts
  }

  function canHarvest (block, inventory) {
    if (!block.harvestTools) return true
    return Object.keys(block.harvestTools).some((id) => (inventory[registry.items[id]?.name] ?? 0) > 0)
  }

  function visibleBlocks (inventory) {
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight, 0)
    const groups = new Map()
    for (const scan of scans) {
      if (scan.ids.length === 0) continue
      for (const position of bot.findBlocks({ matching: scan.ids, maxDistance: scan.maxDistance, count: scan.count })) {
        if (badPositions.has(positionKey(position))) continue
        const block = bot.blockAt(position)
        if (!block || !bot.canSeeBlock(block)) continue
        const distance = eye.distanceTo(position.offset(0.5, 0.5, 0.5))
        let group = groups.get(block.name)
        if (!group) {
          group = { name: block.name, count: 0, distance, nearest: position, harvestable: canHarvest(block, inventory) }
          groups.set(block.name, group)
        }
        group.count++
        if (distance < group.distance) {
          group.distance = distance
          group.nearest = position
        }
      }
    }
    return [...groups.values()]
      .map((group) => ({ ...group, nearest: { x: group.nearest.x, y: group.nearest.y, z: group.nearest.z } }))
      .sort((a, b) => a.distance - b.distance)
  }

  function nearbyEntities () {
    const position = bot.entity.position
    const mobs = []
    const drops = { count: 0, nearestDistance: Infinity }
    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity || !entity.position) continue
      const distance = position.distanceTo(entity.position)
      if (entity.name === 'item' && distance <= 8) {
        drops.count++
        drops.nearestDistance = Math.min(drops.nearestDistance, distance)
      } else if (entity.type === 'hostile' && distance <= 24) {
        mobs.push({ id: entity.id, name: entity.name, kind: 'hostile', distance })
      } else if (entity.type === 'animal' && distance <= 32) {
        mobs.push({ id: entity.id, name: entity.name, kind: 'animal', distance })
      }
    }
    mobs.sort((a, b) => a.distance - b.distance)
    return { mobs, drops }
  }

  function stationDistance (ids) {
    if (ids.length === 0) return null
    const block = bot.findBlock({ matching: ids, maxDistance: 16 })
    return block ? bot.entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5)) : null
  }

  function craftable (inventory, stations) {
    const tableAvailable = (inventory.crafting_table ?? 0) > 0 || stations.crafting_table !== null
    const result = {}
    for (const name of CRAFT_TARGETS) {
      const item = registry.itemsByName[name]
      result[name] = bot.recipesFor(item.id, null, 1, tableAvailable ? true : null).length > 0
    }
    return result
  }

  function snapshot () {
    const entity = bot.entity
    const position = entity.position.floored()
    const inventory = inventoryCounts()
    const stations = { crafting_table: stationDistance([tableId]), furnace: stationDistance(furnaceIds) }
    const { mobs, drops } = nearbyEntities()
    const skyLight = bot.blockAt(position.offset(0, 1, 0))?.skyLight
    const timeOfDay = bot.time.timeOfDay
    return {
      position: { x: position.x, y: position.y, z: position.z },
      health: bot.health,
      food: bot.food,
      isNight: timeOfDay >= 13000 && timeOfDay <= 23000,
      inWater: Boolean(entity.isInWater),
      underground: position.y < 56 || (typeof skyLight === 'number' && skyLight < 8),
      held: bot.heldItem?.name ?? null,
      inventory,
      visible: visibleBlocks(inventory),
      mobs,
      drops,
      stations,
      craftable: craftable(inventory, stations)
    }
  }

  return { snapshot }
}
