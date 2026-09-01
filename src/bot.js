import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";

import { registerConfiguredCommands, registerCommandsForGuild } from "./registerCommands.js";
import pingCommand from "./commands/ping.js";
import kbbCommand from "./commands/kbb.js";
import { startTop5DeadlineScheduler } from "./utils/top5Deadline.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

const commands = new Map([
  [pingCommand.data.name, pingCommand],
  [kbbCommand.data.name, kbbCommand],
]);

client.once(Events.ClientReady, async () => {
  console.log(`✅ KBB Bot logged in as ${client.user.tag}`);

  try {
    await registerConfiguredCommands(client);
  } catch (err) {
    console.error("❌ Slash command registration failed:", err?.message || err);
  }

  startTop5DeadlineScheduler(client);
  console.log("⏰ Top-5 deadline scheduler active: Tuesday 22:00 Europe/Berlin");
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    console.log(`➕ KBB Bot joined guild: ${guild.name} (${guild.id})`);
    await registerCommandsForGuild(guild.id);
  } catch (err) {
    console.error("❌ Failed to register commands after guild join:", err?.message || err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isModalSubmit()) {
      if (await kbbCommand.handleModalSubmit?.(interaction)) return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) {
      return interaction.reply({
        content: "❌ Unknown command.",
        ephemeral: true,
      });
    }

    return await command.execute(interaction);
  } catch (err) {
    console.error("❌ Interaction error:", err?.message || err);

    try {
      const payload = {
        content: "❌ Beim Ausführen des Commands ist ein Fehler passiert.",
        ephemeral: true,
      };

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
      }

      return interaction.reply(payload);
    } catch {}
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN missing in environment.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
