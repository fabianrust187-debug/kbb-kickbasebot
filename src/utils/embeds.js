import { EmbedBuilder } from "discord.js";

const DEFAULT_COLOR = 0x00ff66;

export function getEmbedColor() {
  const raw = String(process.env.KBB_EMBED_COLOR || "").trim();
  if (!raw) return DEFAULT_COLOR;

  const normalized = raw.startsWith("#") ? raw.replace("#", "0x") : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : DEFAULT_COLOR;
}

export function buildKbbEmbed({ title, description, color = getEmbedColor(), footer = "187 KICKBASEBANDE • KBB Bot" }) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footer })
    .setTimestamp();
}

export function buildErrorEmbed(description) {
  return buildKbbEmbed({
    title: "❌ Fehler",
    description,
    color: 0xed4245,
    footer: "KBB Bot • Error",
  });
}

export function buildSuccessEmbed(title, description) {
  return buildKbbEmbed({
    title,
    description,
    color: 0x57f287,
    footer: "KBB Bot • Success",
  });
}
