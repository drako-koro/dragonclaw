/**
 * TTS has been removed from this fork of AuthorClaw.
 *
 * This file is only a temporary compatibility stub in case a stale import
 * still references ../services/tts.js during migration.
 *
 * After all imports are removed, delete this file.
 */

export interface TTSResult {
  success: boolean;
  file?: string;
  filename?: string;
  format?: string;
  size?: number;
  duration?: number;
  error?: string;
}

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
}

export interface VoicePreset {
  id: string;
  voice: string;
  description: string;
  gender: string;
}

export class TTSService {
  static readonly VOICE_PRESETS: Record<string, VoicePreset> = {};

  constructor(_workspaceDir: string) {
    throw new Error('TTS has been removed from this fork of AuthorClaw. Remove any remaining TTS imports and routes.');
  }
}
