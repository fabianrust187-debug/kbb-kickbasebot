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
import { addManager, getManagers, removeManager } from "../utils/managerStore.js";
import { publishMissingTop5 } from "../utils/top5Deadline.js";
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

function getTop5ChannelId(guildId) {
  const settings = getGuildSettings(guildId);
  return settings.top5ChannelId || TOP5_CHANNEL_ID;
}

function isTop5Channel(interaction) {
  return String(interaction.channelId || "") === String(getTop5ChannelId(interaction.guildId));
}

function normalizeNickname(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeDiscordText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/([*_~`>|])/g, "\\$1");
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
    "• **Abgabefrist ist Montag um 22:00 Uhr.**",
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
  const managers = getManagers(interaction.guildId);
  const top5ChannelId = getTop5ChannelId(interaction.guildId);
  return buildKbbEmbed({
    title: `⚽ ${LEAGUE_INFO.name} | Saison ${LEAGUE_INFO.season}`,
    description: [
      `• **Start:** ${LEAGUE_INFO.startDate}`,
      `• **Manager:** ${LEAGUE_INFO.managers}`,
      `• **Startkapital:** ${LEAGUE_INFO.startCapital}`,
      `• **Einsatz:** ${LEAGUE_INFO.entryFee}`,
      `• **Zahlung:** ${LEAGUE_INFO.payment}`,
      `• **Top-5-Frist:** Montag, 22:00 Uhr`,
      "",
      "**Discord Setup**",
      `• Managerliste: **${managers.length}/${TOP5_TARGET}**`,
      `• Rules Channel: ${settings.rulesChannelId ? `<#${settings.rulesChannelId}>` : "nicht gesetzt"}`,
      `• Announcement Channel: ${settings.announcementChannelId ? `<#${settings.announcementChannelId}>` : "nicht gesetzt"}`,
      `• Top-5-Abgabe Channel: <#${top5ChannelId}>`,
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
  const managers = getManagers(interaction.guildId);
  return buildKbbEmbed({
    title: "📊 Top-5-Abgabe Status",
    description: [
      `**Abgegeben:** ${submissions.length}/${TOP5_TARGET}`,
      `**Managerliste:** ${managers.length}/${TOP5_TARGET}`,
      `**Frist:** Montag, 22:00 Uhr`,
      "",
      submissions.length
        ? submissions.map((entry, index) => `**${index + 1}.** <@${entry.userId}> — **${entry.playerName}**`).join("\n")
        : "Noch keine Abgaben gespeichert.",
      managers.length < TOP5_TARGET
        ? `\n⚠️ ${TOP5_TARGET - managers.length} Teilnehmer noch nicht in der Managerliste. Die Fristprüfung funktioniert trotzdem.`
        : "",
    ].filter(Boolean).join("\n"),
  });
}

async function runHelp(interaction) {
  const top5ChannelId = getTop5ChannelId(interaction.guildId);
  const embed = buildKbbEmbed({
    title: "📘 KBB Bot Help",
    description: [
      "**Commands**",
      "• `/ping` — Bot-Status prüfen",
      "• `/kbb help` — Übersicht anzeigen",
      "• `/kbb rules` — Regelwerk anzeigen",
      "• `/kbb league` — Liga-Infos anzeigen",
      "• `/kbb name` — Kickbase-Namen in einem privaten Fenster eintragen",
      "• `/kbb top5` — private Top-5-Abgabe starten",
      "• `/kbb top5-status` — Abgabestand anzeigen",
      "• `/kbb top5-missing` — Fristprüfung manuell posten *(Admin)*",
      "• `/kbb top5-reset` — neue Top-5-Runde starten *(Admin)*",
      "• `/kbb manager-add` — Manager zur Teilnehmerliste hinzufügen *(Admin)*",
      "• `/kbb manager-remove` — Manager entfernen *(Admin)*",
      "• `/kbb manager-list` — Teilnehmerliste anzeigen",
      "• `/kbb setup` — Channels setzen *(Admin)*",
      "",
      `**Top-5-Abgabe Channel:** <#${top5ChannelId}>`,
      "**Automatische Fristprüfung:** jeden Montag um **22:00 Uhr (Europe/Berlin)**.",
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
  const modal = new ModalBuilder()
    .setCustomId(`kbb_name_submit:${interaction.guildId}:${interaction.user.id}`)
    .setTitle("Kickbase-Namen eintragen");
  const input = new TextInputBuilder()
    .setCustomId("kickbase_name")
    .setLabel("Wie heißt du bei Kickbase?")
    .setPlaceholder("z. B. Vegetarox")
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(32)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

async function runTop5(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  const top5ChannelId = getTop5ChannelId(interaction.guildId);
  if (!isTop5Channel(interaction)) return interaction.reply({ content: `❌ Top-5-Abgaben sind nur in <#${top5ChannelId}> möglich.`, ephemeral: true });

  const managers = getManagers(interaction.guildId);
  const registered = managers.some(manager => manager.userId === interaction.user.id);
  if (!registered) {
    if (managers.length >= TOP5_TARGET) {
      return interaction.reply({ content: "❌ Die KBB-Managerliste ist bereits vollständig und du bist dort nicht eingetragen.", ephemeral: true });
    }

    const added = addManager(interaction.guildId, interaction.user, interaction.user);
    if (!added.ok && !added.duplicate) {
      return interaction.reply({ content: "❌ Deine Top-5-Abgabe konnte nicht vorbereitet werden. Bitte kurz bei der Ligaleitung melden.", ephemeral: true });
    }
  }

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

async function runTop5Missing(interaction) {
  if (!interaction.guildId || !interaction.guild) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!hasManageServerPermission(interaction)) return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const closeRound = interaction.options.getBoolean("runde_abschliessen") || false;
  const result = await publishMissingTop5(interaction.guild, { automatic: false, resetAfter: closeRound });

  if (!result.ok) {
    return interaction.editReply({ embeds: [buildErrorEmbed(result.error || "Fristprüfung fehlgeschlagen.")] });
  }

  return interaction.editReply({
    embeds: [buildSuccessEmbed(
      "✅ Top-5-Fristprüfung gepostet",
      closeRound
        ? "Die Auswertung wurde im Top-5-Channel veröffentlicht und die nächste Runde wurde gestartet."
        : "Die Auswertung wurde im Top-5-Channel veröffentlicht. Die aktuelle Runde bleibt geöffnet.",
    )],
  });
}

async function runTop5Reset(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!hasManageServerPermission(interaction)) return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });
  const result = resetTop5Round(interaction.guildId, interaction.user);
  if (!result.ok) return interaction.reply({ embeds: [buildErrorEmbed(result.error || "Reset fehlgeschlagen.")], ephemeral: true });
  return interaction.reply({ embeds: [buildSuccessEmbed("🔄 Top-5-Runde zurückgesetzt", `Neue Runde gestartet. Channel: <#${getTop5ChannelId(interaction.guildId)}>`)], ephemeral: true });
}

async function runManagerAdd(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!hasManageServerPermission(interaction)) return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });

  const user = interaction.options.getUser("user", true);
  if (user.bot) return interaction.reply({ embeds: [buildErrorEmbed("Bots können nicht als Manager eingetragen werden.")], ephemeral: true });

  const current = getManagers(interaction.guildId);
  if (current.some(manager => manager.userId === user.id)) {
    return interaction.reply({ embeds: [buildErrorEmbed(`${user} ist bereits in der Managerliste.`)], ephemeral: true });
  }
  if (current.length >= TOP5_TARGET) {
    return interaction.reply({ embeds: [buildErrorEmbed(`Die Managerliste ist bereits voll (${TOP5_TARGET}/${TOP5_TARGET}).`)], ephemeral: true });
  }

  const result = addManager(interaction.guildId, user, interaction.user);
  if (!result.ok) return interaction.reply({ embeds: [buildErrorEmbed(result.error || "Manager konnte nicht gespeichert werden.")], ephemeral: true });

  const count = getManagers(interaction.guildId).length;
  return interaction.reply({ embeds: [buildSuccessEmbed("✅ Manager eingetragen", `${user} wurde zur KBB-Managerliste hinzugefügt. **${count}/${TOP5_TARGET}**`)], ephemeral: true });
}

async function runManagerRemove(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!hasManageServerPermission(interaction)) return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });

  const user = interaction.options.getUser("user", true);
  const result = removeManager(interaction.guildId, user.id);
  if (!result.ok) return interaction.reply({ embeds: [buildErrorEmbed(result.error || "Manager konnte nicht entfernt werden.")], ephemeral: true });

  const count = getManagers(interaction.guildId).length;
  return interaction.reply({ embeds: [buildSuccessEmbed("✅ Manager entfernt", `${user} wurde aus der KBB-Managerliste entfernt. **${count}/${TOP5_TARGET}**`)], ephemeral: true });
}

async function runManagerList(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  const managers = getManagers(interaction.guildId);
  const embed = buildKbbEmbed({
    title: "👥 KBB Managerliste",
    description: [
      `**Stand:** ${managers.length}/${TOP5_TARGET}`,
      "",
      managers.length
        ? managers.map((manager, index) => `**${index + 1}.** <@${manager.userId}>`).join("\n")
        : "Noch keine Manager hinterlegt.",
      "",
      managers.length === TOP5_TARGET
        ? "✅ Managerliste vollständig."
        : `⚠️ Es fehlen noch **${TOP5_TARGET - managers.length}** Einträge. Die Fristprüfung läuft trotzdem; nicht hinterlegte Teilnehmer können nur nicht namentlich ausgewertet werden.`,
    ].join("\n"),
  });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function runSetup(interaction) {
  if (!interaction.guildId) return interaction.reply({ embeds: [buildErrorEmbed("Nur auf einem Server nutzbar.")], ephemeral: true });
  if (!hasManageServerPermission(interaction)) return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst Manage Server oder Administrator.")], ephemeral: true });

  const rulesChannel = interaction.options.getChannel("rules_channel");
  const announcementChannel = interaction.options.getChannel("announcement_channel");
  const top5Channel = interaction.options.getChannel("top5_channel");
  const payload = {};

  if (rulesChannel) payload.rulesChannelId = rulesChannel.id;
  if (announcementChannel) payload.announcementChannelId = announcementChannel.id;
  if (top5Channel) payload.top5ChannelId = top5Channel.id;
  if (!Object.keys(payload).length) return interaction.reply({ embeds: [buildErrorEmbed("Bitte mindestens einen Channel auswählen.")], ephemeral: true });

  const ok = setGuildSettings(interaction.guildId, payload);
  if (!ok) return interaction.reply({ embeds: [buildErrorEmbed("Setup konnte nicht gespeichert werden.")], ephemeral: true });

  const settings = getGuildSettings(interaction.guildId);
  return interaction.reply({
    embeds: [buildSuccessEmbed("✅ KBB Setup gespeichert", [
      `**Rules Channel:** ${settings.rulesChannelId ? `<#${settings.rulesChannelId}>` : "nicht gesetzt"}`,
      `**Announcement Channel:** ${settings.announcementChannelId ? `<#${settings.announcementChannelId}>` : "nicht gesetzt"}`,
      `**Top-5-Abgabe Channel:** <#${settings.top5ChannelId || TOP5_CHANNEL_ID}>`,
    ].join("\n"))],
    ephemeral: true,
  });
}

async function handleNameModalSubmit(interaction) {
  const [, guildId, userId] = String(interaction.customId || "").split(":");
  if (guildId !== interaction.guildId || userId !== interaction.user.id) {
    await interaction.reply({ content: "❌ Dieses Namensformular gehört nicht zu dir.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  const nickname = normalizeNickname(interaction.fields.getTextInputValue("kickbase_name"));
  if (nickname.length < 2 || nickname.length > 32) {
    await interaction.editReply({ embeds: [buildErrorEmbed("Der Kickbase-Name muss zwischen 2 und 32 Zeichen lang sein.")] });
    return true;
  }

  const botMember = interaction.guild?.members.me || await interaction.guild?.members.fetchMe().catch(() => null);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageNicknames)) {
    await interaction.editReply({ embeds: [buildErrorEmbed("Mir fehlt die Discord-Berechtigung **Nicknames verwalten**.")] });
    return true;
  }

  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply({ embeds: [buildErrorEmbed("Dein Server-Profil konnte nicht geladen werden.")] });
    return true;
  }
  if (!member.manageable) {
    await interaction.editReply({ embeds: [buildErrorEmbed("Ich kann deinen Server-Nickname nicht ändern. Vermutlich steht deine Rolle über meiner Bot-Rolle oder du bist Server-Owner.")] });
    return true;
  }

  const previousName = member.displayName;
  const changed = await member.setNickname(nickname, "KBB Kickbase nickname sync").then(() => true).catch(() => false);
  if (!changed) {
    await interaction.editReply({ embeds: [buildErrorEmbed("Nickname konnte nicht geändert werden. Bitte Bot-Rolle und Berechtigungen prüfen.")] });
    return true;
  }

  await interaction.channel?.send({
    content: `🔄 <@${interaction.user.id}> hieß vorher **${escapeDiscordText(previousName)}** und heißt jetzt **${escapeDiscordText(nickname)}**.`,
    allowedMentions: { users: [interaction.user.id], parse: [] },
  }).catch(() => null);

  await interaction.editReply({ embeds: [buildSuccessEmbed("✅ Server-Nickname gesetzt", `Dein Name auf diesem Discord-Server wurde auf **${nickname}** gesetzt.`)] });
  return true;
}

async function handleTop5ModalSubmit(interaction) {
  const [, guildId, userId] = String(interaction.customId || "").split(":");
  if (guildId !== interaction.guildId || userId !== interaction.user.id) {
    await interaction.reply({ content: "❌ Diese Top-5-Abgabe gehört nicht zu dir.", ephemeral: true });
    return true;
  }
  const top5ChannelId = getTop5ChannelId(interaction.guildId);
  if (!isTop5Channel(interaction)) {
    await interaction.reply({ content: `❌ Top-5-Abgaben sind nur in <#${top5ChannelId}> möglich.`, ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  const playerName = interaction.fields.getTextInputValue("player_name");
  const result = addTop5Submission(interaction.guildId, interaction.user, playerName, null, TOP5_TARGET);

  if (!result.ok) {
    const message = result.duplicate
      ? `✅ Du hast bereits **${result.submission.playerName}** abgegeben.`
      : `❌ ${result.error || "Speichern fehlgeschlagen."}`;
    await interaction.editReply({ content: message });
    return true;
  }

  await interaction.channel?.send({ content: `Manager: ${interaction.user} hat **${result.submission.playerName}** abgegeben.` }).catch(() => null);
  if (result.complete) await interaction.channel?.send({ embeds: [buildTop5SummaryEmbed(result.submissions)] }).catch(() => null);
  await interaction.editReply({ content: `✅ Abgabe gespeichert: **${result.submission.playerName}** (${result.count}/${result.target})` });
  return true;
}

export default {
  data: new SlashCommandBuilder()
    .setName("kbb")
    .setDescription("187 KICKBASEBANDE league commands")
    .addSubcommand(sub => sub.setName("help").setDescription("KBB Bot Hilfe anzeigen"))
    .addSubcommand(sub => sub.setName("rules").setDescription("Regelwerk anzeigen"))
    .addSubcommand(sub => sub.setName("league").setDescription("Liga-Informationen anzeigen"))
    .addSubcommand(sub => sub.setName("name").setDescription("Kickbase-Namen über privates Fenster eintragen"))
    .addSubcommand(sub => sub.setName("top5").setDescription("Private Top-5-Abgabe starten"))
    .addSubcommand(sub => sub.setName("top5-status").setDescription("Top-5-Abgabestand anzeigen"))
    .addSubcommand(sub => sub
      .setName("top5-missing")
      .setDescription("Fehlende oder verspätete Top-5-Abgaben öffentlich ausgeben")
      .addBooleanOption(option => option
        .setName("runde_abschliessen")
        .setDescription("Nach der Ausgabe direkt eine neue Top-5-Runde starten")
        .setRequired(false)))
    .addSubcommand(sub => sub.setName("top5-reset").setDescription("Top-5-Runde zurücksetzen"))
    .addSubcommand(sub => sub
      .setName("manager-add")
      .setDescription("Manager zur Teilnehmerliste hinzufügen")
      .addUserOption(option => option.setName("user").setDescription("Discord-Mitglied").setRequired(true)))
    .addSubcommand(sub => sub
      .setName("manager-remove")
      .setDescription("Manager aus der Teilnehmerliste entfernen")
      .addUserOption(option => option.setName("user").setDescription("Discord-Mitglied").setRequired(true)))
    .addSubcommand(sub => sub.setName("manager-list").setDescription("KBB-Managerliste anzeigen"))
    .addSubcommand(sub => sub
      .setName("setup")
      .setDescription("KBB Server-Channels konfigurieren")
      .addChannelOption(option => option.setName("rules_channel").setDescription("Channel für Regeln").addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addChannelOption(option => option.setName("announcement_channel").setDescription("Channel für Ankündigungen").addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addChannelOption(option => option.setName("top5_channel").setDescription("Channel für Top-5-Abgaben und Fristmeldungen").addChannelTypes(ChannelType.GuildText).setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false) || "help";
    if (sub === "help") return runHelp(interaction);
    if (sub === "rules") return runRules(interaction);
    if (sub === "league") return runLeague(interaction);
    if (sub === "name") return runName(interaction);
    if (sub === "top5") return runTop5(interaction);
    if (sub === "top5-status") return runTop5Status(interaction);
    if (sub === "top5-missing") return runTop5Missing(interaction);
    if (sub === "top5-reset") return runTop5Reset(interaction);
    if (sub === "manager-add") return runManagerAdd(interaction);
    if (sub === "manager-remove") return runManagerRemove(interaction);
    if (sub === "manager-list") return runManagerList(interaction);
    if (sub === "setup") return runSetup(interaction);
    return runHelp(interaction);
  },

  async handleModalSubmit(interaction) {
    if (interaction.customId?.startsWith("kbb_name_submit:")) return handleNameModalSubmit(interaction);
    if (interaction.customId?.startsWith("kbb_top5_submit:")) return handleTop5ModalSubmit(interaction);
    return false;
  },
};
