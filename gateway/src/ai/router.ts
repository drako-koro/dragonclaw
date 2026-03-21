/**
 * AuthorClaw AI Router
 * Hybrid Ollama + Claude routing with per-lane provider, model, and thinking selection.
 */

import { createHash } from 'crypto';
import { Vault } from '../security/vault.js';
import { CostTracker } from '../services/costs.js';

interface AIProvider {
  id: 'ollama' | 'claude';
  name: string;
  model: string;
  tier: 'free' | 'cheap' | 'paid';
  available: boolean;
  endpoint: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
}

interface CompletionRequest {
  provider: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  taskType?: string;
  think?: boolean | 'low' | 'medium' | 'high';
  reasoning?: boolean | 'low' | 'medium' | 'high' | 'on' | 'off';
  model?: string;
}

interface CompletionResponse {
  text: string;
  tokensUsed: number;
  estimatedCost: number;
  provider: string;
}

type TaskTier = 'free' | 'mid' | 'premium';
type Lane = 'planning' | 'drafting' | 'critique' | 'rewrite' | 'final';
type ProviderId = 'ollama' | 'claude';

const TASK_TIERS: Record<string, TaskTier> = {
  general: 'free',
  research: 'free',
  creative_writing: 'mid',
  revision: 'mid',
  rewrite: 'mid',
  style_analysis: 'mid',
  marketing: 'free',
  outline: 'mid',
  book_bible: 'mid',
  consistency: 'mid',
  final_edit: 'premium',
};

const TASK_LANES: Record<string, Lane> = {
  general: 'planning',
  research: 'planning',
  marketing: 'planning',
  outline: 'planning',
  book_bible: 'planning',
  creative_writing: 'drafting',
  revision: 'critique',
  style_analysis: 'critique',
  consistency: 'critique',
  rewrite: 'rewrite',
  final_edit: 'final',
};

const DEFAULT_TIER_ROUTING: Record<TaskTier, ProviderId[]> = {
  free: ['ollama', 'claude'],
  mid: ['ollama', 'claude'],
  premium: ['claude', 'ollama'],
};

export class AIRouter {
  private providers: Map<string, AIProvider> = new Map();
  private config: any;
  private vault: Vault;
  private costs: CostTracker;

  private promptCache: Map<string, { hash: string; timestamp: number }> = new Map();
  private cacheHits = 0;
  private cacheMisses = 0;
  private savedTokens = 0;

  constructor(config: any, vault: Vault, costs: CostTracker) {
    this.config = config || {};
    this.vault = vault;
    this.costs = costs;
  }

  async initialize(): Promise<void> {
    this.providers.clear();

    const ollamaEnabled = this.config.ollama?.enabled !== false;
    if (ollamaEnabled) {
      const endpoint = this.getOllamaEndpoint();
      const ollamaAvailable = await this.checkOllama(endpoint);
      if (ollamaAvailable) {
        this.providers.set('ollama', {
          id: 'ollama',
          name: 'Ollama',
          model: this.getDefaultModelForProvider('ollama'),
          tier: 'free',
          available: true,
          endpoint,
          maxTokens: this.getMaxTokensForProvider('ollama'),
          costPer1kInput: 0,
          costPer1kOutput: 0,
        });
      }
    }

    const claudeEnabled = this.config.claude?.enabled === true;
    if (claudeEnabled) {
      const apiKey = await this.vault.get('anthropic_api_key');
      if (apiKey) {
        this.providers.set('claude', {
          id: 'claude',
          name: 'Claude',
          model: this.getDefaultModelForProvider('claude'),
          tier: 'paid',
          available: true,
          endpoint: this.getClaudeBaseUrl(),
          maxTokens: this.getMaxTokensForProvider('claude'),
          costPer1kInput: Number(this.config.claude?.costPer1kInput || 0),
          costPer1kOutput: Number(this.config.claude?.costPer1kOutput || 0),
        });
      }
    }

    if (this.providers.size === 0) {
      throw new Error('No AI providers available. Start Ollama and/or enable Claude with an Anthropic API key.');
    }
  }

  async reinitialize(): Promise<string[]> {
    await this.initialize();
    return this.getActiveProviders().map(p => p.id);
  }

  private getLaneForTask(taskType?: string): Lane {
    if (!taskType) return 'planning';
    return TASK_LANES[taskType] || 'planning';
  }

  private getTierForTask(taskType?: string): TaskTier {
    if (!taskType) return 'free';
    return TASK_TIERS[taskType] || 'free';
  }

  private getPreferredProviderForLane(lane: Lane): ProviderId {
    const laneProvider = this.config.providers?.[lane];
    if (laneProvider === 'claude') return 'claude';
    return 'ollama';
  }

  private getDefaultProviderId(): ProviderId {
    return this.config.defaultProvider === 'claude' ? 'claude' : 'ollama';
  }

  private getProviderPreference(taskType?: string, preferredId?: string): ProviderId[] {
    const lane = this.getLaneForTask(taskType);
    const tier = this.getTierForTask(taskType);
    const ordered: ProviderId[] = [];
    const push = (id?: string) => {
      if ((id === 'ollama' || id === 'claude') && !ordered.includes(id)) ordered.push(id);
    };

    push(preferredId);
    push(this.getPreferredProviderForLane(lane));
    push(this.getDefaultProviderId());
    DEFAULT_TIER_ROUTING[tier].forEach(push);
    ['ollama', 'claude'].forEach(push);
    return ordered;
  }

  private getOllamaEndpoint(): string {
    return this.config.ollama?.endpoint || 'http://localhost:11434';
  }

  private getClaudeBaseUrl(): string {
    const raw = this.config.claude?.baseUrl || 'https://api.anthropic.com/v1';
    return String(raw).replace(/\/$/, '');
  }

  private getDefaultModelForProvider(providerId: ProviderId): string {
    if (providerId === 'claude') {
      return this.config.claude?.defaultModel || 'claude-sonnet-4-6';
    }
    return this.config.ollama?.defaultModel || this.config.ollama?.model || 'qwen3.5:35b';
  }

  private getMaxTokensForProvider(providerId: ProviderId): number {
    if (providerId === 'claude') return Number(this.config.claude?.maxTokens || 4096);
    return Number(this.config.ollama?.maxTokens || 4096);
  }

  private getModelForRequest(providerId: ProviderId, taskType?: string, overrideModel?: string): string {
    if (overrideModel) return overrideModel;
    const lane = this.getLaneForTask(taskType);
    if (providerId === 'claude') {
      return this.config.claude?.models?.[lane] || this.config.claude?.[`${lane}Model`] || this.getDefaultModelForProvider('claude');
    }
    return this.config.ollama?.models?.[lane] || this.config.ollama?.[`${lane}Model`] || this.getDefaultModelForProvider('ollama');
  }

  private getOllamaThinkValue(taskType?: string, overrideThink?: boolean | 'low' | 'medium' | 'high', overrideReasoning?: boolean | 'low' | 'medium' | 'high' | 'on' | 'off'): boolean | 'low' | 'medium' | 'high' {
    const lane = this.getLaneForTask(taskType);
    const model = this.getModelForRequest('ollama', taskType);
    const isGptOss = /^gpt-oss/i.test(String(model));

    const normalize = (value: any): boolean | 'low' | 'medium' | 'high' | undefined => {
      if (value === 'off') return false;
      if (value === 'on') return isGptOss ? 'medium' : true;
      if (value === true) return isGptOss ? 'medium' : true;
      if (value === false) return false;
      if (value === 'low' || value === 'medium' || value === 'high') return isGptOss ? value : true;
      return undefined;
    };

    const override = normalize(overrideReasoning);
    if (typeof override !== 'undefined') return override;

    const direct = normalize(overrideThink);
    if (typeof direct !== 'undefined') return direct;

    const configuredReasoning = normalize(this.config.ollama?.reasoning?.[lane]);
    if (typeof configuredReasoning !== 'undefined') return configuredReasoning;

    const configuredThinking = normalize(this.config.ollama?.thinking?.[lane]);
    if (typeof configuredThinking !== 'undefined') return configuredThinking;

    return false;
  }

  private getClaudeThinking(taskType?: string, overrideThink?: boolean, maxTokens?: number): any | undefined {
    const lane = this.getLaneForTask(taskType);
    const enabled = typeof overrideThink === 'boolean' ? overrideThink : Boolean(this.config.claude?.thinking?.[lane]);
    if (!enabled) return undefined;

    const model = this.getModelForRequest('claude', taskType);
    if (String(model).startsWith('claude-opus-4-6')) {
      return {
        type: 'adaptive',
        effort: this.config.claude?.thinkingEffort?.[lane] || 'medium',
      };
    }

    const budget = Number(this.config.claude?.thinkingBudgetTokens?.[lane] || 2048);
    const max = Number(maxTokens || this.getMaxTokensForProvider('claude'));
    return {
      type: 'enabled',
      budget_tokens: Math.max(1024, Math.min(budget, Math.max(1024, max - 256))),
    };
  }

  private async checkOllama(endpoint: string): Promise<boolean> {
    try {
      const timeoutMs = this.config.ollama?.requestTimeoutMs || 5000;
      const response = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  selectProvider(taskType: string, preferredId?: string): AIProvider {
    for (const providerId of this.getProviderPreference(taskType, preferredId)) {
      const provider = this.providers.get(providerId);
      if (provider?.available) return provider;
    }
    throw new Error('No AI providers available for this request.');
  }

  getFallbackProvider(currentId: string): AIProvider | null {
    const candidates: ProviderId[] = currentId === 'claude' ? ['ollama'] : ['claude'];
    for (const providerId of candidates) {
      const provider = this.providers.get(providerId);
      if (provider?.available) return provider;
    }
    return null;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const requested = request.provider === 'claude' ? 'claude' : 'ollama';
    const provider = this.providers.get(requested) || this.selectProvider(request.taskType || 'general', request.provider);

    const promptHash = this.hashPrompt(request.system);
    const cacheKey = `${provider.id}:system`;
    const cached = this.promptCache.get(cacheKey);

    if (cached && cached.hash === promptHash) {
      this.cacheHits++;
      this.savedTokens += Math.ceil(request.system.length / 4);
    } else {
      this.cacheMisses++;
      this.promptCache.set(cacheKey, { hash: promptHash, timestamp: Date.now() });
    }

    switch (provider.id) {
      case 'ollama':
        return this.completeOllama(provider, request);
      case 'claude':
        return this.completeClaude(provider, request);
      default:
        throw new Error(`Unknown provider: ${provider.id}`);
    }
  }

  getCacheStats(): { hits: number; misses: number; savedTokens: number } {
    return { hits: this.cacheHits, misses: this.cacheMisses, savedTokens: this.savedTokens };
  }

  private hashPrompt(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex');
  }

  private async completeOllama(provider: AIProvider, request: CompletionRequest): Promise<CompletionResponse> {
    const model = this.getModelForRequest('ollama', request.taskType, request.model);
    const think = this.getOllamaThinkValue(request.taskType, request.think, request.reasoning);
    const timeoutMs = this.config.ollama?.requestTimeoutMs || 600000;

    const response = await fetch(`${provider.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        stream: false,
        think,
        options: {
          temperature: request.temperature ?? this.config.defaultTemperature ?? 0.7,
          num_predict: request.maxTokens ?? provider.maxTokens,
        },
      }),
    });

    const data = await response.json() as any;
    if (!response.ok || data.error) {
      throw new Error(data?.error || `Ollama API error (${response.status})`);
    }

    return {
      text: data.message?.content || '',
      tokensUsed: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      estimatedCost: 0,
      provider: 'ollama',
    };
  }

  private async completeClaude(provider: AIProvider, request: CompletionRequest): Promise<CompletionResponse> {
    const apiKey = await this.vault.get('anthropic_api_key');
    if (!apiKey) throw new Error('No anthropic_api_key stored in vault');

    const model = this.getModelForRequest('claude', request.taskType, request.model);
    const maxTokens = request.maxTokens ?? provider.maxTokens;
    const thinking = this.getClaudeThinking(request.taskType, request.think, maxTokens);
    const timeoutMs = this.config.claude?.requestTimeoutMs || 600000;

    const body: any = {
      model,
      max_tokens: maxTokens,
      system: request.system,
      messages: request.messages,
    };
    if (typeof request.temperature === 'number') body.temperature = request.temperature;
    else if (typeof this.config.defaultTemperature === 'number') body.temperature = this.config.defaultTemperature;
    if (thinking) body.thinking = thinking;

    const response = await fetch(`${provider.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (!response.ok || data.error) {
      throw new Error(data?.error?.message || data?.error || `Claude API error (${response.status})`);
    }

    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '').join('\n').trim();
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;

    return {
      text,
      tokensUsed: inputTokens + outputTokens,
      estimatedCost: (inputTokens / 1000) * provider.costPer1kInput + (outputTokens / 1000) * provider.costPer1kOutput,
      provider: 'claude',
    };
  }

  getActiveProviders(): AIProvider[] {
    return Array.from(this.providers.values()).filter(p => p.available);
  }
}
