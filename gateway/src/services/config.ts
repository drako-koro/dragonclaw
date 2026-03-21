/**
 * DragonClaw Configuration Service
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export class ConfigService {
  private configDir: string;
  private config: Record<string, any> = {};
  private userOverrides: Record<string, any> = {};

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  async load(): Promise<void> {
    const defaultPath = join(this.configDir, 'default.json');
    if (existsSync(defaultPath)) {
      const raw = await readFile(defaultPath, 'utf-8');
      this.config = JSON.parse(raw);
    }

    // Merge user overrides
    const userPath = join(this.configDir, 'user.json');
    if (existsSync(userPath)) {
      const raw = await readFile(userPath, 'utf-8');
      this.userOverrides = JSON.parse(raw);
      this.config = this.deepMerge(this.config, this.userOverrides);
    }

    // Environment variable overrides
    if (process.env.DRAGONCLAW_PORT) this.set('server.port', parseInt(process.env.DRAGONCLAW_PORT));
    if (process.env.DRAGONCLAW_PRESET) this.set('security.permissionPreset', process.env.DRAGONCLAW_PRESET);

    // Normalize Ollama model settings so old configs keep working
    const ollama = this.config.ai?.ollama;
    if (ollama) {
      if (!ollama.defaultModel && ollama.model) ollama.defaultModel = ollama.model;
      if (!ollama.model && ollama.defaultModel) ollama.model = ollama.defaultModel;
      if (!ollama.models || typeof ollama.models !== 'object') ollama.models = {};
      if (!ollama.models.planning) ollama.models.planning = ollama.defaultModel || ollama.model || 'qwen3.5:35b';
      if (!ollama.models.drafting) ollama.models.drafting = ollama.defaultModel || ollama.model || 'qwen3.5:35b';
      if (!ollama.models.critique) ollama.models.critique = ollama.defaultModel || ollama.model || 'qwen3.5:35b';
      if (!ollama.models.rewrite) ollama.models.rewrite = ollama.defaultModel || ollama.model || 'qwen3.5:35b';
      if (!ollama.models.final) ollama.models.final = ollama.defaultModel || ollama.model || 'qwen3.5:35b';
      if (!ollama.thinking || typeof ollama.thinking !== 'object') ollama.thinking = {};
    }

  }

  get(path: string, defaultValue?: any): any {
    const parts = path.split('.');
    let current = this.config;
    for (const part of parts) {
      if (current?.[part] === undefined) return defaultValue;
      current = current[part];
    }
    return current ?? defaultValue;
  }

  set(path: string, value: any): void {
    const parts = path.split('.');
    let current = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  /** Set a value and persist it to config/user.json so it survives restarts. */
  async setAndPersist(path: string, value: any): Promise<void> {
    this.set(path, value);

    // Also update userOverrides
    const parts = path.split('.');
    let current = this.userOverrides;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;

    // Write to disk
    const userPath = join(this.configDir, 'user.json');
    await writeFile(userPath, JSON.stringify(this.userOverrides, null, 2), 'utf-8');
  }

  private normalizeDragonClawAIConfig(): void {
    const ai = this.config.ai || (this.config.ai = {});
    const ollama = ai.ollama || (ai.ollama = {});
    const defaultModel = ollama.defaultModel || ollama.model || 'qwen3.5:35b';
    ollama.defaultModel = defaultModel;
    ollama.model = defaultModel;
    ollama.maxTokens = ollama.maxTokens || 4096;
    ollama.requestTimeoutMs = ollama.requestTimeoutMs || 600000;
    ollama.models = {
      planning: ollama.models?.planning || 'deepseek-r1:32b',
      drafting: ollama.models?.drafting || 'qwen3.5:35b',
      critique: ollama.models?.critique || 'deepseek-r1:32b',
      rewrite: ollama.models?.rewrite || 'mistral-small3.2:24b',
      final: ollama.models?.final || 'deepseek-r1:32b',
    };
    ollama.thinking = {
      planning: typeof ollama.thinking?.planning === 'boolean' ? ollama.thinking.planning : true,
      drafting: typeof ollama.thinking?.drafting === 'boolean' ? ollama.thinking.drafting : false,
      critique: typeof ollama.thinking?.critique === 'boolean' ? ollama.thinking.critique : true,
      rewrite: typeof ollama.thinking?.rewrite === 'boolean' ? ollama.thinking.rewrite : false,
      final: typeof ollama.thinking?.final === 'boolean' ? ollama.thinking.final : true,
    };
    ai.defaultProvider = ai.defaultProvider || 'ollama';
    ai.providers = {
      planning: ai.providers?.planning || ai.defaultProvider,
      drafting: ai.providers?.drafting || ai.defaultProvider,
      critique: ai.providers?.critique || ai.defaultProvider,
      rewrite: ai.providers?.rewrite || ai.defaultProvider,
      final: ai.providers?.final || ai.defaultProvider,
    };
  }

  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        output[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }
}
