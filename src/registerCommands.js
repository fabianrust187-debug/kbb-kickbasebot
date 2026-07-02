import "dotenv/config";
import { REST, Routes } from "discord.js";

import pingCommand from "./commands/ping.js";
import kbbCommand from "./commands/kbb.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const commandModules = [
  pingCommand,
  kbbCommand,
];

function getCommandsJson() {
  const seen = new Set();
  const commands = [];

  for (const command of commandModules) {
    if (!command?.data?.toJSON) continue;
    const json = command.data.toJSON();
    const name = String(json.name || "").toLowerCase();
    if (!name || seen.has(name)) continue;

    seen.add(name);
    commands.push(json);
  }

  return commands;
}

function validateEnv() {
  if (!TOKEN) throw new Error("DISCORD_TOKEN missing in environment.");
  if (!CLIENT_ID) throw new Error("CLIENT_ID missing in environment.");
}

const rest = new REST({ version: "10" }).setToken(TOKEN || "missing-token");

export async function registerCommandsForGuild(guildId) {
  validateEnv();
  if (!guildId) return false;

  const commands = getCommandsJson();
  console.log(`🔄 Registering ${commands.length} guild slash commands for ${guildId}...`);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, guildId),
    { body: commands }
  );

  console.log(`✅ Guild slash commands registered for ${guildId}.`);
  return true;
}

export async function registerGlobalCommands() {
  validateEnv();

  const commands = getCommandsJson();
  console.log(`🌍 Registering ${commands.length} global slash commands...`);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );

  console.log("✅ Global slash commands registered. They may take a while to appear.");
  return true;
}

export async function registerConfiguredCommands(client = null) {
  validateEnv();

  if (GUILD_ID) {
    return registerCommandsForGuild(GUILD_ID);
  }

  const guildIds = client?.guilds?.cache?.map(guild => guild.id) || [];
  if (guildIds.length) {
    for (const guildId of guildIds) {
      await registerCommandsForGuild(guildId);
    }
    return true;
  }

  return registerGlobalCommands();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  registerConfiguredCommands()
    .catch(error => {
      console.error("❌ Failed to register slash commands:", error);
      process.exit(1);
    });
}
