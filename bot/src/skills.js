import { setTimeout as sleep } from 'node:timers/promises'
import pathfinderPkg from 'mineflayer-pathfinder'
import vec3 from 'vec3'
import { DIRECTIONS } from './candidates.js'
import { FUEL_SMELTS, ORE_DROPS, isLog, isPlanks, isStoneBlock, plankNameForLog } from './items.js'
import { positionKey } from './perception.js'

const { goals, Movements } = pathfinderPkg
const { Vec3 } = vec3

const WEAPONS = [
  'netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword',
  'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe'
]
const PLACEMENT_FACES = [
  new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, -1, 0)
]

export class SkillError extends Error {}

class GoalAtOrBelowY extends goals.GoalY {
  heuristic (node) {
    return Math.max(0, node.y - this.y)
  }

  isEnd (node) {
    return node.y <= this.y
  }
}

export function createSkills (bot, { badPositions }) {
  const registry = bot.registry
  const movements = new Movements(bot)
  movements.canDig = true
  movements.allowParkour = false
  movements.scafoldingBlocks = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack']
    .map((name) => registry.itemsByName[name]?.id)
    .filter((id) => id !== undefined)
  const ores = Object.keys(ORE_DROPS).filter((name) => !isStoneBlock(name))
  for (const name of ['crafting_table', 'furnace', 'chest', ...ores]) {
    const block = registry.blocksByName[name]
    if (block) movements.blocksCantBreak.add(block.id)
  }
  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = 10_000

  const inventoryItem = (predicate) => bot.inventory.items().find((item) => predicate(item.name))
  const here = () => bot.entity.position

  async function moveTo (goal) {
    await bot.pathfinder.goto(goal)
    if (!goal.isEnd(here().floored())) throw new SkillError('path ended before reaching the destination')
  }

  async function equipFor (block) {
    const tool = bot.pathfinder.bestHarvestTool(block)
    if (tool) await bot.equip(tool, 'hand')
  }

  async function collectDrops (radius, timeoutMs, signal) {
    const deadline = Date.now() + timeoutMs
    const tried = new Set()
    let collected = 0
    const onCollect = (collector) => { if (collector === bot.entity) collected++ }
    bot.on('playerCollect', onCollect)
    try {
      // Give freshly mined items time to land and become eligible for pickup.
      await sleep(600, undefined, { signal })
      while (Date.now() < deadline) {
        signal.throwIfAborted()
        const drop = bot.nearestEntity((e) => e.name === 'item' && !tried.has(e.id) && e.position.distanceTo(here()) <= radius)
        if (!drop) break
        tried.add(drop.id)
        const p = drop.position
        try {
          await moveTo(new goals.GoalBlock(p.x, p.y, p.z))
          await sleep(300, undefined, { signal })
        } catch {
          signal.throwIfAborted()
          bot.pathfinder.setGoal(null)
        }
      }
      return collected
    } finally {
      bot.off('playerCollect', onCollect)
    }
  }

  function placementSpots () {
    const base = here().floored()
    const spots = []
    for (const dy of [0, 1, -1]) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const target = base.offset(dx, dy, dz)
          // Keep the new block clear of the bot's own hitbox (half-width 0.3).
          const gap = Math.max(Math.abs(target.x + 0.5 - here().x), Math.abs(target.z + 0.5 - here().z))
          if (gap < 0.85) continue
          const block = bot.blockAt(target)
          if (!block || !['air', 'cave_air'].includes(block.name)) continue
          for (const face of PLACEMENT_FACES) {
            const support = bot.blockAt(target.minus(face))
            if (support?.boundingBox !== 'block' || !bot.canSeeBlock(support)) continue
            spots.push({ target, support, face, distance: target.offset(0.5, 0, 0.5).distanceTo(here()) + Math.abs(dy) })
          }
        }
      }
    }
    return spots.sort((a, b) => a.distance - b.distance)
  }

  async function placeFromInventory (name, signal) {
    const item = inventoryItem((n) => n === name)
    if (!item) throw new SkillError(`no ${name} in inventory`)
    for (const spot of placementSpots().slice(0, 8)) {
      signal.throwIfAborted()
      try {
        await bot.equip(item, 'hand')
        signal.throwIfAborted()
        await bot.placeBlock(spot.support, spot.face)
      } catch {
        signal.throwIfAborted()
        continue
      }
      const placed = bot.blockAt(spot.target)
      if (placed?.name === name) return placed
    }
    throw new SkillError(`no free spot to place ${name}`)
  }

  async function pickUp (block, signal) {
    signal.throwIfAborted()
    const current = bot.blockAt(block.position)
    if (!current || current.name !== block.name) return
    await equipFor(current)
    await bot.dig(current, true)
    await collectDrops(5, 5000, signal)
  }

  async function ensureStation (name, signal) {
    const ids = [registry.blocksByName[name].id]
    let block = bot.findBlock({ matching: ids, maxDistance: 16 })
    let placed = false
    if (!block) {
      block = await placeFromInventory(name, signal)
      placed = true
    }
    if (here().distanceTo(block.position.offset(0.5, 0.5, 0.5)) > 3.5) {
      const p = block.position
      await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2))
    }
    if (signal?.aborted) throw new SkillError('aborted')
    return { block, placed }
  }

  async function craftPlanks () {
    const log = inventoryItem(isLog)
    if (!log) throw new SkillError('no logs to craft planks')
    const planks = registry.itemsByName[plankNameForLog(log.name)]
    const recipe = planks && bot.recipesFor(planks.id, null, 1, null)[0]
    if (!recipe) throw new SkillError(`no plank recipe for ${log.name}`)
    await bot.craft(recipe, 1, null)
    return `crafted ${planks.name}`
  }

  const skills = {
    async mine ({ name, position }, signal) {
      const pos = new Vec3(position.x, position.y, position.z)
      try {
        let block = bot.blockAt(pos)
        if (!block || block.name !== name) return `${name} is already gone`
        await bot.pathfinder.goto(new goals.GoalLookAtBlock(pos, bot.world, { reach: 4 }))
        block = bot.blockAt(pos)
        if (!block || block.name !== name) return `${name} is already gone`
        await equipFor(block)
        if (!bot.canDigBlock(block)) throw new SkillError(`cannot reach ${name}`)
        await bot.dig(block, true)
      } catch (error) {
        badPositions.add(positionKey(pos))
        throw error
      }
      await collectDrops(6, 8000, signal)
      return `mined ${name}`
    },

    async craft ({ item }, signal) {
      if (item === 'planks') return craftPlanks()
      const id = registry.itemsByName[item].id
      const handRecipe = bot.recipesFor(id, null, 1, null)[0]
      if (handRecipe) {
        await bot.craft(handRecipe, 1, null)
        return `crafted ${item}`
      }
      const { block, placed } = await ensureStation('crafting_table', signal)
      try {
        const recipe = bot.recipesFor(id, null, 1, block)[0]
        if (!recipe) throw new SkillError(`missing ingredients for ${item}`)
        await bot.craft(recipe, 1, block)
      } finally {
        if (placed) await pickUp(block, signal)
      }
      return `crafted ${item}`
    },

    async smelt ({ count }, signal) {
      const rawId = registry.itemsByName.raw_iron.id
      const ingotId = registry.itemsByName.iron_ingot.id
      const startIngots = bot.inventory.count(ingotId)
      const { block, placed } = await ensureStation('furnace', signal)
      const furnace = await bot.openFurnace(block)
      try {
        if (furnace.outputItem()) await furnace.takeOutput()
        const raw = Math.min(count, bot.inventory.count(rawId))
        if (raw > 0) await furnace.putInput(rawId, null, raw)
        const deadline = Date.now() + raw * 10_000 + 20_000
        while (Date.now() < deadline) {
          if (!furnace.fuelItem() && furnace.inputItem() && (furnace.fuel ?? 0) <= 0.01) await addFuel(furnace)
          if (furnace.outputItem()) await furnace.takeOutput()
          if (!furnace.inputItem() && !furnace.outputItem()) break
          await sleep(1000, undefined, { signal })
        }
      } finally {
        furnace.close()
        if (placed) await pickUp(block, signal)
      }
      const made = bot.inventory.count(ingotId) - startIngots
      if (made <= 0) throw new SkillError('the furnace made no iron ingots')
      return `smelted ${made} iron ingot(s)`
    },

    async dig_down ({ targetY }) {
      await moveTo(new GoalAtOrBelowY(targetY))
      return `reached Y=${Math.floor(here().y)}`
    },

    async tunnel ({ dir, length }) {
      const [dx, dz] = DIRECTIONS[dir]
      const start = here().floored()
      await moveTo(new goals.GoalBlock(start.x + dx * length, start.y, start.z + dz * length))
      return `tunneled ${length} blocks ${dir}`
    },

    async explore ({ dir, distance }) {
      const [dx, dz] = DIRECTIONS[dir]
      const start = here()
      await moveTo(new goals.GoalNearXZ(start.x + dx * distance, start.z + dz * distance, 4))
      return `walked ${distance} blocks ${dir}`
    },

    async attack ({ entityId, collect }, signal) {
      const deadline = Date.now() + 18_000
      let target = bot.entities[entityId]
      if (!target) return 'the target is gone'
      const name = target.name
      try {
        while (Date.now() < deadline) {
          target = bot.entities[entityId]
          if (!target || !target.isValid) break
          const distance = here().distanceTo(target.position)
          if (distance > 20) return `the ${name} got away`
          if (distance > 3) {
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
            await sleep(250, undefined, { signal })
            continue
          }
          bot.pathfinder.setGoal(null)
          const weapon = WEAPONS.map((w) => inventoryItem((n) => n === w)).find(Boolean)
          if (weapon && bot.heldItem?.name !== weapon.name) await bot.equip(weapon, 'hand')
          await bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true)
          bot.attack(target)
          await sleep(650, undefined, { signal })
        }
      } finally {
        bot.pathfinder.setGoal(null)
      }
      if (bot.entities[entityId]?.isValid) return `still fighting the ${name}`
      if (collect) await collectDrops(8, 8000, signal)
      return `killed the ${name}`
    },

    async flee (_params, signal) {
      const threat = bot.nearestEntity((e) => e.type === 'hostile')
      if (!threat) return 'no threat nearby'
      bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(threat, 20)), true)
      try {
        await sleep(6000, undefined, { signal })
      } finally {
        bot.pathfinder.setGoal(null)
      }
      return `fled from the ${threat.name}`
    },

    async eat ({ item }) {
      const food = inventoryItem((n) => n === item)
      if (!food) throw new SkillError(`no ${item} to eat`)
      await bot.equip(food, 'hand')
      await bot.consume()
      return `ate ${item}`
    },

    async rest ({ seconds }, signal) {
      await sleep(seconds * 1000, undefined, { signal })
      return `rested ${seconds}s`
    },

    async collect_drops (_params, signal) {
      const collected = await collectDrops(8, 15_000, signal)
      if (collected === 0) throw new SkillError('no nearby drops picked up')
      return `picked up ${collected} dropped item stack(s)`
    }
  }

  async function addFuel (furnace) {
    const needed = Math.max(1, (furnace.inputItem()?.count ?? 1))
    const fuel = inventoryItem((n) => FUEL_SMELTS[n]) ?? inventoryItem(isPlanks) ?? inventoryItem(isLog)
    if (!fuel) throw new SkillError('no fuel for the furnace')
    const perItem = FUEL_SMELTS[fuel.name] ?? 1.5
    await furnace.putFuel(fuel.type, null, Math.min(fuel.count, Math.ceil(needed / perItem)))
  }

  function stopEverything () {
    bot.pathfinder.stop()
    bot.pathfinder.setGoal(null)
    bot.stopDigging()
    bot.clearControlStates()
  }

  async function run (candidate) {
    const skill = skills[candidate.kind]
    if (!skill) return { ok: false, detail: `unknown action kind ${candidate.kind}` }
    const controller = new AbortController()
    const onDeath = () => controller.abort(new SkillError('died during the action'))
    bot.once('death', onDeath)
    const task = skill(candidate.params, controller.signal)
    const timeout = sleep(candidate.timeoutMs, undefined, { signal: controller.signal }).then(() => {
      throw new SkillError(`timed out after ${candidate.timeoutMs / 1000}s`)
    })
    try {
      return { ok: true, detail: await Promise.race([task, timeout]) }
    } catch (error) {
      const failure = controller.signal.reason ?? error
      controller.abort()
      stopEverything()
      const grace = new AbortController()
      try {
        const settled = await Promise.race([
          task.then(() => true, () => true),
          sleep(6000, false, { signal: grace.signal })
        ])
        if (!settled) throw new SkillError(`${candidate.kind} did not stop after cancellation`, { cause: failure })
      } finally {
        grace.abort()
      }
      return { ok: false, detail: failure.message }
    } finally {
      controller.abort()
      bot.off('death', onDeath)
    }
  }

  return { run }
}
