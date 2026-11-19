import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCandidates, createMemory } from '../src/candidates.js'
import { chooseObjective } from '../src/objectives.js'
import { WORLD, snapshot, visible } from './fixtures.js'

const keysFor = (snap, memory = createMemory()) => buildCandidates(snap, chooseObjective(snap, WORLD), memory).map((c) => c.key)

test('offers visible logs and surface exploration at the start', () => {
  const keys = keysFor(snapshot({ visible: [visible('oak_log', 5, 3)] }))
  assert.ok(keys.includes('mine_oak_log'))
  assert.ok(keys.includes('explore_north'))
  assert.ok(!keys.some((k) => k.startsWith('tunnel_')))
})

test('does not offer ore the bot cannot harvest', () => {
  const ore = { ...visible('diamond_ore'), harvestable: false }
  const keys = keysFor(snapshot({ inventory: { stone_pickaxe: 1 }, visible: [ore], underground: true, position: { x: 0, y: -50, z: 0 } }))
  assert.ok(!keys.includes('mine_diamond_ore'))
})

test('offers tunnels and digging down underground with a pickaxe', () => {
  const keys = keysFor(snapshot({ inventory: { iron_pickaxe: 1 }, underground: true, position: { x: 0, y: 20, z: 0 } }))
  assert.ok(keys.includes('dig_down'))
  assert.ok(keys.includes('tunnel_east'))
  assert.ok(!keys.includes('explore_east'))
})

test('limits dig_down to ten blocks per step', () => {
  const snap = snapshot({ inventory: { iron_pickaxe: 1 }, underground: true, position: { x: 0, y: 20, z: 0 } })
  const digDown = buildCandidates(snap, chooseObjective(snap, WORLD)).find((c) => c.key === 'dig_down')
  assert.equal(digDown.params.targetY, 10)
})

test('uses shorter tunnels at diamond depth so the bot checks newly exposed ore more often', () => {
  const underground = { inventory: { iron_pickaxe: 1 }, underground: true }
  const target = (y) => {
    const snap = snapshot({ ...underground, position: { x: 0, y, z: 0 } })
    return buildCandidates(snap, chooseObjective(snap, WORLD)).find((action) => action.key === 'tunnel_east')
  }
  assert.equal(target(20).params.length, 12)
  assert.equal(target(-58).params.length, 4)
})

test('offers crafting only for items that are useful now', () => {
  const craftable = { stick: true, crafting_table: true, wooden_pickaxe: true }
  const keys = keysFor(snapshot({ inventory: { oak_planks: 8, crafting_table: 1 }, craftable }))
  assert.ok(keys.includes('craft_wooden_pickaxe'))
  assert.ok(keys.includes('craft_stick'))
  assert.ok(!keys.includes('craft_crafting_table'), 'the bot already carries a table')
})

test('offers smelting when raw iron, a furnace, and fuel are present', () => {
  const inventory = { stone_pickaxe: 1, raw_iron: 3, furnace: 1, coal: 1 }
  const keys = keysFor(snapshot({ inventory, underground: true, position: { x: 0, y: 16, z: 0 } }))
  assert.ok(keys.includes('smelt_raw_iron'))
})

test('offers fight and flight when a hostile mob is close', () => {
  const mobs = [{ id: 7, name: 'zombie', kind: 'hostile', distance: 4 }]
  const keys = keysFor(snapshot({ mobs }))
  assert.ok(keys.includes('attack_zombie'))
  assert.ok(keys.includes('flee'))
})

test('gives each duplicate action a unique key', () => {
  const mobs = [
    { id: 1, name: 'zombie', kind: 'hostile', distance: 3 },
    { id: 2, name: 'zombie', kind: 'hostile', distance: 5 }
  ]
  const keys = keysFor(snapshot({ mobs }))
  assert.ok(keys.includes('attack_zombie'))
  assert.ok(keys.includes('attack_zombie_2'))
  assert.equal(new Set(keys).size, keys.length)
})

test('hides an action while it is cooling down after a failure', () => {
  const memory = createMemory()
  memory.step = 5
  memory.blockedUntil.set('explore_north', 7)
  const keys = keysFor(snapshot(), memory)
  assert.ok(!keys.includes('explore_north'))
  assert.ok(keys.includes('explore_south'))
})
