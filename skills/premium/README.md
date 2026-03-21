# DragonClaw Premium Skills Bundle

This directory is where purchased premium skills are installed.

## Get the Premium Bundle

The **DragonClaw Premium Skills Bundle** includes **10 premium skills** in one package:

- **Ghostwriter Pro** — Scene generation, pacing analysis, tension mapping, deep write mode
- **Series Architect** — Multi-book series planning, continuity engine, thread tracker
- **Book Launch Machine** — 60-day book launch automation, ad copy factory, email sequences
- **First Chapter Hook** — Hook scoring, opening line workshop, Look Inside optimizer
- **Comp Title Finder** — Comparable title discovery, market positioning, category strategy
- **Dictation Cleanup** — Speech-to-text cleanup with 3 intensity levels, voice-aware
- **Sensitivity Reader** — Representation review, cultural accuracy, bias detection
- **Read Aloud** — Free TTS manuscript reader with ear-edit revision workflow
- **Narrative Voice Coach** — 47-marker voice analysis, consistency checking, style coaching
- **Writing Secrets Integration** — Bridges for Book Bible Engine, Workflow Engine, and StyleClone Pro

**Purchase:** [Ko-Fi Store](https://ko-fi.com/s/4e24f1dfa5)

## Installation

1. Purchase the Premium Skills Bundle from Ko-Fi
2. Download and extract the zip file
3. Copy the skill folders into this directory:
   ```
   skills/premium/ghostwriter-pro/SKILL.md
   skills/premium/series-architect/SKILL.md
   skills/premium/book-launch-machine/SKILL.md
   skills/premium/first-chapter-hook/SKILL.md
   skills/premium/comp-title-finder/SKILL.md
   skills/premium/dictation-cleanup/SKILL.md
   skills/premium/sensitivity-reader/SKILL.md
   skills/premium/read-aloud/SKILL.md
   skills/premium/narrative-voice-coach/SKILL.md
   skills/premium/writing-secrets-integration/SKILL.md
   ```
4. Restart DragonClaw
5. Skills auto-load and appear with a ★ in the console log

## Verification

After restart, check the dashboard or call:
```
GET http://localhost:3847/api/status
```
Premium skills appear under `skills.premium` in the response.
