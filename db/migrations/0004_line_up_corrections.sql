-- Corrections found while going live (1 October 2026), before any model call.
-- Cached-input prices from the providers' own pricing pages: GPT-6.1 Sol $0.05
-- and DeepSeek V4 Pro (off-peak) $0.022 per million tokens. Costs already
-- logged on runs keep the price they were charged at.
UPDATE models SET cached_input_micro_per_mtok = 50000
WHERE provider = 'openai' AND model_version = 'gpt-6.1-sol' AND cached_input_micro_per_mtok = 100000;
UPDATE models SET cached_input_micro_per_mtok = 22000
WHERE provider = 'deepseek' AND model_version = 'deepseek-v4-pro' AND cached_input_micro_per_mtok = 66000;

-- DeepSeek V4 Pro has no medium effort: the AI SDK runs it at high. Record what
-- actually runs, as long as no call has used the medium row yet.
UPDATE models SET effort = 'high'
WHERE provider = 'deepseek' AND model_version = 'deepseek-v4-pro' AND effort = 'medium'
  AND id NOT IN (SELECT model_id FROM runs)
  AND NOT EXISTS (SELECT 1 FROM models m WHERE m.provider = 'deepseek' AND m.model_version = 'deepseek-v4-pro' AND m.effort = 'high');
