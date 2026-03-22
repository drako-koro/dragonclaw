/**
 * DragonClaw AI Router
 * Smart routing across free and paid LLM providers
 * Optimized for writing tasks
 */

import { createHash } from 'crypto';
import http from 'http';
import { Vault } from '../security/vault.js';
import { CostTracker } from '../services/costs.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface AIProvider {
  id: string;
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
  model?: string;
  think?: boolean | 'low' | 'medium' | 'high';
}

interface CompletionResponse {
  text: string;
  tokensUsed: number;
  estimatedCost: number;
  provider: string;
}

// ═══════════════════════════════════════════════════════════
// Task Complexity Tiers
// ═══════════════════════════════════════════════════════════

type TaskTier = 'free' | 'mid' | 'premium';

const TASK_TIERS: Record<string, TaskTier> = {
  general:          'free',      // Basic chat, simple questions
  research:         'free',      // Web research, fact finding
  creative_writing: 'mid',       // Actual prose writing
  revision:         'mid',       // Editing and rewriting
  style_analysis:   'mid',       // Voice/style matching
  marketing:        'free',      // Blurbs, pitches
  outline:          'mid',       // Story structure
  book_bible:       'mid',       // World building
  consistency:      'mid',       // Consistency checks — same tier as book_bible
  final_edit:       'premium',   // Final polish needs best reasoning
};

// Provider preference order per tier (first available wins)
const TIER_ROUTING: Record<TaskTier, string[]> = {
  free:    ['ollama', 'claude', 'gemini', 'deepseek', 'openai'],
  mid:     ['ollama', 'claude', 'deepseek', 'openai', 'gemini'],
  premium: ['claude', 'ollama', 'openai', 'deepseek', 'gemini'],
};

// ═══════════════════════════════════════════════════════════
// AI Router
// ═══════════════════════════════════════════════════════════

export class AIRouter {
  private providers: Map<string, AIProvider> = new Map();
  private config: any;
  private vault: Vault;
  private costs: CostTracker;

  // ── Prompt Cache ──
  // Caches system prompt hashes so repeated calls with the same soul/style
  // context can signal cache hits to providers that support it (e.g. Gemini cachedContent).
  private promptCache: Map<string, { hash: string; timestamp: number }> = new Map();
  private cacheHits = 0;
  private cacheMisses = 0;
  private savedTokens = 0;

  constructor(config: any, vault: Vault, costs: CostTracker) {
    this.config = config;
    this.vault = vault;
    this.costs = costs;
  }

  async initialize(): Promise<void> {
    // Clear any stale providers (important for reinitialize)
    this.providers.clear();

    // ── Ollama (FREE - Local) ──
    if (this.config.ollama?.enabled !== false) {
      const ollamaAvailable = await this.checkOllama(
        this.config.ollama?.endpoint || 'http://localhost:11434'
      );
      if (ollamaAvailable) {
        this.providers.set('ollama', {
          id: 'ollama',
          name: 'Ollama',
          model: this.config.ollama?.defaultModel || this.config.ollama?.model || this.config.ollama?.models?.planning || 'qwen3.5:35b',
          tier: 'free',
          available: true,
          endpoint: this.config.ollama?.endpoint || 'http://localhost:11434',
          maxTokens: 98304,
          costPer1kInput: 0,
          costPer1kOutput: 0,
        });
      }
    }

    // ── Google Gemini (FREE tier) ──
    const geminiKey = await this.vault.get('gemini_api_key');
    if (geminiKey) {
      this.providers.set('gemini', {
        id: 'gemini',
        name: 'Google Gemini',
        model: this.config.gemini?.model || 'gemini-2.5-flash',
        tier: 'free',
        available: true,
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        maxTokens: 98304,
        costPer1kInput: 0, // Free tier
        costPer1kOutput: 0,
      });
    }

    // ── DeepSeek (CHEAP) ──
    const deepseekKey = await this.vault.get('deepseek_api_key');
    if (deepseekKey) {
      this.providers.set('deepseek', {
        id: 'deepseek',
        name: 'DeepSeek',
        model: this.config.deepseek?.model || 'deepseek-chat',
        tier: 'cheap',
        available: true,
        endpoint: 'https://api.deepseek.com/v1',
        maxTokens: 98304,
        costPer1kInput: 0.00014,
        costPer1kOutput: 0.00028,
      });
    }

    // ── Anthropic Claude (PAID) ──
    const claudeKey = await this.vault.get('anthropic_api_key');
    if (claudeKey && this.config.claude?.enabled !== false) {
      this.providers.set('claude', {
        id: 'claude',
        name: 'Anthropic Claude',
        model: this.config.claude?.model || 'claude-sonnet-4-5-20250929',
        tier: 'paid',
        available: true,
        endpoint: 'https://api.anthropic.com/v1',
        maxTokens: 98304,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      });
    }

    // ── OpenAI GPT (PAID) ──
    const openaiKey = await this.vault.get('openai_api_key');
    if (openaiKey) {
      this.providers.set('openai', {
        id: 'openai',
        name: 'OpenAI GPT',
        model: this.config.openai?.model || 'gpt-4o',
        tier: 'paid',
        available: true,
        endpoint: 'https://api.openai.com/v1',
        maxTokens: 98304,
        costPer1kInput: 0.0025,
        costPer1kOutput: 0.01,
      });
    }
  }

  /**
   * Re-scan the vault for API keys and rebuild the provider list.
   * Called after storing a new API key so the router picks it up
   * without requiring a server restart.
   */
  async reinitialize(): Promise<string[]> {
    await this.initialize();
    return this.getActiveProviders().map(p => p.id);
  }

  /**
   * Health-check Ollama with retries.
   * Uses a short per-attempt timeout (5 s) independent of the generation
   * timeout so a cold or slow-starting Ollama still gets a fair chance
   * without blocking startup for minutes.
   */
  private async checkOllama(endpoint: string): Promise<boolean> {
    const maxRetries = 5;
    const delayMs = 2000;
    const healthTimeoutMs = 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${endpoint}/api/tags`, {
          signal: AbortSignal.timeout(healthTimeoutMs),
        });
        if (response.ok) {
          if (attempt > 1) {
            console.log(`[router] Ollama responded on attempt ${attempt}/${maxRetries}`);
          }
          return true;
        }
        console.warn(`[router] Ollama health check returned ${response.status} (attempt ${attempt}/${maxRetries})`);
      } catch (err: any) {
        const reason = err?.cause?.code || err?.code || err?.message || 'unknown error';
        console.warn(`[router] Ollama health check failed (attempt ${attempt}/${maxRetries}): ${reason}`);
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.error(`[router] Ollama unreachable at ${endpoint} after ${maxRetries} attempts`);
    return false;
  }

  private getLaneForTaskType(taskType: string): 'planning' | 'drafting' | 'critique' | 'rewrite' | 'final' {
    const laneMap: Record<string, 'planning' | 'drafting' | 'critique' | 'rewrite' | 'final'> = {
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
    return laneMap[taskType] || 'planning';
  }

  /**
   * Select the best provider for a given task type using tiered routing.
   * If preferredId is set (per-project override), use that provider directly.
   */
  selectProvider(taskType: string, preferredId?: string): AIProvider {
    // Per-project provider override — use it if available
    if (preferredId) {
      const pref = this.providers.get(preferredId);
      if (pref?.available) {
        return pref;
      }
      console.warn(`[router] Preferred provider '${preferredId}' not available, falling back to configured routing`);
    }

    const lane = this.getLaneForTaskType(taskType);
    const configuredProviderId =
      this.config.providers?.[lane] ||
      this.config.defaultProvider;

    if (configuredProviderId) {
      const configured = this.providers.get(configuredProviderId);
      if (configured?.available) {
        if (configured.tier === 'free' || !this.costs.isOverBudget()) {
          return configured;
        }
      }
    }

    const tier = TASK_TIERS[taskType] || TASK_TIERS.general;
    const preference = TIER_ROUTING[tier];

    for (const providerId of preference) {
      const provider = this.providers.get(providerId);
      if (provider?.available) {
        if (provider.tier !== 'free' && this.costs.isOverBudget()) {
          continue;
        }
        return provider;
      }
    }

    const any = Array.from(this.providers.values()).find(p => p.available);
    if (!any) {
      throw new Error('No AI providers available. Please configure at least Ollama or Claude.');
    }
    return any;
  }

  /**
   * Get fallback provider if primary fails
   */
  getFallbackProvider(currentId: string): AIProvider | null {
    for (const [id, provider] of this.providers) {
      if (id !== currentId && provider.available) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Send completion request to the selected provider.
   * Tracks system prompt cache hits to estimate token savings.
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const provider = this.providers.get(request.provider);
    if (!provider) {
      throw new Error(`Provider ${request.provider} not found`);
    }

    // ── Prompt cache tracking ──
    const promptHash = this.hashPrompt(request.system);
    const cacheKey = `${provider.id}:system`;
    const cached = this.promptCache.get(cacheKey);

    if (cached && cached.hash === promptHash) {
      this.cacheHits++;
      // Estimate saved tokens: rough system prompt token count (chars / 4)
      this.savedTokens += Math.ceil(request.system.length / 4);
    } else {
      this.cacheMisses++;
      this.promptCache.set(cacheKey, { hash: promptHash, timestamp: Date.now() });
    }

    switch (provider.id) {
      case 'ollama':
        return this.completeOllama(provider, request);
      case 'gemini':
        return this.completeGemini(provider, request);
      case 'deepseek':
        return this.completeOpenAICompatible(provider, request, 'deepseek_api_key');
      case 'claude':
        return this.completeClaude(provider, request);
      case 'openai':
        return this.completeOpenAICompatible(provider, request, 'openai_api_key');
      default:
        throw new Error(`Unknown provider: ${provider.id}`);
    }
  }


  private getModelForRequest(request: CompletionRequest, provider: AIProvider): string {
    if (request.model) return request.model;
    const lane = this.getLaneForTaskType(request.taskType || 'general');
    if (provider.id === 'claude') {
      return this.config.claude?.models?.[lane] || this.config.claude?.defaultModel || provider.model;
    }
    return this.config.ollama?.models?.[lane] || this.config.ollama?.defaultModel || this.config.ollama?.model || provider.model || 'qwen3.5:35b';
  }

  private getThinkingForRequest(request: CompletionRequest, providerId?: string): boolean | 'low' | 'medium' | 'high' | undefined {
    if (request.think !== undefined) return request.think;
    const lane = this.getLaneForTaskType(request.taskType || 'general');
    if (providerId === 'claude') {
      return this.config.claude?.thinking?.[lane];
    }
    return this.config.ollama?.thinking?.[lane];
  }
  /**
   * Returns prompt cache statistics for the dashboard
   */
  getCacheStats(): { hits: number; misses: number; savedTokens: number } {
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      savedTokens: this.savedTokens,
    };
  }

  /**
   * Compute a fast hash of a system prompt for cache comparison
   */
  private hashPrompt(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex');
  }

  // ── Ollama (http module — bypasses undici/fetch entirely) ──
  // Node.js's built-in fetch uses undici which has a hardcoded 5-min body
  // timeout that kills long-running generations (especially with think:true).
  // Using the http module directly gives full socket-level timeout control.
  private async completeOllama(
    provider: AIProvider,
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const model = this.getModelForRequest(request, provider);
    const think = this.getThinkingForRequest(request, provider.id);
    const timeoutMs = this.config.ollama?.requestTimeoutMs || 3600000;

    const payload = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages,
      ],
      stream: true,
      think,
      options: {
        temperature: request.temperature ?? this.config.defaultTemperature ?? 0.7,
        num_predict: request.maxTokens ?? this.config.ollama?.maxTokens ?? provider.maxTokens,
      },
    });

    const url = new URL(`${provider.endpoint}/api/chat`);
    console.log(`  [ollama] Sending POST to ${url.hostname}:${url.port}${url.pathname} (model: ${model}, think: ${think})`);

    return new Promise<CompletionResponse>((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname,
          port: url.port || 11434,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
            res.on('end', () => {
              let errText = res.statusMessage || 'Ollama request failed';
              try {
                const errData = JSON.parse(errBody);
                errText = errData?.error || errData?.message?.content || errText;
              } catch { /* use statusMessage */ }
              reject(new Error(`Ollama error (${model}): ${errText}`));
            });
            return;
          }

          // Read the NDJSON stream and accumulate content
          let content = '';
          let promptEvalCount = 0;
          let evalCount = 0;
          let buffer = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();

            let newlineIdx: number;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIdx).trim();
              buffer = buffer.slice(newlineIdx + 1);

              if (!line) continue;

              try {
                const parsed = JSON.parse(line);

                if (parsed.message?.content) {
                  content += parsed.message.content;
                }

                if (parsed.done) {
                  promptEvalCount = parsed.prompt_eval_count || 0;
                  evalCount = parsed.eval_count || 0;
                }

                if (parsed.error) {
                  reject(new Error(`Ollama stream error (${model}): ${parsed.error}`));
                  req.destroy();
                  return;
                }
              } catch {
                // Skip malformed JSON lines
              }
            }
          });

          res.on('end', () => {
            resolve({
              text: content.trim(),
              tokensUsed: promptEvalCount + evalCount,
              estimatedCost: 0,
              provider: 'ollama',
            });
          });

          res.on('error', (err) => {
            reject(new Error(`Ollama stream error (${model}): ${err.message}`));
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Ollama request timed out after ${Math.round(timeoutMs / 60000)}m`));
      });

      req.on('error', (err) => {
        reject(new Error(`Ollama connection error (${model}): ${err.message}`));
      });

      req.write(payload);
      req.end();
    });
  }

  // ── Google Gemini ──
  private async completeGemini(
    provider: AIProvider,
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const apiKey = await this.vault.get('gemini_api_key');
    const response = await fetch(
      `${provider.endpoint}/models/${provider.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            temperature: request.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens ?? provider.maxTokens,
          },
        }),
      }
    );

    const data = await response.json() as any;
    if (data.error) {
      console.error(`  ✗ Gemini API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error(`Gemini API error: ${data.error.message || 'Unknown error'}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = data.usageMetadata;
    return {
      text,
      tokensUsed: (usage?.promptTokenCount || 0) + (usage?.candidatesTokenCount || 0),
      estimatedCost: 0, // Free tier
      provider: 'gemini',
    };
  }

  // ── Anthropic Claude ──
  private async completeClaude(
    provider: AIProvider,
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const apiKey = await this.vault.get('anthropic_api_key');
    const response = await fetch(`${provider.endpoint}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: request.maxTokens ?? provider.maxTokens,
        system: request.system,
        messages: request.messages,
      }),
    });

    const data = await response.json() as any;
    if (data.error) {
      console.error(`  ✗ Claude API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error(`Claude API error: ${data.error.message || 'Unknown error'}`);
    }
    const text = data.content?.[0]?.text || '';
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    return {
      text,
      tokensUsed: inputTokens + outputTokens,
      estimatedCost: (inputTokens / 1000) * provider.costPer1kInput +
                     (outputTokens / 1000) * provider.costPer1kOutput,
      provider: 'claude',
    };
  }

  // ── OpenAI-compatible (OpenAI, DeepSeek) ──
  private async completeOpenAICompatible(
    provider: AIProvider,
    request: CompletionRequest,
    vaultKey: string
  ): Promise<CompletionResponse> {
    const apiKey = await this.vault.get(vaultKey);
    const endpoint = `${provider.endpoint}/chat/completions`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages,
        ],
        max_tokens: request.maxTokens ?? provider.maxTokens,
        temperature: request.temperature ?? 0.7,
      }),
    });

    const data = await response.json() as any;
    if (data.error) {
      console.error(`  ✗ ${provider.name} API error: ${data.error.message || JSON.stringify(data.error)}`);
      throw new Error(`${provider.name} API error: ${data.error.message || 'Unknown error'}`);
    }
    const text = data.choices?.[0]?.message?.content || '';
    const usage = data.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    return {
      text,
      tokensUsed: inputTokens + outputTokens,
      estimatedCost: (inputTokens / 1000) * provider.costPer1kInput +
                     (outputTokens / 1000) * provider.costPer1kOutput,
      provider: provider.id,
    };
  }

  getActiveProviders(): AIProvider[] {
    return Array.from(this.providers.values()).filter(p => p.available);
  }
}
