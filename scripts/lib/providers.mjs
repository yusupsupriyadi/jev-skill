/**
 * The two ways to reach Jev. Same request and response shape, different endpoint,
 * auth key, and model slug.
 */
export const PROVIDERS = {
  typesafe: {
    id: 'typesafe',
    label: 'TypeSafe',
    apiUrl: 'https://api.typesafe.ai/v1/systemone',
    models: ['jev-latest', 'jev-1.13.0'],
    envKey: 'TYPESAFE_API_KEY',
    optionKey: 'typesafe_api_key',
    keyUrl: 'https://console.typesafe.ai/keys',
    summary: 'First-party System One API. Sign up at console.typesafe.ai.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    apiUrl: 'https://openrouter.ai/api/alpha/decisions',
    models: ['~typesafe/jev-latest', 'typesafe/jev-1.13'],
    envKey: 'OPENROUTER_API_KEY',
    optionKey: 'openrouter_api_key',
    keyUrl: 'https://openrouter.ai/settings/keys',
    summary: 'Routed through an OpenRouter key you may already have. Needs prepaid credit.',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

/** An OpenRouter key is recognisable by prefix; a TypeSafe key is not, so only the former is guessed. */
export function providerFromKey(key) {
  if (typeof key === 'string' && key.startsWith('sk-or-')) return 'openrouter';
  return null;
}
