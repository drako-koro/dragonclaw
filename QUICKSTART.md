# DragonClaw Quick Start

Get DragonClaw running and writing in under 5 minutes.

## Prerequisites

- **Node.js 22+** (check: `node --version`)
- **Ollama installed locally** (running at `http://localhost:11434`)
- **Optional:** Telegram bot token or Discord bot token (for remote control)

## Install

```bash
git clone https://github.com/Ckokoski/dragonclaw.git
cd dragonclaw
npm install
```

## Start

```bash
npx tsx gateway/src/index.ts
```

You should see:

```
  DragonClaw v3.0.0
  ═══════════════════════════════════
  The Ember-Forged AI Writing Agent
  ...
  ✓ Skills: 25+ loaded
  ✓ Goal engine: 8 templates + dynamic AI planning
  ═══════════════════════════════════
  DragonClaw is ready to write
  Dashboard: http://localhost:3847
```

## Configure

1. Open **http://localhost:3847** in your browser
2. Go to the **Settings** tab
3. Choose your preferred providers and models, then click Save
4. The provider status should show your active Ollama and/or Claude configuration

## Your First Task

### Option A: Dashboard
1. Go to the **Agent** tab
2. Type: "Write me a short story about a robot who learns to paint"
3. Click **Go**
4. Watch the Activity Log tab as DragonClaw plans and executes

### Option B: Telegram
1. In Settings, paste your **Telegram Bot Token** and click Save
2. Click **Connect Telegram**
3. Open your bot in Telegram and send:
   ```
   /goal write me a short story about a robot who learns to paint
   ```
4. DragonClaw plans the steps and runs them, sending you updates

### Option C: API
```bash
curl -X POST http://localhost:3847/api/goals \
  -H 'Content-Type: application/json' \
  -d '{"title":"Robot Story","description":"Write a short story about a robot who learns to paint","planning":"dynamic"}'
```

## View Results

- **Dashboard** → Activity Log tab shows everything the agent did
- **Files**: `workspace/projects/` contains all generated content
- **Telegram**: Use `/files` to list, `/read [file]` to preview

## Optional Hybrid Providers

DragonClaw can run fully local with Ollama or in a hybrid setup. In Settings, you can add:

- **Anthropic Claude** — Optional for high-end planning, critique, and final verification
- **Ollama** — Primary local runtime for free on-device work

## Next Steps

- Run a full novel: `/goal write a full tech-thriller from start to finish`
- Do research: `/research medieval sword fighting techniques`
- Customize: Edit `workspace/soul/STYLE-GUIDE.md` for your writing style

## Premium Skills Bundle

Extend DragonClaw with advanced writing capabilities. The **Premium Skills Bundle** includes 10 premium skills — Ghostwriter Pro, Series Architect, Book Launch Machine, First Chapter Hook, Comp Title Finder, Dictation Cleanup, Sensitivity Reader, Read Aloud, Narrative Voice Coach, and Writing Secrets Integration — all in one package.

**Get it on Ko-Fi:** [ko-fi.com/writingsecrets](https://ko-fi.com/s/4e24f1dfa5)

### Install Premium Skills

1. Purchase the bundle from Ko-Fi
2. Download and extract the zip
3. Copy all skill folders to `skills/premium/`
4. Restart DragonClaw — premium skills appear with a star in the console

## Author OS Integration

If you have the Author OS tool suite, mount the tools for enhanced capabilities:

- **Local**: Place at `~/author-os`
- **Docker**: Mount to `/app/author-os`

DragonClaw auto-detects: Workflow Engine, Book Bible Engine, Format Factory Pro, Manuscript Autopsy, AI Author Library, Creator Asset Suite.

Format Factory Pro requires Python 3 for manuscript export.
