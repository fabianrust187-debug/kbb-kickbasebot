import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { buildErrorEmbed, buildKbbEmbed, buildSuccessEmbed } from "../utils/embeds.js";
import { getGuildSettings, setGuildSettings } from "../utils/guildSettings.js";

const LEAGUE_INFO = {
  name: "187 KICKBASEBANDE",
  season: "26/27",
  startDate: "28.07.",
  managers: 14,
  startCapital: "Team + 50 Mio",
  entryFee: "20 €",
  payment: "paypal.me/Vegetarox",
};

function hasManageServerPermission(interaction) {
  return !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function buildRulesDescription() {
  return [
    `# 🟢 ${LEAGUE_INFO.name} | Saison ${LEAGUE_INFO.season}`,
    "",
    `Willkommen in der **${LEAGUE_INFO.name}**.`,
    "",
    `Wir spielen die kommende **Bundesliga-Saison ${LEAGUE_INFO.season}** mit **${LEAGUE_INFO.managers} Managern**, klaren Regeln und diesem Discord-Server als zentrale Anlaufstelle.`,
    "",
    "---",
    "",
    "## 📌 Liga-Infos",
    "",
    `**Saison:** ${LEAGUE_INFO.season}`,
    `**Ligastart:** ${LEAGUE_INFO.startDate}`,
    `**Manager:** ${LEAGUE_INFO.managers} Manager`,
    `**Startkapital:** ${LEAGUE_INFO.startCapital}`,
    `**Einsatz:** ${LEAGUE_INFO.entryFee}`,
    `**Zahlung:** ${LEAGUE_INFO.payment}`,
    "",
    "---",
    "",
    "# 📜 Regelwerk",
    "",
    "## 👥 Kaderregeln",
    "",
    "### 1. Maximale Kadergröße",
    "Jeder Manager darf maximal **16 Spieler im Kader** haben.",
    "",
    "Wer diese Grenze überschreitet, muss seinen Kader schnellstmöglich wieder auf maximal 16 Spieler reduzieren.",
    "",
    "### 2. Maximal 3 Spieler pro Verein",
    "Pro Bundesliga-Verein dürfen maximal **3 Spieler** im eigenen Kader stehen.",
    "",
    "Beispiele: maximal **3 Bayern-Spieler**, maximal **3 Dortmund-Spieler**, maximal **3 Leverkusen-Spieler** usw.",
    "",
    "## 💰 Transferregeln",
    "",
    "### 3. Kein Underpay",
    "**Underpay ist verboten.**",
    "",
    "Underpay bedeutet bei uns: Es darf **kein Spieler unter Marktwert verkauft werden**.",
    "",
    "Ein Spieler muss mindestens zum aktuellen **Marktwert** verkauft werden. Verkäufe unter Marktwert sind nicht erlaubt und können bestraft werden.",
    "",
    "### 4. Verkauf eines eigenen Top-5-Spielers pro Spieltag",
    "Jeder Manager muss an jedem Spieltag **einen eigenen Top-5-Spieler verkaufen**.",
    "",
    "Mit **Top-5-Spieler** sind nicht die wertvollsten Spieler gemeint, sondern die **5 Spieler im eigenen Team, die an diesem Spieltag die meisten Punkte gemacht haben**.",
    "",
    "Aus diesen Top 5 muss nach dem Spieltag **ein Spieler verkauft werden**.",
    "",
    "## ⚖️ Fairplay & Verhalten",
    "",
    "Alle Manager spielen fair, aktiv und respektvoll.",
    "",
    "Nicht erlaubt sind:",
    "• Absprachen zum Vorteil einzelner Manager",
    "• absichtliches Pushen anderer Teams",
    "• Marktmanipulation",
    "• Verkäufe unter Marktwert",
    "• Beleidigungen oder respektloses Verhalten",
    "• bewusstes Ausnutzen von Schlupflöchern",
    "",
    "## 🟨 Strafen",
    "",
    "Ein genauer **Strafenkatalog folgt**.",
    "",
    "Mögliche Strafen können sein:",
    "• Verwarnung",
    "• Geldstrafe",
    "• Pflichtverkauf",
    "• interne Sanktionen",
    "• Ausschluss aus der Liga",
    "",
    "Die Ligaleitung entscheidet je nach Fall und Schwere des Verstoßes.",
    "",
    "## 🚫 Ausschluss",
    "",
    "Ein Ausschluss kann erfolgen bei:",
    "• **Inaktivität über 3 Spieltage**",
    "• wiederholten Regelverstößen",
    "• schweren Fairplay-Verstößen",
    "• verweigerter Kommunikation mit der Ligaleitung",
    "",
    "Wer länger nicht aktiv sein kann, muss sich rechtzeitig bei der Ligaleitung melden.",
    "",
    "## 💬 Kommunikation",
    "",
    "Die komplette Liga-Kommunikation läuft über diesen **Discord-Server**.",
    "",
    "Jeder Manager ist dafür verantwortlich, regelmäßig in den Discord zu schauen.",
    "",
    "## ✅ Ziel der Liga",
    "",
    "Unser Ziel ist eine aktive, faire und kompetitive Kickbase-Liga mit zuverlässigen Managern, klaren Regeln und langfristigem Spielspaß.",
    "",
    "Viel Erfolg an alle Manager. 🔥",
  ].join("\n");
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

function buildLeagueEmbed(interaction) {
  const settings = getGuildSettings(interaction.guildId);
  return buildKbbEmbed({
    title: `⚽ ${LEAGUE_INFO.name} | Saison ${LEAGUE_INFO.season}`,
    description: [
      "**Liga-Übersicht**",
      "",
      `• **Saison:** ${LEAGUE_INFO.season}`,
      `• **Start:** ${LEAGUE_INFO.startDate}`,
      `• **Manager:** ${LEAGUE_INFO.managers}`,
      `• **Startkapital:** ${LEAGUE_INFO.startCapital}`,
      `• **Einsatz:** ${LEAGUE_INFO.entryFee}`,
      `• **Zahlung:** ${LEAGUE_INFO.payment}`,
      "",
      "**Discord Setup**",
      `• Rules Channel: ${settings.rulesChannelId ? `<#${settings.rulesChannelId}>` : "nicht gesetzt"}`,
      `• Announcement Channel: ${settings.announcementChannelId ? `<#${settings.announcementChannelId}>` : "nicht gesetzt"}`,
    ].join("\n"),
  });
}

async function runHelp(interaction) {
  const embed = buildKbbEmbed({
    title: "📘 KBB Bot Help",
    description: [
      "Der **KBB Bot** verwaltet Basisinformationen für die **187 KICKBASEBANDE**.",
      "",
      "**Commands**",
      "• `/ping` — Bot-Status prüfen",
      "• `/kbb help` — diese Übersicht anzeigen",
      "• `/kbb rules` — Regelwerk anzeigen",
      "• `/kbb league` — Liga-Infos anzeigen",
      "• `/kbb setup` — Rules-/Announcement-Channel setzen *(Manage Server)*",
      "",
      "Weitere Module folgen: Strafenkatalog, Top-5-Erinnerung, Managerliste und Spieltagsverwaltung.",
    ].join("\n"),
  });

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function runRules(interaction) {
  const descriptions = splitDescription(buildRulesDescription());
  const embeds = descriptions.map((description, index) => buildKbbEmbed({
    title: index === 0 ? "📜 KBB Regelwerk" : `📜 KBB Regelwerk — Teil ${index + 1}`,
    description,
  }));

  return interaction.reply({ embeds, ephemeral: false });
}

async function runLeague(interaction) {
  return interaction.reply({ embeds: [buildLeagueEmbed(interaction)], ephemeral: true });
}

async function runSetup(interaction) {
  if (!interaction.guildId) {
    return interaction.reply({ embeds: [buildErrorEmbed("Dieser Command kann nur auf einem Server genutzt werden.")], ephemeral: true });
  }

  if (!hasManageServerPermission(interaction)) {
    return interaction.reply({ embeds: [buildErrorEmbed("Du brauchst **Manage Server** oder **Administrator**, um das KBB Setup zu ändern.")], ephemeral: true });
  }

  const rulesChannel = interaction.options.getChannel("rules_channel");
  const announcementChannel = interaction.options.getChannel("announcement_channel");

  const payload = {};
  if (rulesChannel) payload.rulesChannelId = rulesChannel.id;
  if (announcementChannel) payload.announcementChannelId = announcementChannel.id;

  if (!Object.keys(payload).length) {
    return interaction.reply({ embeds: [buildErrorEmbed("Bitte mindestens einen Channel auswählen.")], ephemeral: true });
  }

  const ok = setGuildSettings(interaction.guildId, payload);
  if (!ok) {
    return interaction.reply({ embeds: [buildErrorEmbed("Setup konnte nicht gespeichert werden.")], ephemeral: true });
  }

  const settings = getGuildSettings(interaction.guildId);
  const embed = buildSuccessEmbed("✅ KBB Setup gespeichert", [
    "Das Server-Setup wurde gespeichert.",
    "",
    `**Rules Channel:** ${settings.rulesChannelId ? `<#${settings.rulesChannelId}>` : "nicht gesetzt"}`,
    `**Announcement Channel:** ${settings.announcementChannelId ? `<#${settings.announcementChannelId}>` : "nicht gesetzt"}`,
  ].join("\n"));

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

export default {
  data: new SlashCommandBuilder()
    .setName("kbb")
    .setDescription("187 KICKBASEBANDE league commands")
    .addSubcommand(sub => sub
      .setName("help")
      .setDescription("Show KBB bot help"))
    .addSubcommand(sub => sub
      .setName("rules")
      .setDescription("Post the 187 KICKBASEBANDE rulebook"))
    .addSubcommand(sub => sub
      .setName("league")
      .setDescription("Show league information"))
    .addSubcommand(sub => sub
      .setName("setup")
      .setDescription("Configure KBB server channels")
      .addChannelOption(option => option
        .setName("rules_channel")
        .setDescription("Channel for league rules")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))
      .addChannelOption(option => option
        .setName("announcement_channel")
        .setDescription("Channel for league announcements")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false) || "help";

    if (sub === "help") return runHelp(interaction);
    if (sub === "rules") return runRules(interaction);
    if (sub === "league") return runLeague(interaction);
    if (sub === "setup") return runSetup(interaction);

    return runHelp(interaction);
  },
};
