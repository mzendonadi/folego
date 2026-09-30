import type { Config } from '../config.ts';
import { AnthropicGenerator } from './ai.ts';
import type { ScriptGenerator } from './ai.ts';
import { AnthropicIncomeGenerator } from './income-ai.ts';
import type { IncomePlanGenerator } from './income-ai.ts';
import type { WorkerOptions } from './worker.ts';

export function createGenerator(config: Config): ScriptGenerator | null {
  return config.anthropicApiKey ? new AnthropicGenerator({ apiKey: config.anthropicApiKey, model: config.aiModel, workspaceId: config.anthropicWorkspaceId }) : null;
}

export function createIncomeGenerator(config: Config): IncomePlanGenerator | null {
  return config.anthropicApiKey ? new AnthropicIncomeGenerator({ apiKey: config.anthropicApiKey, model: config.aiModel, workspaceId: config.anthropicWorkspaceId }) : null;
}

export function workerOptions(config: Config, log: (event: Record<string, unknown>) => void): WorkerOptions {
  return { generator: createGenerator(config), incomeGenerator: createIncomeGenerator(config), maxAiCallsPerDay: config.aiMaxCallsPerDay, log };
}
