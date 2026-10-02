// The models behind the Traders and the Market Columnist. One AI SDK provider
// per company, called directly with the key from the server's environment.
import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'

/** @typedef {import('bun:sqlite').Database} Database */
/** @typedef {import('ai').LanguageModel} LanguageModel */

/**
 * @typedef {object} ModelRow
 * @property {number} id
 * @property {string} provider anthropic, openai, google, deepseek
 * @property {string} model_version
 * @property {string} effort low, medium, high, or 'default' (the provider's own setting)
 * @property {number} input_micro_per_mtok
 * @property {number} cached_input_micro_per_mtok
 * @property {number} output_micro_per_mtok
 */

/** The environment variable holding each provider's API key. */
export const KEY_NAMES = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
}

const PROVIDER_NAMES = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', deepseek: 'DeepSeek' }

/** @param {number} dollars per million tokens */
const perMillion = (dollars) => Math.round(dollars * 1_000_000)

/**
 * The Balanced line-up (PRD, chosen 1 October 2026), at medium effort (DeepSeek: high),
 * plus the Columnist's two models. Prices are per million tokens from the PRD;
 * cached-input prices are each provider's published discount on repeated input.
 * Model versions are checked against the providers with `bun run models:check`;
 * prices were checked on the providers' own pricing pages on 1 October 2026.
 */
export const LINE_UP = {
  traders: [
    { name: 'Claude', colourSlot: 1, provider: 'anthropic', model_version: 'claude-sonnet-5-5', effort: 'medium', input: 2, cached: 0.2, output: 10 },
    { name: 'GPT', colourSlot: 2, provider: 'openai', model_version: 'gpt-6.1-sol', effort: 'medium', input: 1, cached: 0.05, output: 5 },
    // Priced at its 1 January 2027 rate, as the paper phase runs into 2027.
    { name: 'Gemini', colourSlot: 3, provider: 'google', model_version: 'gemini-3.8-flash', effort: 'medium', input: 1.5, cached: 0.15, output: 7.5 },
    // Off-peak rate: runs happen after the US close. DeepSeek has no medium
    // effort (the AI SDK maps it to high), so the record says high.
    { name: 'DeepSeek', colourSlot: 4, provider: 'deepseek', model_version: 'deepseek-v4-pro', effort: 'high', input: 0.66, cached: 0.022, output: 1.98 },
  ],
  columnist: {
    daily: { provider: 'anthropic', model_version: 'claude-haiku-4-5', effort: 'default', input: 1, cached: 0.1, output: 5 },
    weekly: { provider: 'anthropic', model_version: 'claude-sonnet-5-5', effort: 'medium', input: 2, cached: 0.2, output: 10 },
  },
}

/**
 * The id of a model row, adding it the first time.
 * @param {Database} db
 * @param {{ provider: string, model_version: string, effort: string, input: number, cached: number, output: number }} m
 * @param {Date} now
 * @returns {number}
 */
export function ensureModel(db, m, now) {
  db.run(`INSERT OR IGNORE INTO models (provider, model_version, effort, input_micro_per_mtok, cached_input_micro_per_mtok, output_micro_per_mtok, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [m.provider, m.model_version, m.effort, perMillion(m.input), perMillion(m.cached), perMillion(m.output), now.toISOString()])
  return /** @type {{ id: number }} */ (db.query('SELECT id FROM models WHERE provider = ? AND model_version = ? AND effort = ?').get(m.provider, m.model_version, m.effort)).id
}

/**
 * @param {Database} db
 * @param {number} id
 * @returns {ModelRow}
 */
export function modelRow(db, id) {
  return /** @type {ModelRow} */ (db.query('SELECT * FROM models WHERE id = ?').get(id))
}

/**
 * The AI SDK model for a row. Keys come from the server's environment only.
 * @param {ModelRow} model
 * @param {Record<string, string | undefined>} [env]
 * @returns {LanguageModel}
 */
export function languageModel(model, env = process.env) {
  const keyName = KEY_NAMES[/** @type {keyof typeof KEY_NAMES} */ (model.provider)]
  if (!keyName) throw new Error(`Market Jury doesn't know the model provider "${model.provider}".`)
  const apiKey = env[keyName]
  if (!apiKey) throw new Error(`The ${PROVIDER_NAMES[/** @type {keyof typeof PROVIDER_NAMES} */ (model.provider)]} API key is missing. Add ${keyName} to the server's environment file.`)
  switch (model.provider) {
    case 'anthropic': return createAnthropic({ apiKey })(model.model_version)
    case 'openai': return createOpenAI({ apiKey })(model.model_version)
    case 'google': return createGoogleGenerativeAI({ apiKey })(model.model_version)
    default: return createDeepSeek({ apiKey })(model.model_version)
  }
}

/**
 * The portable reasoning setting for a model's effort ('default' leaves the provider's own).
 * @param {ModelRow} model
 * @returns {'provider-default' | 'low' | 'medium' | 'high'}
 */
export const reasoningFor = (model) => (/** @type {any} */ (['low', 'medium', 'high']).includes(model.effort) ? /** @type {'low' | 'medium' | 'high'} */ (model.effort) : 'provider-default')

/** Anthropic charges a quarter more than normal input for writing to its prompt cache (5-minute cache). */
const CACHE_WRITE_PREMIUM = { anthropic: 1.25 }

/**
 * What a call cost, from its token counts and the model's prices.
 * @param {ModelRow} model
 * @param {{ input: number, cached: number, written?: number, output: number }} tokens input includes the cached (read) and written tokens
 * @returns {number} micro-dollars
 */
export function costOf(model, { input, cached, written = 0, output }) {
  const premium = /** @type {Record<string, number>} */ (CACHE_WRITE_PREMIUM)[model.provider] ?? 1
  const micro = (input - cached - written) * model.input_micro_per_mtok + written * model.input_micro_per_mtok * premium
    + cached * model.cached_input_micro_per_mtok + output * model.output_micro_per_mtok
  return Math.round(micro / 1_000_000)
}

/**
 * Give the Columnist its default models the first time (Settings can swap them later).
 * @param {Database} db
 * @param {Date} now
 */
export function ensureColumnistModels(db, now) {
  const daily = ensureModel(db, LINE_UP.columnist.daily, now)
  const weekly = ensureModel(db, LINE_UP.columnist.weekly, now)
  db.run(`UPDATE settings SET columnist_daily_model_id = COALESCE(columnist_daily_model_id, ?),
          columnist_weekly_model_id = COALESCE(columnist_weekly_model_id, ?) WHERE id = 1`, [daily, weekly])
}
