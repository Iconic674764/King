require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require("discord.js");

const Database = require("better-sqlite3");
const http = require("http");

// ===============================
// RENDER HTTP SERVER
// ===============================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain"
    });
    return res.end("Poker Bot is Online!");
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP Server running on port ${PORT}`);
});

// ===============================
// DATABASE
// ===============================

const db = new Database("poker-bot.sqlite");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY,
  points INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  admin_id TEXT,
  amount INTEGER,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  description TEXT,
  rules TEXT,
  ends_at INTEGER,
  codes TEXT,
  next_code INTEGER DEFAULT 0,
  registered INTEGER DEFAULT 0,
  host_id TEXT,
  channel_id TEXT,
  message_id TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id INTEGER,
  user_id TEXT,
  poker_name TEXT,
  assigned_code TEXT,
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tournament_id, user_id)
);
`);

// ===============================
// DISCORD CLIENT
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===============================
// WALLET FUNCTIONS
// ===============================

function ensureWallet(userId) {
  db.prepare(`
    INSERT OR IGNORE INTO wallets (user_id, points)
    VALUES (?, 0)
  `).run(userId);
}

function getBalance(userId) {
  ensureWallet(userId);

  return db.prepare(`
    SELECT points FROM wallets WHERE user_id = ?
  `).get(userId).points;
}

function addPoints(userId, adminId, amount, reason) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Invalid points amount");
  }

  const transaction = db.transaction(() => {
    ensureWallet(userId);

    db.prepare(`
      UPDATE wallets
      SET points = points + ?
      WHERE user_id = ?
    `).run(amount, userId);

    db.prepare(`
      INSERT INTO transactions
      (user_id, admin_id, amount, reason)
      VALUES (?, ?, ?, ?)
    `).run(userId, adminId, amount, reason);
  });

  transaction();

  return getBalance(userId);
}

// ===============================
// ADMIN CHECK
// ===============================

function isAdmin(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  ) || member.permissions.has(
    PermissionsBitField.Flags.ManageGuild
  );
}

// ===============================
// LOG SYSTEM
// ===============================

async function sendLog(guild, embed) {
  const setting = db.prepare(`
    SELECT value FROM settings
    WHERE key = ?
  `).get(`logs_${guild.id}`);

  if (!setting) return;

  const channel = await guild.channels
    .fetch(setting.value)
    .catch(() => null);

  if (channel && channel.isTextBased()) {
    await channel.send({
      embeds: [embed]
    }).catch(console.error);
  }
}

// ===============================
// TIMER FUNCTIONS
// ===============================

function parseDuration(value) {
  const match = /^(\d+)(m|h|d)$/i.exec(value.trim());

  if (!match) return null;

  const number = Number(match[1]);

  if (!Number.isSafeInteger(number) || number <= 0) {
    return null;
  }

  const unit = match[2].toLowerCase();

  let milliseconds;

  if (unit === "m") {
    milliseconds = number * 60000;
  } else if (unit === "h") {
    milliseconds = number * 3600000;
  } else {
    milliseconds = number * 86400000;
  }

  if (milliseconds > 30 * 86400000) {
    return null;
  }

  return Date.now() + milliseconds;
}

function getRemainingTime(endTime) {
  const remaining = Math.max(
    0,
    Math.floor((endTime - Date.now()) / 1000)
  );

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;

  return `${minutes}m ${seconds}s`;
}
// ===============================
// TOURNAMENT EMBED
// ===============================

function createTournamentEmbed(t) {
  const codes = JSON.parse(t.codes);

  const ended = t.ends_at <= Date.now();

  return new EmbedBuilder()
    .setColor("#07552B")
    .setTitle(`♠️ ${t.title}`)
    .setDescription(t.description)
    .addFields(
      {
        name: "⚠️ Rules",
        value: t.rules || "No special rules",
        inline: false
      },
      {
        name: "🎁 Prize",
        value: "Points leaderboard",
        inline: true
      },
      {
        name: "⏰ Ends",
        value: ended
          ? "Tournament Ended"
          : getRemainingTime(t.ends_at),
        inline: true
      },
      {
        name: "👥 Registered",
        value: `${t.registered} players`,
        inline: true
      },
      {
        name: "🎟️ Available Codes",
        value: `${Math.max(0, codes.length - t.next_code)}`,
        inline: true
      },
      {
        name: "Host",
        value: `<@${t.host_id}>`,
        inline: true
      }
    )
    .setFooter({
      text: `POKER TOURNAMENT #${t.id} | Free Entry`
    })
    .setTimestamp();
}

// ===============================
// TOURNAMENT BUTTONS
// ===============================

function createTournamentButtons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_${id}`)
      .setLabel("Join Tournament")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),

    new ButtonBuilder()
      .setCustomId(`view_${id}`)
      .setLabel("View Details")
      .setStyle(ButtonStyle.Secondary)
  );
}

// ===============================
// BOT READY
// ===============================

client.once("ready", () => {
  console.log("--------------------------------");
  console.log(`Bot Online: ${client.user.tag}`);
  console.log(`Servers: ${client.guilds.cache.size}`);
  console.log("--------------------------------");
});

// ===============================
// PREFIX COMMANDS
// ===============================

client.on("messageCreate", async message => {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content.startsWith(".")) return;

  const args = message.content
    .slice(1)
    .trim()
    .split(/\s+/);

  const command = args.shift()?.toLowerCase();

  // =============================
  // WALLET COMMAND
  // =============================

  if (command === "wallet") {
    const balance = getBalance(message.author.id);

    const history = db.prepare(`
      SELECT amount, reason, created_at
      FROM transactions
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 5
    `).all(message.author.id);

    const historyText = history.length
      ? history.map(x =>
          `• +${x.amount} points — ${x.reason}`
        ).join("\n")
      : "No transactions yet.";

    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("🎟️ Your Points Wallet")
      .setThumbnail(message.author.displayAvatarURL())
      .addFields(
        {
          name: "💰 Current Balance",
          value: `**${balance.toLocaleString()} Points**`
        },
        {
          name: "📜 Last 5 Transactions",
          value: historyText
        }
      )
      .setFooter({
        text: "Points have no cash or withdrawal value."
      });

    return message.reply({
      embeds: [embed]
    });
  }

  // =============================
  // ADMIN ADD POINTS
  // =============================

  if (command === "add") {
    if (!isAdmin(message.member)) {
      return message.reply(
        "❌ Only administrators can add points."
      );
    }

    const target = message.mentions.users.first();
    const amount = Number(args[1]);

    if (
      !target ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      return message.reply(
        "Usage: `.add @user 500`"
      );
    }

    if (target.bot) {
      return message.reply(
        "❌ You cannot add points to a bot."
      );
    }

    const balance = addPoints(
      target.id,
      message.author.id,
      amount,
      "Admin points added"
    );

    const embed = new EmbedBuilder()
      .setColor("#2ECC71")
      .setTitle("✅ Points Added")
      .addFields(
        {
          name: "User",
          value: `${target.tag}`
        },
        {
          name: "Admin",
          value: `${message.author.tag}`
        },
        {
          name: "Added",
          value: `${amount} points`,
          inline: true
        },
        {
          name: "New Balance",
          value: `${balance} points`,
          inline: true
        }
      )
      .setTimestamp();

    await message.reply({
      embeds: [embed]
    });

    await sendLog(
      message.guild,
      embed
    );

    return;
  }

  // =============================
  // SETTINGS COMMAND
  // =============================

  if (command === "settings") {
    if (!isAdmin(message.member)) {
      return message.reply(
        "❌ Admin permission required."
      );
    }

    const logs = db.prepare(`
      SELECT value FROM settings
      WHERE key = ?
    `).get(`logs_${message.guild.id}`);

    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("⚙️ Bot Settings")
      .setDescription(
        `**Logs Channel:** ${
          logs ? `<#${logs.value}>` : "Not configured"
        }\n\nUse:\n\`.setlogs #channel\``
      );

    return message.reply({
      embeds: [embed]
    });
  }

  // =============================
  // SET LOGS CHANNEL
  // =============================

  if (command === "setlogs") {
    if (!isAdmin(message.member)) {
      return message.reply(
        "❌ Admin permission required."
      );
    }

    const channel = message.mentions.channels.first();

    if (
      !channel ||
      channel.type !== ChannelType.GuildText
    ) {
      return message.reply(
        "Usage: `.setlogs #channel`"
      );
    }

    db.prepare(`
      INSERT OR REPLACE INTO settings
      (key, value)
      VALUES (?, ?)
    `).run(
      `logs_${message.guild.id}`,
      channel.id
    );

    return message.reply(
      `✅ Logs channel saved: ${channel}`
    );
  }

  // =============================
  // POKER CONTROL PANEL
  // =============================

  if (command === "poker") {
    if (!isAdmin(message.member)) {
      return message.reply(
        "❌ Only administrators can host tournaments."
      );
    }

    const embed = new EmbedBuilder()
      .setColor("#07552B")
      .setTitle("♠️ Poker Tournament Control Panel")
      .setDescription(
        "Create and publish your free-entry tournament.\n\n" +
        "Click the button below to configure:\n" +
        "• Tournament title\n" +
        "• Description\n" +
        "• Rules\n" +
        "• Ending timer\n" +
        "• Sequential joining codes"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("create_tournament")
        .setLabel("Create Tournament")
        .setEmoji("♠️")
        .setStyle(ButtonStyle.Success)
    );

    return message.reply({
      embeds: [embed],
      components: [row]
    });
  }
});

// ===============================
// END OF PART 2
// ===============================
// ===============================
// INTERACTION SYSTEM
// ===============================

client.on("interactionCreate", async interaction => {
  try {

    // =============================
    // CREATE TOURNAMENT BUTTON
    // =============================

    if (
      interaction.isButton() &&
      interaction.customId === "create_tournament"
    ) {
      if (!interaction.memberPermissions?.has(
        PermissionsBitField.Flags.Administrator
      ) && !interaction.memberPermissions?.has(
        PermissionsBitField.Flags.ManageGuild
      )) {
        return interaction.reply({
          content: "❌ Admin permission required.",
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId("create_tournament_modal")
        .setTitle("Create Poker Tournament");

      const title = new TextInputBuilder()
        .setCustomId("title")
        .setLabel("Tournament Title")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true);

      const description = new TextInputBuilder()
        .setCustomId("description")
        .setLabel("Tournament Description")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true);

      const rules = new TextInputBuilder()
        .setCustomId("rules")
        .setLabel("Tournament Rules")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(true);

      const duration = new TextInputBuilder()
        .setCustomId("duration")
        .setLabel("Duration (1h, 30m, 1d)")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(10)
        .setRequired(true);

      const codes = new TextInputBuilder()
        .setCustomId("codes")
        .setLabel("Codes (one code per line)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(description),
        new ActionRowBuilder().addComponents(rules),
        new ActionRowBuilder().addComponents(duration),
        new ActionRowBuilder().addComponents(codes)
      );

      return interaction.showModal(modal);
    }

    // =============================
    // CREATE TOURNAMENT MODAL
    // =============================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "create_tournament_modal"
    ) {
      if (!interaction.memberPermissions?.has(
        PermissionsBitField.Flags.Administrator
      ) && !interaction.memberPermissions?.has(
        PermissionsBitField.Flags.ManageGuild
      )) {
        return interaction.reply({
          content: "❌ Admin permission required.",
          ephemeral: true
        });
      }

      const title = interaction.fields
        .getTextInputValue("title").trim();

      const description = interaction.fields
        .getTextInputValue("description").trim();

      const rules = interaction.fields
        .getTextInputValue("rules").trim();

      const duration = interaction.fields
        .getTextInputValue("duration").trim();

      const endsAt = parseDuration(duration);

      if (!endsAt) {
        return interaction.reply({
          content: "❌ Invalid duration. Example: 30m, 1h, 1d. Maximum 30 days.",
          ephemeral: true
        });
      }

      const codes = interaction.fields
        .getTextInputValue("codes")
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

      const uniqueCodes = [...new Set(codes)];

      if (uniqueCodes.length === 0) {
        return interaction.reply({
          content: "❌ Please add at least one code.",
          ephemeral: true
        });
      }

      const result = db.prepare(`
        INSERT INTO tournaments
        (
          title,
          description,
          rules,
          ends_at,
          codes,
          host_id,
          channel_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        title,
        description,
        rules,
        endsAt,
        JSON.stringify(uniqueCodes),
        interaction.user.id,
        interaction.channelId
      );

      const tournamentId = Number(result.lastInsertRowid);

      const tournament = db.prepare(`
        SELECT * FROM tournaments
        WHERE id = ?
      `).get(tournamentId);

      const published = await interaction.channel.send({
        embeds: [
          createTournamentEmbed(tournament)
        ],
        components: [
          createTournamentButtons(tournamentId)
        ]
      });

      db.prepare(`
        UPDATE tournaments
        SET message_id = ?
        WHERE id = ?
      `).run(published.id, tournamentId);

      await interaction.reply({
        content: `✅ Tournament #${tournamentId} published successfully!`,
        ephemeral: true
      });

      await sendLog(
        interaction.guild,
        new EmbedBuilder()
          .setColor("#2ECC71")
          .setTitle("Tournament Published")
          .setDescription(
            `**${title}**\nHost: ${interaction.user}\n${published.url}`
          )
          .setTimestamp()
      );

      return;
    }

    // =============================
    // JOIN TOURNAMENT BUTTON
    // =============================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("join_")
    ) {
      const id = Number(
        interaction.customId.split("_")[1]
      );

      const tournament = db.prepare(`
        SELECT * FROM tournaments
        WHERE id = ? AND active = 1
      `).get(id);

      if (!tournament) {
        return interaction.reply({
          content: "❌ Tournament not found.",
          ephemeral: true
        });
      }

      if (tournament.ends_at <= Date.now()) {
        return interaction.reply({
          content: "⏰ This tournament has ended.",
          ephemeral: true
        });
      }

      const existing = db.prepare(`
        SELECT 1 FROM tournament_entries
        WHERE tournament_id = ? AND user_id = ?
      `).get(id, interaction.user.id);

      if (existing) {
        return interaction.reply({
          content: "❌ You have already joined this tournament.",
          ephemeral: true
        });
      }

      const codes = JSON.parse(tournament.codes);

      if (tournament.next_code >= codes.length) {
        return interaction.reply({
          content: "❌ All tournament codes have been assigned.",
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`join_modal_${id}`)
        .setTitle("Join Poker Tournament");

      const pokerName = new TextInputBuilder()
        .setCustomId("poker_name")
        .setLabel("Your PokerNow Username")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(64)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(pokerName)
      );

      return interaction.showModal(modal);
    }

    // =============================
    // JOIN TOURNAMENT MODAL
    // =============================

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("join_modal_")
    ) {
      const id = Number(
        interaction.customId.replace("join_modal_", "")
      );

      const pokerName = interaction.fields
        .getTextInputValue("poker_name").trim();

      if (!pokerName) {
        return interaction.reply({
          content: "Please enter your PokerNow username.",
          ephemeral: true
        });
      }

      const registerPlayer = db.transaction(() => {
        const tournament = db.prepare(`
          SELECT * FROM tournaments
          WHERE id = ? AND active = 1
        `).get(id);

        if (!tournament || tournament.ends_at <= Date.now()) {
          throw new Error("ENDED");
        }

        const existing = db.prepare(`
          SELECT 1 FROM tournament_entries
          WHERE tournament_id = ? AND user_id = ?
        `).get(id, interaction.user.id);

        if (existing) {
          throw new Error("ALREADY_JOINED");
        }

        const codes = JSON.parse(tournament.codes);

        if (tournament.next_code >= codes.length) {
          throw new Error("NO_CODES");
        }

        const code = codes[tournament.next_code];

        db.prepare(`
          INSERT INTO tournament_entries
          (
            tournament_id,
            user_id,
            poker_name,
            assigned_code
          )
          VALUES (?, ?, ?, ?)
        `).run(
          id,
          interaction.user.id,
          pokerName,
          code
        );

        db.prepare(`
          UPDATE tournaments
          SET next_code = next_code + 1,
              registered = registered + 1
          WHERE id = ?
        `).run(id);

        return {
          code,
          tournament
        };
      });

      let registration;

      try {
        registration = registerPlayer();
      } catch (error) {
        const messages = {
          ENDED: "⏰ Tournament has ended.",
          ALREADY_JOINED: "❌ You have already joined.",
          NO_CODES: "❌ No joining codes remain."
        };

        return interaction.reply({
          content: messages[error.message] ||
            "❌ Registration failed. Please try again.",
          ephemeral: true
        });
      }

      const updated = db.prepare(`
        SELECT * FROM tournaments
        WHERE id = ?
      `).get(id);

      // PRIVATE PLAYER DETAILS

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#2ECC71")
            .setTitle("✅ Tournament Registration Successful")
            .addFields(
              {
                name: "Poker Username",
                value: pokerName
              },
              {
                name: "Your Private Joining Code",
                value: `\`${registration.code}\``
              },
              {
                name: "Tournament",
                value: updated.title
              },
              {
                name: "Instructions",
                value:
                  "Open the tournament's PokerNow table and use the code provided by the host."
              }
            )
            .setFooter({
              text: "Keep your joining code private."
            })
        ],
        ephemeral: true
      });

      // UPDATE PUBLIC TOURNAMENT EMBED

      const channel = await interaction.guild.channels
        .fetch(updated.channel_id)
        .catch(() => null);

      if (channel && updated.message_id) {
        const msg = await channel.messages
          .fetch(updated.message_id)
          .catch(() => null);

        if (msg) {
          await msg.edit({
            embeds: [
              createTournamentEmbed(updated)
            ],
            components: [
              createTournamentButtons(id)
            ]
          }).catch(console.error);
        }
      }

      // REGISTRATION LOG

      await sendLog(
        interaction.guild,
        new EmbedBuilder()
          .setColor("#2ECC71")
          .setTitle("New Tournament Registration")
          .addFields(
            {
              name: "Discord User",
              value: `${interaction.user.tag}`
            },
            {
              name: "Poker Username",
              value: pokerName
            },
            {
              name: "Tournament",
              value: updated.title
            },
            {
              name: "Registration Number",
              value: `${updated.registered}`
            }
          )
          .setTimestamp()
      );

      return;
    }

    // =============================
    // VIEW DETAILS BUTTON
    // =============================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("view_")
    ) {
      const id = Number(
        interaction.customId.split("_")[1]
      );

      const tournament = db.prepare(`
        SELECT * FROM tournaments
        WHERE id = ?
      `).get(id);

      if (!tournament) {
        return interaction.reply({
          content: "Tournament not found.",
          ephemeral: true
        });
      }

      const entry = db.prepare(`
        SELECT poker_name, assigned_code
        FROM tournament_entries
        WHERE tournament_id = ? AND user_id = ?
      `).get(id, interaction.user.id);

      const embed = createTournamentEmbed(tournament);

      if (entry) {
        embed.addFields({
          name: "🔐 Your Private Details",
          value:
            `Poker username: **${entry.poker_name}**\n` +
            `Your joining code: \`${entry.assigned_code}\``
        });
      } else {
        embed.addFields({
          name: "Registration",
          value: "You have not joined this tournament."
        });
      }

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

  } catch (error) {
    console.error("Interaction Error:", error);

    if (interaction.isRepliable()) {
      const response = {
        content: "❌ Something went wrong. Contact an administrator.",
        ephemeral: true
      };

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
});

// ===============================
// LOGIN
// ===============================

if (!process.env.DISCORD_TOKEN) {
  console.error("ERROR: DISCORD_TOKEN is missing!");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

// ===============================
// END OF INDEX.JS
// ===============================
