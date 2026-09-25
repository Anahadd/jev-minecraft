import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCandidates, createMemory } from '../src/candidates.js'
import { pickHeuristic } from '../src/heuristic.js'
import { JevError } from '../src/jev.js'
import { chooseObjective } from '../src/objectives.js'
import { createPolicy, toJevState } from '../src/policy.js'
import { WORLD, snapshot, visible } from './fixtures.js'

function setup (overrides) {
  const snap = snapshot(overrides)
  const objective = chooseObjective(snap, WORLD)
  const memory = createMemory()
  const candidates = buildCandidates(snap, objective, memory)
  return { snapshot: snap, objective, memory, candidates }
}

const pick = (ctx) => pickHeuristic(ctx.candidates, ctx.snapshot, ctx.objective, ctx.memory).key

test('heuristic gathers wood before crafting', () => {
  assert.equal(pick(setup({ inventory: { oak_log: 1 }, visible: [visible('oak_log')] })), 'mine_oak_log')
})

test('heuristic crafts the wooden pickaxe chain once it has enough wood', () => {
  const ctx = setup({ inventory: { oak_log: 5 }, visible: [visible('oak_log')] })
  assert.equal(pick(ctx), 'craft_planks')
})

test('heuristic mines diamond ore as soon as it is visible', () => {
  const ctx = setup({
    inventory: { iron_pickaxe: 1 },
    underground: true,
    position: { x: 0, y: -58, z: 0 },
    visible: [visible('deepslate'), visible('deepslate_diamond_ore', 6)]
  })
  assert.equal(pick(ctx), 'mine_deepslate_diamond_ore')
})

test('heuristic flees at low health and fights at high health', () => {
  const mobs = [{ id: 3, name: 'zombie', kind: 'hostile', distance: 3 }]
  assert.equal(pick(setup({ mobs, health: 6 })), 'flee')
  assert.equal(pick(setup({ mobs, health: 20 })), 'attack_zombie')
})

test('jev state carries the objective, inventory, and rules', () => {
  const ctx = setup({ inventory: { oak_log: 2 }, visible: [visible('oak_log', 3.14159)] })
  const state = toJevState(ctx.snapshot, ctx.objective, ctx.memory)
  assert.match(state.current_objective, /wooden pickaxe/)
  assert.deepEqual(state.inventory, { oak_log: 2 })
  assert.deepEqual(state.visible_blocks, [{ block: 'oak_log', visible: 1, nearest_blocks_away: 3.1 }])
  assert.ok(state.rules.length > 0)
})

function fakeJev (result) {
  return { choose: async ({ options }) => (typeof result === 'function' ? result(options) : result) }
}

test('policy acts on a confident Jev choice', async () => {
  const ctx = setup({ visible: [visible('oak_log')] })
  const jev = fakeJev((options) => ({ option: options.find((o) => o.key === 'explore_west'), confidence: 0.9, latencyMs: 80 }))
  const decision = await createPolicy({ mode: 'jev', jev, minConfidence: 0.2 }).decide(ctx)
  assert.equal(decision.source, 'jev')
  assert.equal(decision.candidate.key, 'explore_west')
})

test('policy falls back to the heuristic when Jev is unsure', async () => {
  const ctx = setup({ visible: [visible('oak_log')] })
  const jev = fakeJev((options) => ({ option: options.find((o) => o.key === 'explore_west'), confidence: 0.05 }))
  const decision = await createPolicy({ mode: 'jev', jev, minConfidence: 0.2 }).decide(ctx)
  assert.equal(decision.source, 'heuristic_low_confidence')
  assert.equal(decision.candidate.key, 'mine_oak_log')
  assert.equal(decision.jev.choice, 'explore_west')
})

test('policy falls back on a transient Jev error and stops on an auth error', async () => {
  const ctx = setup({ visible: [visible('oak_log')] })
  const transient = { choose: async () => { throw new JevError('overloaded', { status: 529 }) } }
  const decision = await createPolicy({ mode: 'jev', jev: transient, minConfidence: 0.2 }).decide(ctx)
  assert.equal(decision.source, 'heuristic_jev_error')

  const unauthorized = { choose: async () => { throw new JevError('bad key', { status: 401 }) } }
  await assert.rejects(createPolicy({ mode: 'jev', jev: unauthorized, minConfidence: 0.2 }).decide(ctx), /bad key/)
})
