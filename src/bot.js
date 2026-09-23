import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";

import { registerConfiguredCommands, registerCommandsForGuild } from "./registerCommands.js";
import pingCommand from "./commands/ping.js";
import kbbCommand from "./commands/kbb.js";
import { runKbbHelp, runKickbaseInfo } from "./commands/kbbDiagnostics.js";
import { runKickbaseFeedTest } from "./commands/kbbFeedTest.js";
import { runKickbaseOwnerTest } from "./commands/kbbOwnerTest.js";
import { runTop5Start } from "./commands/kbbTop5Start.js";
import { startTop5DeadlineScheduler } from "./utils/top5Deadline.js";
import { startTop5LateSubmissionScheduler } from "./utils/top5LateSubmissionScheduler.js";
import { startKickbaseTransferFeedScheduler } from "./utils/kickbaseTransferFeedScheduler.js";
import { handleTop5Button, handleTop5ButtonModal } from "./utils/top5ButtonHandler.js";
import { runTop5ResetWithUi } from "./utils/top5ResetHandler.js";
import {
  LIVETICKER_CHANNEL_ID,
  ensureLivetickerNotificationControl,
  handleLivetickerNotificationButton,
  installLivetickerNotificationSendGuard,
} from "./utils/liveTickerNotifications.js";

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
  startTop5LateSubmissionScheduler(client);
  console.log("⏰ Top-5 deadline scheduler active: Tuesday 22:00 Europe/Berlin");
  console.log("⚠️ Top-5 late-submission recovery active until the round is closed/new Friday round starts.");

  // One shared production channel for transfers + Bundesliga live events.
  // Set before dynamically importing the livefeed module because that module reads
  // KBB_GOAL_CHANNEL_ID during module initialization.
  process.env.KBB_GOAL_CHANNEL_ID = LIVETICKER_CHANNEL_ID;

  // Give the existing Discord recovery a short head start. Discloud deployments can
  // start with an empty local manager JSON, while the durable 14-manager snapshot is
  // restored from Discord immediately after login.
  await new Promise(resolve => setTimeout(resolve, 8_000));

  await ensureLivetickerNotificationControl(client);
  await installLivetickerNotificationSendGuard(client);

  startKickbaseTransferFeedScheduler(client);
  console.log(`💸 Automatic Kickbase transfer feed scheduler started in liveticker ${LIVETICKER_CHANNEL_ID}.`);

  const { startBundesligaLiveFeedSchedulerV5 } = await import("./utils/bundesligaLiveFeedSchedulerV5.js");
  startBundesligaLiveFeedSchedulerV5(client);
  console.log(`⚽ Bundesliga live feed V5 scheduler started in liveticker ${LIVETICKER_CHANNEL_ID}.`);

  console.log("🧪 Kickbase diagnostics routes active.");
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
    if (interaction.isButton()) {
      if (await handleLivetickerNotificationButton(interaction)) return;
      if (await handleTop5Button(interaction)) return;
    }

    if (interaction.isModalSubmit()) {
      if (await handleTop5ButtonModal(interaction)) return;
      if (await kbbCommand.handleModalSubmit?.(interaction)) return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "kbb") {
      const subcommand = interaction.options.getSubcommand(false);
      if (subcommand === "kickbase-info") return runKickbaseInfo(interaction);
      if (subcommand === "owner-test") return runKickbaseOwnerTest(interaction);
      if (subcommand === "feed-test") {
        console.log(`🧪 /kbb feed-test requested by ${interaction.user.tag} (${interaction.user.id})`);
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ ephemeral: true });
        }
        return runKickbaseFeedTest(interaction);
      }
      if (subcommand === "top5-start") return runTop5Start(interaction);
      if (subcommand === "top5-reset") return runTop5ResetWithUi(interaction);
      if (subcommand === "help") return runKbbHelp(interaction);
    }

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
