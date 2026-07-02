import { SlashCommandBuilder } from "discord.js";
import { buildKbbEmbed } from "../utils/embeds.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the KBB bot is online"),

  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const wsPing = Math.round(interaction.client.ws.ping);

    const embed = buildKbbEmbed({
      title: "🏓 Pong",
      description: [
        "Der **KBB Bot** ist online.",
        "",
        `**Antwortzeit:** ${latency} ms`,
        `**WebSocket:** ${wsPing} ms`,
      ].join("\n"),
    });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
