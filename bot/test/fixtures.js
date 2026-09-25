export const WORLD = { diamondY: -58, ironY: 16 }

export function snapshot (overrides = {}) {
  return {
    position: { x: 0, y: 70, z: 0 },
    health: 20,
    food: 20,
    isNight: false,
    inWater: false,
    underground: false,
    held: null,
    inventory: {},
    visible: [],
    mobs: [],
    drops: { count: 0, nearestDistance: Infinity },
    stations: { crafting_table: null, furnace: null },
    craftable: {},
    ...overrides
  }
}

export const visible = (name, distance = 4, count = 1) => ({
  name,
  count,
  distance,
  nearest: { x: 1, y: 70, z: 1 },
  harvestable: true
})
