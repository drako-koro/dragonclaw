/**
 * DragonClaw Discord Bridge
 * Secure Discord bot integration — command center + chat bridge
 */

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type TextBasedChannel,
} from 'discord.js';

interface DiscordConfig {
  enabled: boolean;
  guildId: string;
  allowedUsers: string[];
  allowedChannels: string[];
  registerSlashCommands: boolean;
  pairingEnabled: boolean;
}

interface CommandHandlers {
  createProject: (title: string, description: string, config?: Record<string, any>) => Promise<{ id: string; steps: number }>;
  startAndRunProject: (projectId: string) => Promise<{ completed: string; response: string; wordCount: number; nextStep?: string } | { error: string }>;
  autoRunProject: (projectId: string, statusCallback: (msg: string) => Promise<void>) => Promise<void>;
  listProjects: () => Array<{ id: string; title: string; status: string; progress: string }>;
  saveToFile: (filename: string, content: string) => Promise<void>;
  handleMessage: (content: string, channel: string, respond: (text: string) => void) => Promise<void>;
  research: (query: string) => Promise<{ results: string; error?: string }>;
  listFiles: (subdir?: string) => Promise<string[]>;
  readFile: (filename: string) => Promise<{ content: string; error?: string }>;
}

export class DiscordBridge {
  private client?: Client;
  private config: DiscordConfig;
  private messageHandler?: (content: string, channel: string, respond: (text: string) => void) => Promise<void>;
  private commandHandlers?: CommandHandlers;
  private knownChannelIds: Set<string> = new Set();
  private lastFileList: Map<string, string[]> = new Map();
  public pauseRequested = false;

  constructor(private token: string, config: Partial<DiscordConfig>) {
    this.config = {
      enabled: config.enabled ?? true,
      guildId: config.guildId || '',
      allowedUsers: config.allowedUsers || [],
      allowedChannels: config.allowedChannels || [],
      registerSlashCommands: config.registerSlashCommands ?? true,
      pairingEnabled: config.pairingEnabled ?? true,
    };
  }

  onMessage(handler: (content: string, channel: string, respond: (text: string) => void) => Promise<void>) {
    this.messageHandler = handler;
  }

  setCommandHandlers(handlers: CommandHandlers) {
    this.commandHandlers = handlers;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });

    this.client.once('ready', async () => {
      console.log(`  ✓ Discord bridge logged in as ${this.client?.user?.tag || 'unknown user'}`);
      if (this.config.registerSlashCommands && this.config.guildId) {
        try {
          await this.registerSlashCommands();
          console.log(`  ✓ Discord slash commands registered for guild ${this.config.guildId}`);
        } catch (error) {
          console.error('Discord slash command registration failed:', error);
        }
      }
    });

    this.client.on('messageCreate', async (message) => {
      try {
        if (message.author.bot) return;
        if (!this.isAllowedMessage(message)) return;
        this.knownChannelIds.add(message.channelId);
        await this.handleInput(
          message.author.id,
          message.channelId,
          message.author.displayName || message.author.username,
          message.content,
          async (text: string) => {
            await this.sendMessage(message.channel, text);
          }
        );
      } catch (error) {
        console.error('Discord message handler error:', error);
      }
    });

    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;
        if (!this.isAllowedInteraction(interaction)) {
          await interaction.reply({ content: '🔒 Not authorized for DragonClaw.', ephemeral: true });
          return;
        }

        const content = this.interactionToText(interaction);
        if (!content) {
          await interaction.reply({ content: 'Unsupported command.', ephemeral: true });
          return;
        }

        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply();
        }
        if (interaction.channelId) this.knownChannelIds.add(interaction.channelId);

        await this.handleInput(
          interaction.user.id,
          interaction.channelId || interaction.user.id,
          interaction.user.displayName || interaction.user.username,
          content,
          async (text: string) => {
            await this.replyInteraction(interaction, text);
          }
        );
      } catch (error) {
        console.error('Discord interaction handler error:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `❌ ${String(error)}`, ephemeral: true }).catch(() => {});
        }
      }
    });

    await this.client.login(this.token);
  }

  private isAllowedMessage(message: Message): boolean {
    const userId = message.author.id;
    if (this.config.allowedUsers.length > 0 && !this.config.allowedUsers.includes(userId)) return false;
    if (message.guildId && this.config.allowedChannels.length > 0 && !this.config.allowedChannels.includes(message.channelId)) return false;
    return true;
  }

  private isAllowedInteraction(interaction: ChatInputCommandInteraction): boolean {
    const userId = interaction.user.id;
    if (this.config.allowedUsers.length > 0 && !this.config.allowedUsers.includes(userId)) return false;
    if (interaction.guildId && this.config.allowedChannels.length > 0 && interaction.channelId && !this.config.allowedChannels.includes(interaction.channelId)) return false;
    return true;
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.client?.user || !this.config.guildId) return;
    const commands = [
      new SlashCommandBuilder().setName('help').setDescription('Show DragonClaw Discord commands'),
      new SlashCommandBuilder().setName('novel').setDescription('Start a full novel pipeline').addStringOption(o => o.setName('idea').setDescription('Novel idea').setRequired(true)),
      new SlashCommandBuilder().setName('project').setDescription('Plan and auto-run a project').addStringOption(o => o.setName('task').setDescription('Task description').setRequired(true)),
      new SlashCommandBuilder().setName('write').setDescription('Quick writing task').addStringOption(o => o.setName('idea').setDescription('Writing idea').setRequired(true)),
      new SlashCommandBuilder().setName('projects').setDescription('List projects'),
      new SlashCommandBuilder().setName('status').setDescription('Project status'),
      new SlashCommandBuilder().setName('research').setDescription('Research a topic').addStringOption(o => o.setName('query').setDescription('Research query').setRequired(true)),
      new SlashCommandBuilder().setName('files').setDescription('List files').addStringOption(o => o.setName('folder').setDescription('Optional folder').setRequired(false)),
      new SlashCommandBuilder().setName('read').setDescription('Read a file by number or name').addStringOption(o => o.setName('target').setDescription('File number or name').setRequired(true)),
      new SlashCommandBuilder().setName('stop').setDescription('Pause the active project'),
      new SlashCommandBuilder().setName('continue').setDescription('Resume the active or paused project'),
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(this.token);
    await rest.put(
      Routes.applicationGuildCommands(this.client.user.id, this.config.guildId),
      { body: commands }
    );
  }

  private interactionToText(interaction: ChatInputCommandInteraction): string {
    const n = interaction.commandName;
    const get = (name: string) => interaction.options.getString(name, false) || '';
    switch (n) {
      case 'help': return '/help';
      case 'novel': return `/novel ${get('idea')}`.trim();
      case 'project': return `/project ${get('task')}`.trim();
      case 'write': return `/write ${get('idea')}`.trim();
      case 'projects': return '/projects';
      case 'status': return '/status';
      case 'research': return `/research ${get('query')}`.trim();
      case 'files': return `/files ${get('folder')}`.trim();
      case 'read': return `/read ${get('target')}`.trim();
      case 'stop': return '/stop';
      case 'continue': return 'continue';
      default: return '';
    }
  }

  private async handleInput(userId: string, channelId: string, userName: string, text: string, respond: (text: string) => Promise<void>): Promise<void> {
    const channelKey = channelId || userId;

    if (text.startsWith('/start') || text.startsWith('/help')) {
      await respond(
        `✍️ Hey ${userName}! I'm DragonClaw.\n\n` +
        `*Commands:*\n` +
        `/novel [idea] — Start a full novel pipeline\n` +
        `/project [task] — Plan & auto-execute any task\n` +
        `/write [idea] — Quick writing task\n` +
        `/projects — List all projects\n` +
        `/status — Project status\n` +
        `/stop — Stop/pause active project\n` +
        `/research [topic] — Research a topic\n` +
        `/files — List output files (numbered)\n` +
        `/read [# or name] — Read a file\n\n` +
        `Or just chat with me naturally.`
      );
      return;
    }

    if (text.startsWith('/novel') || text.startsWith('/conductor')) {
      const idea = text.replace(/^\/(novel|conductor)\s*/, '').trim();
      if (!idea) {
        await respond(`What novel should I write?\n/novel a sci-fi thriller about rogue AI\n/novel a cozy mystery set in a bookshop`);
        return;
      }
      if (this.commandHandlers) {
        try {
          const result = await this.commandHandlers.createProject(idea, `Write a complete novel: ${idea}`);
          await respond(`📖 Novel pipeline created: "${idea}"\n${result.steps} steps (premise → bible → outline → chapters → revision → assembly)\n\nStarting autonomous execution...`);
          void this.commandHandlers.autoRunProject(result.id, async (msg: string) => {
            await respond(msg);
          });
        } catch (e) {
          await respond(`❌ ${String(e)}`);
        }
      }
      return;
    }

    if (text.startsWith('/write')) {
      const idea = text.replace(/^\/write\s*/, '').trim();
      if (!idea) {
        await respond(`What's the idea? Try:\n/write cyberpunk heist thriller about rogue AI`);
        return;
      }
      if (this.commandHandlers) {
        await respond(`📝 On it. Planning "${idea}"...\nI'll figure out the steps and run them automatically.`);
        try {
          const project = await this.commandHandlers.createProject(idea, idea);
          await respond(`✅ Planned ${project.steps} steps. Running autonomously...\nUse /stop to pause, /status to check progress.`);
          void this.commandHandlers.autoRunProject(project.id, async (msg: string) => {
            await respond(msg);
          });
        } catch (e) {
          await respond(`❌ Error: ${String(e)}`);
        }
      }
      return;
    }

    if (text === '/projects' || text.startsWith('/projects ') || text === '/goals' || text.startsWith('/goals ')) {
      if (this.commandHandlers) {
        const projects = this.commandHandlers.listProjects();
        if (projects.length === 0) {
          await respond(`No projects yet. Create one with /project or /write`);
        } else {
          const list = projects.map(p => `${p.status === 'completed' ? '✅' : p.status === 'active' ? '🔄' : p.status === 'failed' ? '❌' : '⏸'} ${p.title} (${p.progress})`).join('\n');
          await respond(`📋 *Projects:*\n${list}`);
        }
      }
      return;
    }

    if (text.startsWith('/project ') || text === '/project' || text.startsWith('/goal ') || text === '/goal') {
      const description = text.replace(/^\/(project|goal)\s*/, '').trim();
      if (!description) {
        await respond(`📋 Tell me what to do:\n/project write a full tech-thriller from start to finish\n/project research medieval weapons for my fantasy novel\n/project revise chapters 1-3 for pacing`);
        return;
      }
      if (this.commandHandlers) {
        try {
          await respond(`🧠 Planning "${description}"...`);
          const project = await this.commandHandlers.createProject(description, description);
          await respond(`✅ Planned ${project.steps} steps. Running autonomously...\nUse /stop to pause, /status to check progress.`);
          void this.commandHandlers.autoRunProject(project.id, async (msg: string) => {
            await respond(msg);
          });
        } catch (e) {
          await respond(`❌ ${String(e)}`);
        }
      }
      return;
    }

    if (text.startsWith('/status')) {
      let summary = '';
      if (this.commandHandlers) {
        const projects = this.commandHandlers.listProjects();
        const active = projects.filter(p => p.status === 'active');
        const paused = projects.filter(p => p.status === 'paused');
        const completed = projects.filter(p => p.status === 'completed');
        if (active.length > 0) summary += `🔄 ${active.length} project(s) running:\n` + active.map(p => `  • ${p.title} (${p.progress})`).join('\n') + '\n';
        if (paused.length > 0) summary += `⏸ ${paused.length} project(s) paused:\n` + paused.map(p => `  • ${p.title} (${p.progress})`).join('\n') + '\n';
        if (completed.length > 0) summary += `✅ ${completed.length} project(s) done\n`;
      }
      if (!summary) summary = 'Nothing running. Use /project or /write to start.\n';
      await respond(summary + `\n📊 Dashboard: http://localhost:3847`);
      return;
    }

    if (text.startsWith('/research')) {
      const query = text.replace(/^\/research\s*/, '').trim();
      if (!query) {
        await respond(`What should I research?\n/research medieval sword types\n/research self-publishing trends 2026`);
        return;
      }
      if (this.commandHandlers) {
        await respond(`🔍 Researching "${query}"...`);
        try {
          const result = await this.commandHandlers.research(query);
          await respond(result.error ? `⚠️ ${result.error}` : result.results);
        } catch (e) {
          await respond(`❌ Research failed: ${String(e)}`);
        }
      }
      return;
    }

    if (text.startsWith('/files')) {
      const subdir = text.replace(/^\/files\s*/, '').trim() || '';
      if (this.commandHandlers) {
        try {
          const files = await this.commandHandlers.listFiles(subdir);
          if (files.length === 0) {
            await respond(`📁 No files found${subdir ? ` in ${subdir}` : ''}.`);
          } else {
            const actualFiles = files.filter(f => !f.includes('📁')).map(f => f.replace(/^[\s📄]+/, '').trim());
            this.lastFileList.set(channelKey, actualFiles);
            let msg = `📁 *Files${subdir ? ` in ${subdir}` : ''}:*\n`;
            let fileNum = 1;
            for (const f of files) {
              if (f.includes('📁')) msg += `\n${f}\n`;
              else msg += `  ${fileNum++}. ${f.replace(/^[\s📄]+/, '').trim()}\n`;
            }
            msg += `\n💡 Use /read 1 or /read 3 to read by number`;
            await respond(msg);
          }
        } catch (e) {
          await respond(`❌ ${String(e)}`);
        }
      }
      return;
    }

    if (text.startsWith('/read')) {
      const input = text.replace(/^\/read\s*/, '').trim();
      if (!input) {
        await respond(`📖 Use /files first to see numbered list, then:\n/read 1 — read file #1\n/read 3 — read file #3`);
        return;
      }
      if (this.commandHandlers) {
        try {
          let filename = input;
          const num = parseInt(input, 10);
          const files = this.lastFileList.get(channelKey) || [];
          if (!isNaN(num) && num >= 1 && num <= files.length) filename = files[num - 1];
          const result = await this.commandHandlers.readFile(filename);
          if (result.error) {
            await respond(`⚠️ ${result.error}`);
          } else {
            const preview = result.content.length > 2000 ? result.content.substring(0, 2000) + `\n\n... (${result.content.length} chars total — view full in dashboard)` : result.content;
            await respond(`📄 *${filename}:*\n\n${preview}`);
          }
        } catch (e) {
          await respond(`❌ ${String(e)}`);
        }
      }
      return;
    }

    if (text.startsWith('/stop') || text.startsWith('/pause')) {
      const activeProject = this.commandHandlers ? this.commandHandlers.listProjects().find(p => p.status === 'active') : undefined;
      if (activeProject) {
        this.pauseRequested = true;
        try { await fetch(`http://localhost:3847/api/projects/${activeProject.id}/pause`, { method: 'POST' }); } catch {}
        await respond(`⏸ Paused "${activeProject.title}". Say "continue" to resume.`);
      } else {
        await respond(`Nothing running right now.`);
      }
      return;
    }

    const lower = text.toLowerCase().trim();
    if (lower === 'continue' || lower === 'next' || lower === 'go' || lower === 'resume' || text.startsWith('/continue')) {
      if (this.commandHandlers) {
        const projects = this.commandHandlers.listProjects();
        const active = projects.find(p => p.status === 'active' || p.status === 'paused');
        if (!active) {
          await respond(`No projects to continue. Create one with /project or /write`);
          return;
        }
        this.pauseRequested = false;
        await respond(`▶️ Resuming "${active.title}"...\nUse /stop to pause again.`);
        void this.commandHandlers.autoRunProject(active.id, async (msg: string) => {
          await respond(msg);
        });
      }
      return;
    }

    if (this.messageHandler) {
      const prompt = `[Discord chat — keep your response concise, conversational, and readable in chat. Avoid walls of text unless the user explicitly asks for a long chapter or full breakdown.]\n\n${text}`;
      await this.messageHandler(prompt, `discord:${channelId}`, async (response) => {
        await respond(response);
      });
    }
  }

  private async sendMessage(channel: TextBasedChannel, text: string): Promise<void> {
    const chunks = this.splitMessage(text, 1900);
    for (const chunk of chunks) {
      await channel.send({ content: chunk });
    }
  }

  private async replyInteraction(interaction: ChatInputCommandInteraction, text: string): Promise<void> {
    const chunks = this.splitMessage(text, 1900);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        if (interaction.deferred) await interaction.editReply({ content: chunks[i] });
        else await interaction.reply({ content: chunks[i] });
      } else {
        await interaction.followUp({ content: chunks[i] });
      }
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt < maxLength / 2) splitAt = remaining.lastIndexOf(' ', maxLength);
      if (splitAt < maxLength / 2) splitAt = maxLength;
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }
    return chunks;
  }

  updateAllowedUsers(users: string[]): void {
    this.config.allowedUsers = users;
  }

  updateAllowedChannels(channels: string[]): void {
    this.config.allowedChannels = channels;
  }

  async broadcastToAllowed(message: string): Promise<void> {
    if (!this.client) return;
    for (const channelId of this.knownChannelIds) {
      try {
        const channel = await this.client.channels.fetch(channelId);
        if (channel && 'send' in channel) {
          await this.sendMessage(channel as TextBasedChannel, message);
        }
      } catch (e) {
        console.error(`Discord broadcast to ${channelId} failed:`, e);
      }
    }
  }

  disconnect(): void {
    void this.client?.destroy();
    this.client = undefined;
  }
}
