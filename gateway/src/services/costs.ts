/**
 * DragonClaw Cost Tracker
 * Budget monitoring with daily/monthly caps
 */

interface CostConfig {
  dailyLimit: number;
  monthlyLimit: number;
  alertAt: number; // percentage (0-1)
}

export class CostTracker {
  dailyLimit: number;
  monthlyLimit: number;
  private alertAt: number;
  private dailySpend = 0;
  private monthlySpend = 0;
  private lastResetDay: string;
  private lastResetMonth: string;

  constructor(config: Partial<CostConfig>) {
    this.dailyLimit = config.dailyLimit ?? 5;
    this.monthlyLimit = config.monthlyLimit ?? 50;
    this.alertAt = config.alertAt ?? 0.8;
    this.lastResetDay = new Date().toISOString().split('T')[0];
    this.lastResetMonth = new Date().toISOString().substring(0, 7);
  }

  record(provider: string, tokens: number): void {
    this.checkReset();
    // Cost estimation based on provider (rough averages)
    const costPer1k: Record<string, number> = {
      ollama: 0, gemini: 0, deepseek: 0.0003,
      claude: 0.009, openai: 0.006,
    };
    const cost = (tokens / 1000) * (costPer1k[provider] || 0);
    this.dailySpend += cost;
    this.monthlySpend += cost;
  }

  isOverBudget(): boolean {
    this.checkReset();
    return this.dailySpend >= this.dailyLimit || this.monthlySpend >= this.monthlyLimit;
  }

  isNearBudget(): boolean {
    this.checkReset();
    return this.dailySpend >= this.dailyLimit * this.alertAt ||
           this.monthlySpend >= this.monthlyLimit * this.alertAt;
  }

  getStatus(): { daily: number; monthly: number; overBudget: boolean } {
    this.checkReset();
    return {
      daily: Math.round(this.dailySpend * 100) / 100,
      monthly: Math.round(this.monthlySpend * 100) / 100,
      overBudget: this.isOverBudget(),
    };
  }

  private checkReset(): void {
    const today = new Date().toISOString().split('T')[0];
    const month = new Date().toISOString().substring(0, 7);
    if (today !== this.lastResetDay) {
      this.dailySpend = 0;
      this.lastResetDay = today;
    }
    if (month !== this.lastResetMonth) {
      this.monthlySpend = 0;
      this.lastResetMonth = month;
    }
  }
}
