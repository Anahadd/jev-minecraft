import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import registryFor from 'prismarine-registry'
import vec3 from 'vec3'
import { createSkills } from '../src/skills.js'

const { Vec3 } = vec3

test('places a crafting table against a wall when there is no floor beneath its spot', async () => {
  const position = new Vec3(0.5, 64, 0.5)
  const wall = { name: 'stone', boundingBox: 'block', position: new Vec3(2, 64, 0) }
  const target = new Vec3(1, 64, 0)
  const floor = { name: 'stone', boundingBox: 'block', position: new Vec3(0, 63, 0) }
  const table = { name: 'crafting_table', boundingBox: 'block', position: target }
  const recipe = {}
  let placed = null
  let craftedAt = null
  const bot = Object.assign(new EventEmitter(), {
    registry: registryFor('1.20.4'),
    entity: { position },
    inventory: { items: () => [{ name: 'crafting_table', count: 1 }] },
    pathfinder: { setMovements () {}, bestHarvestTool: () => null },
    canSeeBlock: () => true,
    blockAt (p) {
      return [wall, floor, placed].find((block) => block?.position.equals(p)) ?? { name: 'air' }
    },
    findBlock: () => null,
    recipesFor: (_id, _metadata, _count, station) => station === table ? [recipe] : [],
    equip: async () => {},
    async placeBlock (support, face) {
      assert.equal(support, wall)
      assert.ok(support.position.plus(face).equals(target))
      placed = table
    },
    async craft (_recipe, _count, station) {
      craftedAt = station
    },
    async dig () {
      placed = null
    },
    nearestEntity: () => null,
    stopDigging () {},
    clearControlStates () {}
  })
  const skills = createSkills(bot, { badPositions: new Set() })
  const result = await skills.run({ kind: 'craft', params: { item: 'iron_pickaxe' }, timeoutMs: 5000 })
  assert.deepEqual(result, { ok: true, detail: 'crafted iron_pickaxe' })
  assert.equal(craftedAt, table)
})

test('accepts a descent that lands below the target level', async () => {
  const bot = {
    registry: registryFor('1.20.4'),
    entity: { position: new Vec3(0, 20, 0) },
    pathfinder: {
      setMovements () {},
      setGoal () {},
      stop () {},
      async goto (goal) {
        assert.equal(goal.isEnd(bot.entity.position), false)
        bot.entity.position.y = 8
        assert.equal(goal.isEnd(bot.entity.position), true)
      }
    },
    stopDigging () {},
    clearControlStates () {}
  }
  const skills = createSkills(bot, { badPositions: new Set() })
  const result = await skills.run({ kind: 'dig_down', params: { targetY: 10 }, timeoutMs: 5000 })
  assert.deepEqual(result, { ok: true, detail: 'reached Y=8' })
})
