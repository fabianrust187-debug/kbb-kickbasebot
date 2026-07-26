import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { buildErrorEmbed, buildKbbEmbed, buildSuccessEmbed } from "../utils/embeds.js";
import { getGuildSettings, setGuildSettings } from "../utils/guildSettings.js";
import {
  addTop5Submission,
  getTop5SubmissionForUser,
  getTop5Submissions,
  resetTop5Round,
} from "../utils/top5Store.js";

const LEAGUE_INFO = {
  name: "187 KICKBASEBANDE",
  season: "26/27",
  startDate: "28.07.",
  managers: 14,
  startCapital: "Team + 50 Mio",
  entryFee: "20 €",
  payment: "paypal.me/Vegetarox",
};

const TOP5_CHANNEL_ID = process.env.TOP5_CHANNEL_ID || "1522249357179617331";
const TOP5_TARGET = Number(process.env.TOP5_MANAGER_TARGET || LEAGUE_INFO.managers || 14);

function hasManageServerPermission(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function isTop5Channel(interaction) {
  return String(interaction.channelId || "") === String(TOP5_CHANNEL_ID);
}

function normalizeNickname(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitDescription(text, maxLength = 3900) {
  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLength) {
      chunks.push(current.trim());
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function buildRulesDescription() {
  return [
    `# 🟢 ${LEAGUE_INFO.name} | Saison ${LEAGUE_INFO.season}`,
    "",
    `**Start:** ${LEAGUE_INFO.startDate}`,
    `**Manager:** ${LEAGUE_INFO.managers}`,
    `**Startkapital:** ${LEAGUE_INFO.startCapital}`,
    `**Einsatz:** ${LEAGUE_INFO.entryFee}`,
    "",
    "## 📜 Regeln",
    "",
    "### 👥 Kader",
    "• Maximal **16 Spieler** im Kader.",
    "• Maximal **3 Spieler pro Bundesliga-Verein**.",
    "",
    "### 💰 Transfers",
    "• **Underpay ist verboten.** Kein Spieler darf unter Marktwert verkauft werden.",
    "• Jeder Manager muss pro Spieltag einen eigenen **Top-5-Spieler** abgeben.",
    "• Top-5 bedeutet: die 5 Spieler im eigenen Team, die an diesem Spieltag die meisten Punkte gemacht haben.",
    "",
    "### ⚖️ Fairplay",
    "Nicht erlaubt sind Absprachen, Pushen, Marktmanipulation, Beleidigungen und bewusstes Ausnutzen von Schlupflöchern.",
    "",
    "### 🚫 Ausschluss",
    "Ausschluss möglich bei Inaktivität über 3 Spieltage, wiederholten Regelverstößen oder schweren Fairplay-Verstößen.",
    "",
    "### 💬 Kommunikation",
    "Die komplette Liga-Kommunikation läuft über diesen Discord-Server.",
  ].join("\n");
}

function buildLeagueEmbed(interaction) {
  const settings = getGuildSettings(interaction.guildId);
  return buildKbbEmbed({
    title: `⚽ ${LEAGUE_INFO.name} | Saison ${LEAGUE_INFO.season}`,
    description: [
      `• **Start:** ${LEAGUE_INFO.startDate}`,
      `• **Manager:** ${LEAGUE_INFO.managers}`,
      `• **Startkapital:** ${LEAGUE_INFO.startCapital}`,
      `• **Einsatz:** ${LEAGUE_INFO.entryFee}`,
      `• **Zahlung:** ${LEAGUE_INFO.payment}`,
      "",
      "**Discord Setup**",
      `• Rules Channel: ${settings.rulesChannelId ? `<#${settings.rulesChannelId}>` : "nicht gesetzt"}`,
      `• Announcement Channel: ${settings.announcementChannelId ? `<#${settings.announcementChannelId}>` : "nicht gesetzt"}`,
      `• Top-5-Abgabe Channel: <#${TOP5_CHANNEL_ID}>`,
    ].join("\n"),
  });
}

function buildTop5SummaryEmbed(submissions) {
  const list = submissions.map((entry, index) => (
    `**${index + 1}.** <@${entry.userId}> — **${entry.playerName}** *(MW: noch nicht verfügbar)*`
  ));

  return buildKbbEmbed({
    title: "✅ Top-5-Abgabe komplett",
    description: [
      `Alle **${TOP5_TARGET} Manager** haben ihre Top-5-Abgabe eingetragen.`,
      "",
      "## 📋 Zusammenfassung",
      ...list,
      "",
      "Kickbase-Marktwerte sind vorbereitet, aber noch nicht automatisch angebunden.",
    ].join("\n"),
    footer: "187 KICKBASEBANDE • Top-5-Abgabe",
  });
}

function buildTop5StatusEmbed(interaction) {
  const submissions = getTop5Submissions(interaction.guildId);
  return buildKbbEmbed({
    title: "📊 Top-5-Abgabe Status",
    description: [
      `**Abgegeben:** ${submissions.length}/${TOP5_TARGET}`,
      "",
      submissions.length
        ? submissions.map((entry, index) => `**${index + 1}.** <@${entry.userId}> — **${entry.playerName}**`).join("\n")
        : "Noch keine Abgaben gespeichert.",
    ].join("\n"),
  });
}

async function runHelp(interaction) {
  const embed = buildKbbEmbed({
    title: "📘 KBB Bot Help",
    description: [
      "**Commands**",
      "• `/ping` — Bot-Status prüfen",
      "• `/kbb help` — Übersicht anzeigen",
      "• `/kbb rules` — Regelwerk anzeigen",
      "• `/kbb league` — Liga-Infos anzeigen",
      "• `/kbb name nickname:<Kickbase-Name>` — Discord-Nickname setzen",
      "• `/kbb setup` — Channels setzen",
      "• `/kbb top5` — private Top-5-Abgabe starten",
      "• `/kbb top5-status` — Abgabestand anzeigen",
      "• `/kbb top5-reset` — neue Top-5-Runde starten",
      "",
      `**Top-5-Abgabe Channel:** <#${TOP5_CHANNEL_ID}>`,
    ].join("\n"),
  });

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function runRules(interaction) {
  const embeds = splitDescription(buildRulesDescription()).map((description, index) => buildKbbEmbed({
    title: index === 0 ? "📜 KBB Regelwerk" : `📜 KBB Regelwerk — Teil ${index + 1}`,
    description,
  }));

  return interaction.reply({ embeds, ephemeral: false });
}

async function runLeague(interaction) {
  return interaction.reply({ embeds: [buildLeagueEmbed(interaction)], ephemeral: true });
}

async function runName(interaction) {
  if (!interaction.guildId || !interaction.guild) {
    return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  }

  const nickname = normalizeNickname(interaction.options.getString("nickname", true));
  if (nickname.length < 2 || nickname.length > 32) {
    return interaction.reply({ embeds: [buildErrorEmbed("Der Kickbase-Name muss zwischen 2 und 32 Zeichen lang sein.")], ephemeral: true });
  }

  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageNicknames)) {
    return interaction.reply({
      embeds: [buildErrorEmbed("Mir fehlt die Discord-Berechtigung **Nicknames verwalten**.")],
      ephemeral: true,
    });
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return interaction.reply({ embeds: [buildErrorEmbed("Dein Server-Profil konnte nicht geladen werden.")], ephemeral: true });
  }

  if (!member.manageable) {
    return interaction.reply({
      embeds: [buildErrorEmbed("Ich kann deinen Nickname nicht ändern. Vermutlich steht deine Rolle über meiner Bot-Rolle oder du bist Server-Owner.")],
      ephemeral: true,
    });
  }

  await member.setNickname(nickname, "KBB Kickbase nickname sync").catch(async () => {
    await interaction.reply({ embeds: [buildErrorEmbed("Nickname konnte nicht geändert werden. Bitte Bot-Rolle und Berechtigungen prüfen.")], ephemeral: true });
  });

  if (interaction.replied) return null;

  return interaction.reply({
    embeds: [buildSuccessEmbed("✅ Nickname gesetzt", `Dein Discord-Name wurde auf **${nickname}** gesetzt.`)],
    ephemeral: true,
  });
}

async function runTop5(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!isTop5Channel(interaction)) return interaction.reply({ content: `❌ Top-5-Abgaben sind nur in <#${TOP5_CHANNEL_ID}> möglich.`, ephemeral: true });

  const existing = getTop5SubmissionForUser(interaction.guildId, interaction.user.id);
  if (existing) return interaction.reply({ content: `✅ Du hast bereits **${existing.playerName}** abgegeben.`, ephemeral: true });

  const modal = new ModalBuilder()
    .setCustomId(`kbb_top5_submit:${interaction.guildId}:${interaction.user.id}`)
    .setTitle("Top-5-Spieler abgeben");

  const input = new TextInputBuilder()
    .setCustomId("player_name")
    .setLabel("Welchen Spieler gibst du ab?")
    .setPlaceholder("z.B. Manuel Neuer")
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(80)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function runTop5Status(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  return interaction.reply({ embeds: [buildTop5StatusEmbed(interaction)], ephemeral: true });
}

async function runTop5Reset(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!hasManageServerPermission(interaction)) return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });

  const result = resetTop5Round(interaction.guildId, interaction.user);
  if (!result.ok) return interaction.reply({ embeds: [buildErrorEmbed(result.error || "Reset fehlgeschlagen.")], ephemeral: true });

  return interaction.reply({ embeds: [buildSuccessEmbed("🔄 Top-5-Runde zurückgesetzt", `Neue Runde gestartet. Channel: <#${TOP5_CHANNEL_ID}>`)], ephemeral: true });
}

async function runSetup(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!hasManageServerPermission(interaction)) return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });

  const rulesChannel = interaction.options.getChannel("rules_channel");
  const announcementChannel = interaction.options.getChannel("announcement_channel");
  const payload = {};

  if (rulesChannel) payload.rulesChannelId = rulesChannel.id;
  if (announcementChannel) payload.announcementChannelId = announcementChannel.id;
  if (!Object.keys(payload).length) return interaction.reply({ embeds: [buildErrorEmbed("Bitte mindestens einen Channel auswählen.")], ephemeral: true });

  const ok = setGuildSettings(interaction.guildId, payload);
  if (!ok) return interaction.reply({ embeds: [buildErrorEmbed("Setup konnte nicht gespeichert werden.")], ephemeral: true });

  const settings = getGuildSettings(interaction.guildId);
  return interaction.reply({
    embeds: [buildSuccessEmbed("✅ KBB Setup gespeichert", [
      `**Rules Channel:** ${settings.rulesChannelId ? `<#${settings.rulesChannelId}>` : "nicht gesetzt"}`,
      `**Announcement Channel:** ${settings.announcementChannelId ? `<#${settings.announcementChannelId}>` : "nicht gesetzt"}`,
      `**Top-5-Abgabe Channel:** <#${TOP5_CHANNEL_ID}>`,
    ].join("\n"))],
    ephemeral: true,
  });
}

async function handleTop5ModalSubmit(interaction) {
  const [, guildId, userId] = String(interaction.customId || "").split(":");
  if (guildId !== interaction.guildId || userId !== interaction.user.id) {
    await interaction.reply({ content: "❌ Diese Top-5-Abgabe gehört nicht zu dir.", ephemeral: true });
    return true;
  }
  if (!isTop5Channel(interaction)) {
    await interaction.reply({ content: `❌ Top-5-Abgaben sind nur in <#${TOP5_CHANNEL_ID}> möglich.`, ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const playerName = interaction.fields.getTextInputValue("player_name");
  const result = addTop5Submission(interaction.guildId, interaction.user, playerName, null, TOP5_TARGET);

  if (!result.ok) {
    const message = result.duplicate ? `✅ Du hast bereits **${result.submission.playerName}** abgegeben.` : `❌ ${result.error || "Speichern fehlgeschlagen."}`;
    await interaction.editReply({ content: message });
    return true;
  }

  await interaction.channel?.send({ content: `Manager: ${interaction.user} hat **${result.submission.playerName}** abgegeben.` }).catch(() => null);

  if (result.complete) {
    await interaction.channel?.send({ embeds: [buildTop5SummaryEmbed(result.submissions)] }).catch(() => null);
  }

  await interaction.editReply({ content: `✅ Abgabe gespeichert: **${result.submission.playerName}** (${result.count}/${result.target})` });
  return true;
}

export default {
  data: new SlashCommandBuilder()
    .setName("kbb")
    .setDescription("187 KICKBASEBANDE league commands")
    .addSubcommand(sub => sub.setName("help").setDescription("Show KBB bot help"))
    .addSubcommand(sub => sub.setName("rules").setDescription("Post the rulebook"))
    .addSubcommand(sub => sub.setName("league").setDescription("Show league information"))
    .addSubcommand(sub => sub
      .setName("name")
      .setDescription("Set your Discord nickname to your Kickbase name")
      .addStringOption(option => option
        .setName("nickname")
        .setDescription("Your Kickbase account name")
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(32)))
    .addSubcommand(sub => sub.setName("top5").setDescription("Private Top-5 player submission"))
    .addSubcommand(sub => sub.setName("top5-status").setDescription("Show Top-5 submission progress"))
    .addSubcommand(sub => sub.setName("top5-reset").setDescription("Reset Top-5 submissions"))
    .addSubcommand(sub => sub
      .setName("setup")
      .setDescription("Configure KBB server channels")
      .addChannelOption(option => option.setName("rules_channel").setDescription("Channel for league rules").addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addChannelOption(option => option.setName("announcement_channel").setDescription("Channel for league announcements").addChannelTypes(ChannelType.GuildText).setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false) || "help";
    if (sub === "help") return runHelp(interaction);
    if (sub === "rules") return runRules(interaction);
    if (sub === "league") return runLeague(interaction);
    if (sub === "name") return runName(interaction);
    if (sub === "setup") return runSetup(interaction);
    if (sub === "top5") return runTop5(interaction);
    if (sub === "top5-status") return runTop5Status(interaction);
    if (sub === "top5-reset") return runTop5Reset(interaction);
    return runHelp(interaction);
  },

  async handleModalSubmit(interaction) {
    if (!interaction.customId?.startsWith("kbb_top5_submit:")) return false;
    return handleTop5ModalSubmit(interaction);
  },
};