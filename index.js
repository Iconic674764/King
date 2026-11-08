require("dotenv").config();

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionsBitField
} = require("discord.js");
const Database = require("better-sqlite3");

const PREFIX = ".";
const db = new Database("poker-bot.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rules TEXT NOT NULL,
  ends_at INTEGER NOT NULL,
  codes TEXT NOT NULL,
  next_code INTEGER NOT NULL DEFAULT 0,
  registered INTEGER NOT NULL DEFAULT 0,
  channel_id TEXT,
  message_id TEXT,
  host_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  poker_name TEXT NOT NULL,
  assigned_code TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournament_id, user_id)
);
`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const getWallet = db.prepare("SELECT points FROM wallets WHERE user_id = ?");
const ensureWallet = db.prepare("INSERT OR IGNORE INTO wallets (user_id, points) VALUES (?, 0)");
const txInsert = db.prepare(
  "INSERT INTO transactions (user_id, actor_id, amount, reason) VALUES (?, ?, ?, ?)"
);

function walletBalance(userId) {
  ensureWallet.run(userId);
  return getWallet.get(userId).points;
}

function addPoints(userId, actorId, amount, reason) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Amount must be a positive whole number.");
  const run = db.transaction(() => {
    ensureWallet.run(userId);
    db.prepare("UPDATE wallets SET points = points + ? WHERE user_id = ?").run(amount, userId);
    txInsert.run(userId, actorId, amount, reason);
  });
  run();
  return walletBalance(userId);
}

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

function parseDuration(value) {
  const match = /^(\d+)(m|h|d)$/i.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const unit = match[2].toLowerCase();
  const ms = n * (unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000);
  if (ms > 30 * 86_400_000) return null;
  return Date.now() + ms;
}

function formatRemaining(timestamp) {
  const seconds = Math.max(0, Math.floor((timestamp - Date.now()) / 1000));
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function tournamentEmbed(t) {
  const codes = JSON.parse(t.codes);
  const ended = t.ends_at <= Date.now();
  return new EmbedBuilder()
    .setColor(0x14532d)
    .setTitle(`♠️ ${t.title}`)
    .setDescription(t.description)
    .addFields(
      { name: "⚠️ Rules", value: t.rules.slice(0, 1024) || "No special rules set." },
      { name: "⏰ Ends", value: ended ? "Ended" : `In ${formatRemaining(t.ends_at)}`, inline: true },
      { name: "👥 Registered", value: String(t.registered), inline: true },
      { name: "🎟️ Codes", value: `${codes.length} available`, inline: true },
      { name: "Host", value: `<@${t.host_id}>`, inline: true },
      { name: "Entry", value: "Free — non-cash points tournament", inline: true }
    )
    .setFooter({ text: `Tournament #${t.id} • Points have no cash value` })
    .setTimestamp();
}

function tournamentButtons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`t_join_${id}`).setLabel("Join Tournament").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`t_view_${id}`).setLabel("View Details").setStyle(ButtonStyle.Secondary)
  );
}

async function sendLog(guild, embed) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`logs_${guild.id}`);
  if (!row) return;
  const channel = await guild.channels.fetch(row.value).catch(() => null);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX)) return;
  const [command, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = command.toLowerCase();

  if (cmd === "wallet") {
    const balance = walletBalance(message.author.id);
    const recent = db.prepare(
      "SELECT amount, reason, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 5"
    ).all(message.author.id);
    const history = recent.length
      ? recent.map(x => `• +${x.amount} points — ${x.reason} (${x.created_at} UTC)`).join("\n")
      : "No transactions yet.";
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎟️ Points Wallet")
      .setDescription(`**Balance:** ${balance.toLocaleString()} points\n\n**Last 5 transactions**\n${history}`)
      .setFooter({ text: "Points are non-redeemable and have no cash value." });
    return message.reply({ embeds: [embed] });
  }

  if (cmd === "add") {
    if (!isAdmin(message.member)) return message.reply("❌ Only server admins can use this command.");
    const target = message.mentions.users.first();
    const amount = Number(args[1]);
    if (!target || !Number.isSafeInteger(amount) || amount <= 0) {
      return message.reply("Usage: `.add @user 500`");
    }
    const balance = addPoints(target.id, message.author.id, amount, "Admin points added");
    await message.reply(`✅ Added **${amount.toLocaleString()} points** to ${target}. New balance: **${balance.toLocaleString()} points**.`);
    const log = new EmbedBuilder().setColor(0x2ecc71).setTitle("Points Added")
      .addFields(
        { name: "User", value: `${target.tag} (${target.id})` },
        { name: "Admin", value: `${message.author.tag} (${message.author.id})` },
        { name: "Amount", value: `${amount} points`, inline: true },
        { name: "New balance", value: `${balance} points`, inline: true }
      ).setTimestamp();
    await sendLog(message.guild, log);
    return;
  }

  if (cmd === "settings") {
    if (!isAdmin(message.member)) return message.reply("❌ Only server admins can use settings.");
    const current = db.prepare("SELECT value FROM settings WHERE key = ?").get(`logs_${message.guild.id}`);
    return message.reply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⚙️ Bot Settings")
        .setDescription(`**Logs channel:** ${current ? `<#${current.value}>` : "Not configured"}\n\nSet it with \`.setlogs #channel\`.\n\nPoints are non-cash and cannot be withdrawn.`)]
    });
  }

  if (cmd === "setlogs") {
    if (!isAdmin(message.member)) return message.reply("❌ Only server admins can change settings.");
    const channel = message.mentions.channels.first();
    if (!channel || channel.type !== ChannelType.GuildText) return message.reply("Usage: `.setlogs #channel`");
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(`logs_${message.guild.id}`, channel.id);
    return message.reply(`✅ Logs channel set to ${channel}.`);
  }

  if (cmd === "poker") {
    if (!isAdmin(message.member)) return message.reply("❌ Only server admins can create tournaments.");
    const embed = new EmbedBuilder().setColor(0x14532d).setTitle("♠️ Poker Tournament Control Panel")
      .setDescription("Create a free-entry tournament. Players receive one code each in join order.\n\nPoints are non-redeemable and have no cash value.");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("t_create").setLabel("Create Tournament").setStyle(ButtonStyle.Success)
    );
    return message.reply({ embeds: [embed], components: [row] });
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === "t_create") {
      if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) &&
          !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: "Only admins can create tournaments.", ephemeral: true });
      }
      const modal = new ModalBuilder().setCustomId("t_create_modal").setTitle("Create Tournament");
      const fields = [
        ["title", "Tournament title", TextInputStyle.Short, true, 100, "POKER TOURNAMENT #1"],
        ["description", "Description", TextInputStyle.Paragraph, true, 1000, "Tournament details..."],
        ["rules", "Rules", TextInputStyle.Paragraph, true, 1000, "Be respectful. One account per player."],
        ["duration", "Duration (e.g. 1h, 1d, 30m)", TextInputStyle.Short, true, 10, "1h"],
        ["codes", "Join codes (one per line, max 4000 chars)", TextInputStyle.Paragraph, true, 4000, "CODE1\nCODE2\nCODE3"]
      ];
      for (const [id, label, style, required, max, placeholder] of fields) {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)
            .setRequired(required).setMaxLength(max).setPlaceholder(placeholder)
        ));
      }
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "t_create_modal") {
      const title = interaction.fields.getTextInputValue("title").trim();
      const description = interaction.fields.getTextInputValue("description").trim();
      const rules = interaction.fields.getTextInputValue("rules").trim();
      const endsAt = parseDuration(interaction.fields.getTextInputValue("duration"));
      const codes = interaction.fields.getTextInputValue("codes").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!endsAt) return interaction.reply({ content: "Invalid duration. Use 10m, 1h, or 1d (maximum 30d).", ephemeral: true });
      if (!codes.length) return interaction.reply({ content: "Add at least one join code.", ephemeral: true });
      const uniqueCodes = [...new Set(codes)];
      const result = db.prepare(
        "INSERT INTO tournaments (title, description, rules, ends_at, codes, host_id, channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(title, description, rules, endsAt, JSON.stringify(uniqueCodes), interaction.user.id, interaction.channelId);
      const t = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(result.lastInsertRowid);
      const published = await interaction.channel.send({ embeds: [tournamentEmbed(t)], components: [tournamentButtons(t.id)] });
      db.prepare("UPDATE tournaments SET message_id = ? WHERE id = ?").run(published.id, t.id);
      await interaction.reply({ content: `✅ Tournament #${t.id} published.`, ephemeral: true });
      await sendLog(interaction.guild, new EmbedBuilder().setColor(0x3498db).setTitle("Tournament Published")
        .setDescription(`**${title}**\nHost: ${interaction.user}\nMessage: ${published.url}`).setTimestamp());
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("t_join_")) {
      const id = Number(interaction.customId.split("_")[2]);
      const t = db.prepare("SELECT * FROM tournaments WHERE id = ? AND active = 1").get(id);
      if (!t || t.ends_at <= Date.now()) return interaction.reply({ content: "This tournament has ended or is unavailable.", ephemeral: true });
      if (db.prepare("SELECT 1 FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(id, interaction.user.id)) {
        return interaction.reply({ content: "You have already joined this tournament.", ephemeral: true });
      }
      const codes = JSON.parse(t.codes);
      if (t.next_code >= codes.length) return interaction.reply({ content: "All join codes have been assigned. Contact the host.", ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`t_join_modal_${id}`).setTitle("Join Tournament")
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("poker_name").setLabel("Your PokerNow username")
            .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(64)
        ));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("t_join_modal_")) {
      const id = Number(interaction.customId.split("_")[3]);
      const t = db.prepare("SELECT * FROM tournaments WHERE id = ? AND active = 1").get(id);
      if (!t || t.ends_at <= Date.now()) return interaction.reply({ content: "This tournament has ended.", ephemeral: true });
      if (db.prepare("SELECT 1 FROM tournament_entries WHERE tournament_id = ? AND user_id = ?").get(id, interaction.user.id)) {
        return interaction.reply({ content: "You have already joined.", ephemeral: true });
      }
      const codes = JSON.parse(t.codes);
      if (t.next_code >= codes.length) return interaction.reply({ content: "No codes remain. Contact the host.", ephemeral: true });
      const pokerName = interaction.fields.getTextInputValue("poker_name").trim();
      const code = codes[t.next_code];
      const run = db.transaction(() => {
        db.prepare("INSERT INTO tournament_entries (tournament_id, user_id, poker_name, assigned_code) VALUES (?, ?, ?, ?)")
          .run(id, interaction.user.id, pokerName, code);
        db.prepare("UPDATE tournaments SET next_code = next_code + 1, registered = registered + 1 WHERE id = ?").run(id);
      });
      run();
      const updated = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
      await interaction.reply({
        content: `✅ You are registered!\n**Poker username:** ${pokerName}\n**Your private join code:** \`${code}\`\n**Tournament:** <#${t.channel_id}>`,
        ephemeral: true
      });
      const channel = await interaction.guild.channels.fetch(updated.channel_id).catch(() => null);
      if (channel?.isTextBased() && updated.message_id) {
        const msg = await channel.messages.fetch(updated.message_id).catch(() => null);
        if (msg) await msg.edit({ embeds: [tournamentEmbed(updated)], components: [tournamentButtons(id)] }).catch(() => {});
      }
      await sendLog(interaction.guild, new EmbedBuilder().setColor(0x2ecc71).setTitle("Tournament Registration")
        .addFields(
          { name: "Player", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "Poker username", value: pokerName },
          { name: "Tournament", value: `#${id} — ${updated.title}` },
          { name: "Code number", value: String(updated.next_code), inline: true }
        ).setTimestamp());
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("t_view_")) {
      const id = Number(interaction.customId.split("_")[2]);
      const t = db.prepare("SELECT * FROM tournaments WHERE id = ?").get(id);
      if (!t) return interaction.reply({ content: "Tournament not found.", ephemeral: true });
      const entry = db.prepare("SELECT poker_name, assigned_code FROM tournament_entries WHERE tournament_id = ? AND user_id = ?")
        .get(id, interaction.user.id);
      const embed = tournamentEmbed(t);
      if (entry) {
        embed.addFields({ name: "Your private details", value: `Poker username: **${entry.poker_name}**\nYour code: \`${entry.assigned_code}\`\n\nUse this code on the host's PokerNow table.` });
      } else {
        embed.addFields({ name: "Your registration", value: "You have not joined this tournament yet." });
      }
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    console.error(error);
    const msg = { content: "Something went wrong. Please try again or contact an admin.", ephemeral: true };
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply(msg).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
