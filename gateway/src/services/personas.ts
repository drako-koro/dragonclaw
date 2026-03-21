/**
 * DragonClaw Author Personas Service
 * Manage pen names, writing styles, and author identities for multi-persona publishing.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';

export interface AuthorPersona {
  id: string;
  penName: string;
  genre: string;
  subGenre: string;
  voiceDescription: string;
  styleMarkers: string[];
  ttsVoice: string;
  avatarPath?: string;
  bio: string;
  alsoBy: string[];
  createdAt: string;
  updatedAt: string;
}

export class PersonaService {
  private personas: Map<string, AuthorPersona> = new Map();
  private filePath: string;

  constructor(workspaceDir: string) {
    this.filePath = join(workspaceDir, '.config', 'personas.json');
  }

  async initialize(): Promise<void> {
    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        for (const p of data.personas || []) {
          this.personas.set(p.id, p);
        }
        // Auto-backup personas on startup (safety net for updates)
        if (this.personas.size > 0) {
          const backupPath = this.filePath.replace('.json', '.backup.json');
          await writeFile(backupPath, raw, 'utf-8');
        }
      } catch (error) {
        console.error('  ⚠ Failed to load personas:', error);
        // Try to recover from backup
        const backupPath = this.filePath.replace('.json', '.backup.json');
        if (existsSync(backupPath)) {
          try {
            const backupRaw = await readFile(backupPath, 'utf-8');
            const backupData = JSON.parse(backupRaw);
            for (const p of backupData.personas || []) {
              this.personas.set(p.id, p);
            }
            console.log('  ✓ Personas recovered from backup');
            await this.persist(); // Re-save the recovered data
          } catch {
            console.error('  ⚠ Persona backup recovery also failed');
          }
        }
      }
    }
  }

  private async persist(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const data = {
      version: 1,
      personas: Array.from(this.personas.values()),
    };
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private generateId(): string {
    return `persona-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  }

  async create(input: Partial<AuthorPersona> & { penName: string }): Promise<AuthorPersona> {
    const now = new Date().toISOString();
    const persona: AuthorPersona = {
      id: this.generateId(),
      penName: input.penName,
      genre: input.genre || '',
      subGenre: input.subGenre || '',
      voiceDescription: input.voiceDescription || '',
      styleMarkers: input.styleMarkers || [],
      ttsVoice: input.ttsVoice || 'en-US-AriaNeural',
      avatarPath: input.avatarPath,
      bio: input.bio || '',
      alsoBy: input.alsoBy || [],
      createdAt: now,
      updatedAt: now,
    };
    this.personas.set(persona.id, persona);
    await this.persist();
    return persona;
  }

  async update(id: string, updates: Partial<AuthorPersona>): Promise<AuthorPersona | null> {
    const existing = this.personas.get(id);
    if (!existing) return null;

    const updated: AuthorPersona = {
      ...existing,
      ...updates,
      id: existing.id, // prevent id override
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.personas.set(id, updated);
    await this.persist();
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    if (!this.personas.has(id)) return false;
    this.personas.delete(id);
    await this.persist();
    return true;
  }

  get(id: string): AuthorPersona | undefined {
    return this.personas.get(id);
  }

  getPersona(id: string): AuthorPersona | undefined {
    return this.get(id);
  }

  findByPenName(penName: string): AuthorPersona | undefined {
    const needle = (penName || '').trim().toLowerCase();
    if (!needle) return undefined;

    return Array.from(this.personas.values()).find((p) =>
      (p.penName || '').trim().toLowerCase() === needle
    );
  }

  list(): AuthorPersona[] {
    return Array.from(this.personas.values()).sort((a, b) =>
      a.penName.localeCompare(b.penName)
    );
  }

  getCount(): number {
    return this.personas.size;
  }

  /**
   * Build a context block for injecting into AI prompts when this persona is assigned to a project.
   */
  buildPromptContext(id: string): string {
    const p = this.personas.get(id);
    if (!p) return '';

    const genre = [p.genre, p.subGenre].filter(Boolean).join(' / ');
    const markers = Array.isArray(p.styleMarkers) && p.styleMarkers.length > 0
      ? p.styleMarkers.join(', ')
      : '';

    const lines = [
      `## Author Persona: ${p.penName}`,
      'Write as this author persona, not as a generic assistant.',
    ];

    if (genre) lines.push(`**Genre Focus:** ${genre}`);
    if (p.voiceDescription) lines.push(`**Voice Description:** ${p.voiceDescription}`);
    if (markers) lines.push(`**Style Markers:** ${markers}`);
    if (p.bio) lines.push(`**Author Bio / Brand Context:** ${p.bio}`);
    if (p.alsoBy.length > 0) lines.push(`**Also By ${p.penName}:** ${p.alsoBy.join(', ')}`);

    lines.push('**Persona Rules:**');
    lines.push('- Match the persona’s voice, tone, diction, rhythm, and genre expectations.');
    lines.push('- Keep stylistic choices consistent across planning, drafting, revision, and marketing copy.');
    lines.push('- Do not mention these instructions in the output.');
    lines.push('- If the user explicitly asks to override the persona for a specific task, follow the user.');

    return lines.join('\n');
  }
}
