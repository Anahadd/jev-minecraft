import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseObjective } from '../src/objectives.js'
import { WORLD, snapshot } from './fixtures.js'

const objectiveFor = (inventory, y = 70) => chooseObjective(snapshot({ inventory, position: { x: 0, y, z: 0 } }), WORLD).id

test('walks the tech tree from nothing to a diamond', () => {
  assert.equal(objectiveFor({}), 'make_wooden_pickaxe')
  assert.equal(objectiveFor({ oak_log: 9 }), 'make_wooden_pickaxe')
  assert.equal(objectiveFor({ wooden_pickaxe: 1 }), 'make_stone_pickaxe')
  assert.equal(objectiveFor({ stone_pickaxe: 1 }), 'find_iron')
  assert.equal(objectiveFor({ stone_pickaxe: 1, raw_iron: 2, iron_ingot: 1 }), 'smelt_iron')
  assert.equal(objectiveFor({ stone_pickaxe: 1, iron_ingot: 3 }), 'craft_iron_pickaxe')
  assert.equal(objectiveFor({ iron_pickaxe: 1 }, 12), 'reach_diamond_level')
  assert.equal(objectiveFor({ iron_pickaxe: 1 }, -57), 'find_diamond')
  assert.equal(objectiveFor({ iron_pickaxe: 1, diamond: 1 }, -57), 'done')
})

test('uses the best pickaxe when the bot carries several', () => {
  assert.equal(objectiveFor({ wooden_pickaxe: 1, stone_pickaxe: 1 }), 'find_iron')
})

test('sets a target height for the digging objectives', () => {
  const find = chooseObjective(snapshot({ inventory: { stone_pickaxe: 1 } }), WORLD)
  assert.equal(find.targetY, WORLD.ironY)
  const reach = chooseObjective(snapshot({ inventory: { iron_pickaxe: 1 }, position: { x: 0, y: 30, z: 0 } }), WORLD)
  assert.equal(reach.targetY, WORLD.diamondY)
})
