import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import registryFor from 'prismarine-registry'
import vec3 from 'vec3'
import { runAgent } from '../src/agent.js'
import { createPolicy } from '../src/policy.js'
import { WORLD } from './fixtures.js'

const { Vec3 } = vec3
const registry = registryFor('1.20.4')

function dropFixture ({ pickup = true } = {}) {
  const bot = new EventEmitter()
  const items = [{ name: 'iron_pickaxe', count: 1 }]
  const drop = { id: 1, name: 'item', position: new Vec3(1.5, -58, 0.5) }
  Object.assign(bot, {
    registry,
    entity: { position: new Vec3(0.5, -58, 0.5), eyeHeight: 1.62 },
    entities: { [drop.id]: drop },
    health: 20,
    food: 20,
    time: { timeOfDay: 0 },
    inventory: { items: () => items },
    findBlock: () => null,
    findBlocks: () => [],
    blockAt: () => null,
    recipesFor: () => [],
    nearestEntity: (predicate) => Object.values(bot.entities).find(predicate),
    stopDigging: () => {},
    clearControlStates: () => {},
    pathfinder: {
      setMovements () {},
      setGoal () {},
      stop () {},
      async goto (goal) {
        if (goal.isEnd(bot.entity.position.floored())) return
        assert.ok(goal.isEnd(drop.position.floored()))
        bot.entity.position = drop.position.clone()
        if (pickup) {
          items.push({ name: 'diamond', count: 1 })
          delete bot.entities[drop.id]
          bot.emit('playerCollect', bot.entity, drop)
        }
      }
    }
  })
  return bot
}

async function runOneStep (bot) {
  const events = []
  const result = await runAgent({
    bot,
    config: { maxSteps: 1, world: WORLD },
    policy: createPolicy({ mode: 'heuristic' }),
    runlog: { event: (type, data) => events.push({ type, ...data }) }
  })
  return { result, steps: events.filter((event) => event.type === 'step') }
}

test('walks into the item pickup range and counts a diamond collected on the final step', async () => {
  const { result, steps } = await runOneStep(dropFixture())
  assert.equal(result.success, true)
  assert.equal(result.stats.steps, 1)
  assert.equal(steps.length, 1)
  assert.equal(steps[0].choice, 'collect_drops')
  assert.equal(steps[0].ok, true)
})

test('reports a failed collection when the server never awards the item', async () => {
  const bot = dropFixture({ pickup: false })
  const { result, steps } = await runOneStep(bot)
  assert.equal(result.success, false)
  assert.equal(result.reason, 'stopped after 1 steps')
  assert.equal(steps[0].ok, false)
  assert.match(steps[0].detail, /no nearby drops picked up/)
  assert.equal(bot.listenerCount('playerCollect'), 0)
})
