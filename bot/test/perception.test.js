import assert from 'node:assert/strict'
import { test } from 'node:test'
import registryFor from 'prismarine-registry'
import vec3 from 'vec3'
import { createPerception, positionKey } from '../src/perception.js'

const { Vec3 } = vec3

test('occluded ore and unreachable blocks do not crowd visible ore out of the scan', () => {
  const registry = registryFor('1.20.4')
  const blocks = new Map()
  function addBlock (name, position, visible) {
    const { id: type, harvestTools } = registry.blocksByName[name]
    const block = { name, type, harvestTools, position, visible }
    blocks.set(positionKey(position), block)
    return block
  }
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) addBlock('iron_ore', new Vec3(x, 13, z), false)
  }
  const unreachable = addBlock('iron_ore', new Vec3(1, 16, 0), true)
  const diamond = addBlock('diamond_ore', new Vec3(12, 16, 0), true)
  const bot = {
    registry,
    entity: { position: new Vec3(0.5, 16, 0.5), eyeHeight: 1.62 },
    entities: {},
    health: 20,
    food: 20,
    time: { timeOfDay: 0 },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] },
    blockAt: (position) => blocks.get(positionKey(position)),
    canSeeBlock: (block) => block.visible,
    findBlock: () => null,
    findBlocks: ({ matching, count, useExtraInfo }) => [...blocks.values()]
      .filter((block) => matching.includes(block.type) && (useExtraInfo?.(block) ?? true))
      .slice(0, count)
      .map((block) => block.position),
    recipesFor: () => []
  }
  const perception = createPerception(bot, { badPositions: new Set([positionKey(unreachable.position)]) })
  const [visible] = perception.snapshot().visible
  assert.equal(visible.name, diamond.name)
  assert.equal(visible.harvestable, true)
  assert.equal(perception.snapshot().visible.length, 1)
})
