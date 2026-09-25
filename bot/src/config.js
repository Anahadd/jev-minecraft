const PROVIDERS = {
  typesafe: {
    url: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    keyVar: 'TYPESAFE_API_KEY',
    stateAsString: false
  },
  openrouter: {
    url: 'https://openrouter.ai/api/alpha/decisions',
    model: 'typesafe/jev-1.13',
    keyVar: 'OPENROUTER_API_KEY',
    stateAsString: true
  }
}

function number (value, fallback) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (Number.isNaN(parsed)) throw new Error(`Expected a number, got "${value}"`)
  return parsed
}

export function loadConfig (env = process.env) {
  const policy = env.POLICY ?? 'jev'
  if (!['jev', 'heuristic'].includes(policy)) {
    throw new Error(`POLICY must be "jev" or "heuristic", got "${policy}"`)
  }

  const providerName = env.JEV_PROVIDER ?? 'typesafe'
  const provider = PROVIDERS[providerName]
  if (!provider) {
    throw new Error(`JEV_PROVIDER must be one of ${Object.keys(PROVIDERS).join(', ')}, got "${providerName}"`)
  }
  const apiKey = env[provider.keyVar]
  if (policy === 'jev' && !apiKey) {
    throw new Error(`POLICY=jev needs ${provider.keyVar}. Set it, or run with POLICY=heuristic.`)
  }

  return {
    mc: {
      host: env.MC_HOST ?? '127.0.0.1',
      port: number(env.MC_PORT, 25565),
      username: env.BOT_NAME ?? 'jev',
      version: env.MC_VERSION ?? '1.20.4'
    },
    policy,
    jev: {
      provider: providerName,
      url: env.JEV_URL ?? provider.url,
      model: env.JEV_MODEL ?? provider.model,
      apiKey,
      stateAsString: provider.stateAsString,
      minConfidence: number(env.JEV_MIN_CONFIDENCE, 0.2),
      timeoutMs: number(env.JEV_TIMEOUT_MS, 8000)
    },
    world: {
      diamondY: number(env.DIAMOND_Y, -58),
      ironY: number(env.IRON_Y, 16)
    },
    maxSteps: number(env.MAX_STEPS, 3000),
    viewerPort: env.VIEWER_PORT ? number(env.VIEWER_PORT) : null,
    runsDir: env.RUNS_DIR ?? './runs'
  }
}
