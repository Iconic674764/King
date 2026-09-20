require("dotenv").config();

const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("Discord bot is online.");
});

server.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});
require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

// =====================================================
// RENDER WEB SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("Discord bot is online.");
});

server.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// =====================================================
// FILES
// =====================================================

const TAG_CONFIG_FILE = path.join(
  __dirname,
  "tagconfig.json"
);

const GIVEAWAY_FILE = path.join(
  __dirname,
  "giveaways.json"
);

// =====================================================
// TAG CONFIG
// =====================================================

function loadTagConfig() {
  try {
    if (!fs.existsSync(TAG_CONFIG_FILE)) {
      fs.writeFileSync(
        TAG_CONFIG_FILE,
        "{}"
      );

      return {};
    }

    return JSON.parse(
      fs.readFileSync(
        TAG_CONFIG_FILE,
        "utf8"
      )
    );
  } catch (error) {
    console.error(
      "Tag config error:",
      error
    );

    return {};
  }
}

const config = loadTagConfig();

function saveTagConfig() {
  fs.writeFileSync(
    TAG_CONFIG_FILE,
    JSON.stringify(
      config,
      null,
      2
    )
  );
}

function getGuildConfig(guildId) {
  if (!config[guildId]) {
    config[guildId] = {
      tag: null,
      roleId: null
    };

    saveTagConfig();
  }

  return config[guildId];
}

// =====================================================
// GIVEAWAY DATA
// =====================================================

function loadGiveaways() {
  try {
    if (!fs.existsSync(GIVEAWAY_FILE)) {
      fs.writeFileSync(
        GIVEAWAY_FILE,
        "[]"
      );

      return [];
    }

    return JSON.parse(
      fs.readFileSync(
        GIVEAWAY_FILE,
        "utf8"
      )
    );
  } catch (error) {
    console.error(
      "Giveaway data error:",
      error
    );

    return [];
  }
}

let giveaways = loadGiveaways();

function saveGiveaways() {
  fs.writeFileSync(
    GIVEAWAY_FILE,
    JSON.stringify(
      giveaways,
      null,
      2
    )
  );
}

const giveawayTimers = new Map();

// =====================================================
// TIME PARSER
// =====================================================

function parseDuration(input) {
  if (!input) {
    return null;
  }

  const match = input
    .toLowerCase()
    .trim()
    .match(
      /^(\d+)\s*(s|m|h|d|w)$/
    );

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

// =====================================================
// DISCORD SLASH COMMANDS
// =====================================================

const commands = [

  // ===================================================
  // /tagpanel
  // ===================================================

  new SlashCommandBuilder()
    .setName("tagpanel")
    .setDescription(
      "Create a Server Tag verification panel"
    )
    .addStringOption(option =>
      option
        .setName("tag")
        .setDescription(
          "Server Tag required for verification"
        )
        .setRequired(true)
        .setMaxLength(4)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Role users receive after verification"
        )
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.ManageGuild.toString()
    )
    .toJSON(),

  // ===================================================
  // /giveaway
  // ===================================================

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription(
      "Create a giveaway"
    )
    .addStringOption(option =>
      option
        .setName("ends")
        .setDescription(
          "Giveaway duration: 10m, 1h, 2d, etc."
        )
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("winners")
        .setDescription(
          "Number of winners"
        )
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50)
    )
    .addStringOption(option =>
      option
        .setName("prize")
        .setDescription(
          "Giveaway prize"
        )
        .setRequired(true)
        .setMaxLength(256)
    )
    .addRoleOption(option =>
      option
        .setName("required_role")
        .setDescription(
          "Optional role required to enter"
        )
        .setRequired(false)
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.ManageGuild.toString()
    )
    .toJSON()
];

// =====================================================
// REGISTER COMMANDS
// =====================================================

async function registerCommands() {
  try {
    const rest = new REST({
      version: "10"
    }).setToken(
      process.env.DISCORD_TOKEN
    );

    console.log(
      "Registering slash commands..."
    );

    for (
      const guild
      of client.guilds.cache.values()
    ) {
      await rest.put(
        Routes.applicationGuildCommands(
          client.user.id,
          guild.id
        ),
        {
          body: commands
        }
      );

      console.log(
        `Commands registered in ${guild.name}`
      );
    }

    console.log(
      "Slash command registration complete."
    );

  } catch (error) {
    console.error(
      "Command registration error:",
      error
    );
  }
}

// =====================================================
// SERVER TAG CHECK
// =====================================================

async function userHasCorrectTag(
  userId,
  guildId,
  requiredTag
) {
  try {

    const user =
      await client.users.fetch(
        userId,
        {
          force: true
        }
      );

    const primaryGuild =
      user.primaryGuild;

    if (!primaryGuild) {
      return false;
    }

    const tagEnabled =
      primaryGuild.identityEnabled === true;

    const correctServer =
      primaryGuild.identityGuildId ===
      guildId;

    const correctTag =
      typeof primaryGuild.tag ===
        "string" &&
      primaryGuild.tag.toUpperCase() ===
        requiredTag.toUpperCase();

    return (
      tagEnabled &&
      correctServer &&
      correctTag
    );

  } catch (error) {

    console.error(
      `Tag check failed for ${userId}:`,
      error.message
    );

    return false;
  }
}

// =====================================================
// AUTOMATIC TAG ROLE REMOVAL
// =====================================================

async function checkAllTagRoles() {

  for (
    const guild
    of client.guilds.cache.values()
  ) {

    try {

      const guildConfig =
        getGuildConfig(
          guild.id
        );

      if (
        !guildConfig.tag ||
        !guildConfig.roleId
      ) {
        continue;
      }

      const role =
        guild.roles.cache.get(
          guildConfig.roleId
        );

      if (!role) {
        continue;
      }

      const members =
        await guild.members.fetch();

      for (
        const member
        of members.values()
      ) {

        if (member.user.bot) {
          continue;
        }

        if (
          !member.roles.cache.has(
            role.id
          )
        ) {
          continue;
        }

        const valid =
          await userHasCorrectTag(
            member.id,
            guild.id,
            guildConfig.tag
          );

        if (!valid) {

          try {

            await member.roles.remove(
              role,
              "Server Tag removed or changed"
            );

            console.log(
              `Removed ${role.name} from ${member.user.tag} in ${guild.name}`
            );

          } catch (error) {

            console.error(
              `Could not remove role from ${member.user.tag}:`,
              error.message
            );
          }
        }
      }

    } catch (error) {

      console.error(
        `Automatic tag check failed in ${guild.name}:`,
        error.message
      );
    }
  }
}

// =====================================================
// GIVEAWAY EMBED
// =====================================================

function createGiveawayEmbed(
  giveaway,
  ended = false,
  winnerText = null
) {

  const embed =
    new EmbedBuilder()
      .setTitle(
        ended
          ? "🎉 Giveaway Ended"
          : "🎉 Giveaway"
      )
      .setDescription(
        ended
          ? (
            `## 🎁 ${giveaway.prize}\n\n` +
            `🏆 **Winner${giveaway.winners > 1 ? "s" : ""}:**\n` +
            `${winnerText || "No valid winners."}\n\n` +
            `👥 **Total Entries:** ${giveaway.entries.length}\n` +
            `🎯 **Winners:** ${giveaway.winners}\n\n` +
            `Thank you to everyone who participated!`
          )
          : (
            `## 🎁 ${giveaway.prize}\n\n` +
            `Click the button below to enter this giveaway.\n\n` +
            `🏆 **Winners:** ${giveaway.winners}\n` +
            `⏰ **Ends:** <t:${Math.floor(giveaway.endTime / 1000)}:R>\n` +
            `👥 **Entries:** ${giveaway.entries.length}\n` +
            (
              giveaway.requiredRoleId
                ? `🔒 **Required Role:** <@&${giveaway.requiredRoleId}>`
                : `🌎 **Requirement:** Everyone can enter`
            )
          )
      )
      .setColor(
        ended
          ? 0x57F287
          : 0x5865F2
      )
      .setFooter({
        text:
          ended
            ? "Giveaway ended"
            : "Good luck everyone!"
      });

  return embed;
}

// =====================================================
// GIVEAWAY BUTTON
// =====================================================

function createGiveawayButton(
  giveaway
) {

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          `giveaway_enter_${giveaway.id}`
        )
        .setLabel(
          "Enter Giveaway"
        )
        .setEmoji("🎉")
        .setStyle(
          ButtonStyle.Primary
        )

    );
}

// =====================================================
// UPDATE GIVEAWAY MESSAGE
// =====================================================

async function updateGiveawayMessage(
  giveaway
) {

  try {

    const channel =
      await client.channels.fetch(
        giveaway.channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    const message =
      await channel.messages.fetch(
        giveaway.messageId
      );

    await message.edit({
      embeds: [
        createGiveawayEmbed(
          giveaway
        )
      ],
      components: [
        createGiveawayButton(
          giveaway
        )
      ]
    });

  } catch (error) {

    console.error(
      `Could not update giveaway ${giveaway.id}:`,
      error.message
    );
  }
}

// =====================================================
// END GIVEAWAY
// =====================================================

async function endGiveaway(
  giveawayId
) {

  const giveaway =
    giveaways.find(
      g => g.id === giveawayId
    );

  if (!giveaway) {
    return;
  }

  if (giveaway.ended) {
    return;
  }

  giveaway.ended = true;

  const timer =
    giveawayTimers.get(
      giveaway.id
    );

  if (timer) {
    clearTimeout(timer);
    giveawayTimers.delete(
      giveaway.id
    );
  }

  saveGiveaways();

  try {

    const channel =
      await client.channels.fetch(
        giveaway.channelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    // =========================================
    // GET VALID ENTRIES
    // =========================================

    let validEntries = [];

    for (
      const userId
      of giveaway.entries
    ) {

      try {

        const member =
          await channel.guild.members
            .fetch(userId);

        if (
          giveaway.requiredRoleId &&
          !member.roles.cache.has(
            giveaway.requiredRoleId
          )
        ) {
          continue;
        }

        validEntries.push(
          userId
        );

      } catch {
        // User no longer in server
      }
    }

    // =========================================
    // NOT ENOUGH ENTRIES
    // =========================================

    if (
      validEntries.length === 0
    ) {

      const message =
        await channel.messages.fetch(
          giveaway.messageId
        );

      await message.edit({
        embeds: [
          createGiveawayEmbed(
            giveaway,
            true,
            "No valid entries."
          )
        ],
        components: []
      });

      return;
    }

    // =========================================
    // SHUFFLE
    // =========================================

    validEntries =
      validEntries.sort(
        () => Math.random() - 0.5
      );

    const winnerCount =
      Math.min(
        giveaway.winners,
        validEntries.length
      );

    const winners =
      validEntries.slice(
        0,
        winnerCount
      );

    giveaway.winnerIds =
      winners;

    saveGiveaways();

    // =========================================
    // WINNER MENTIONS
    // =========================================

    const winnerMentions =
      winners
        .map(
          id => `<@${id}>`
        )
        .join(", ");

    const message =
      await channel.messages.fetch(
        giveaway.messageId
      );

    await message.edit({
      embeds: [
        createGiveawayEmbed(
          giveaway,
          true,
          winnerMentions
        )
      ],
      components: []
    });

    // =========================================
    // PING WINNERS
    // =========================================

    await channel.send({
      content:
        `🎉 Congratulations ${winnerMentions}!\n` +
        `You won **${giveaway.prize}**! 🏆`,
      allowedMentions: {
        users: winners
      }
    });

    console.log(
      `Giveaway ${giveaway.id} ended. Winners: ${winners.join(", ")}`
    );

  } catch (error) {

    console.error(
      `Error ending giveaway ${giveaway.id}:`,
      error
    );
  }
}

// =====================================================
// START GIVEAWAY TIMER
// =====================================================

function scheduleGiveaway(
  giveaway
) {

  if (giveaway.ended) {
    return;
  }

  const remaining =
    giveaway.endTime -
    Date.now();

  if (remaining <= 0) {

    endGiveaway(
      giveaway.id
    );

    return;
  }

  const timer =
    setTimeout(
      () => {
        endGiveaway(
          giveaway.id
        );
      },
      remaining
    );

  giveawayTimers.set(
    giveaway.id,
    timer
  );
}

// =====================================================
// RESTORE GIVEAWAYS AFTER RESTART
// =====================================================

function restoreGiveaways() {

  console.log(
    `Restoring ${giveaways.length} giveaway(s)...`
  );

  for (
    const giveaway
    of giveaways
  ) {

    if (!giveaway.ended) {
      scheduleGiveaway(
        giveaway
      );
    }
  }
}

// =====================================================
// READY
// =====================================================

client.once(
  "ready",
  async () => {

    console.log(
      "----------------------------------"
    );

    console.log(
      `Logged in as: ${client.user.tag}`
    );

    console.log(
      `Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "Server Tag + Giveaway bot is online."
    );

    console.log(
      "----------------------------------"
    );

    await registerCommands();

    restoreGiveaways();

    // Initial Server Tag check
    checkAllTagRoles();

    // Every 60 seconds
    setInterval(
      () => {
        checkAllTagRoles();
      },
      60 * 1000
    );
  }
);

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // =================================================
      // /TAGPANEL
      // =================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "tagpanel"
      ) {

        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ This command can only be used inside a server.",
            ephemeral: true
          });
        }

        if (
          !interaction.memberPermissions.has(
            PermissionsBitField.Flags.ManageGuild
          )
        ) {

          return interaction.reply({
            content:
              "❌ You need **Manage Server** permission.",
            ephemeral: true
          });
        }

        const tag =
          interaction.options
            .getString("tag")
            .trim();

        const role =
          interaction.options.getRole(
            "role"
          );

        if (!tag) {
          return interaction.reply({
            content:
              "❌ Please provide a Server Tag.",
            ephemeral: true
          });
        }

        if (tag.length > 4) {
          return interaction.reply({
            content:
              "❌ Server Tag can contain maximum 4 characters.",
            ephemeral: true
          });
        }

        if (role.managed) {
          return interaction.reply({
            content:
              "❌ I cannot assign a managed role.",
            ephemeral: true
          });
        }

        const botMember =
          interaction.guild.members.me;

        if (!botMember) {
          return interaction.reply({
            content:
              "❌ I could not find my bot member.",
            ephemeral: true
          });
        }

        if (
          role.position >=
          botMember.roles.highest.position
        ) {

          return interaction.reply({
            content:
              "❌ Move my bot role **above the verification role**.",
            ephemeral: true
          });
        }

        const guildConfig =
          getGuildConfig(
            interaction.guild.id
          );

        guildConfig.tag =
          tag;

        guildConfig.roleId =
          role.id;

        saveTagConfig();

        const embed =
          new EmbedBuilder()
            .setTitle(
              "🏷️ Server Tag Verification"
            )
            .setDescription(
              "Want to receive the verification role?\n\n" +

              `### 🏷️ Required Server Tag\n` +
              `**\`${tag}\`**\n\n` +

              `### 📋 How to Apply\n` +
              `**1.** Open your Discord profile.\n` +
              `**2.** Open your Server Tags/Profile options.\n` +
              `**3.** Select this server's Server Tag.\n` +
              `**4.** Choose **\`${tag}\`** and display it.\n` +
              `**5.** Make sure the tag is currently displayed.\n` +
              `**6.** Click **Verify Server Tag** below.\n\n` +
               `### 🎁 Verification Reward\n` +
              `You will receive ${role} after successful verification.\n\n` +

              `> ⚠️ Keep the required Server Tag displayed to keep the role.`
            )
            .addFields(
              {
                name:
                  "🏷️ Required Tag",
                value:
                  `\`${tag}\``,
                inline: true
              },
              {
                name:
                  "🎖️ Reward Role",
                value:
                  `${role}`,
                inline: true
              }
            )
            .setColor(
              0x5865F2
            )
            .setFooter({
              text:
                `${interaction.guild.name} • Server Tag Verification`
            });

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "server_tag_verify"
                )
                .setLabel(
                  "Verify Server Tag"
                )
                .setEmoji("✅")
                .setStyle(
                  ButtonStyle.Success
                )
            );

        await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });

        return interaction.reply({
          content:
            "✅ Server Tag verification panel created.",
          ephemeral: true
        });
      }

      // =================================================
      // /GIVEAWAY
      // =================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "giveaway"
      ) {

        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ This command can only be used inside a server.",
            ephemeral: true
          });
        }

        if (
          !interaction.memberPermissions.has(
            PermissionsBitField.Flags.ManageGuild
          )
        ) {

          return interaction.reply({
            content:
              "❌ You need **Manage Server** permission to create giveaways.",
            ephemeral: true
          });
        }

        const ends =
          interaction.options.getString(
            "ends"
          );

        const winners =
          interaction.options.getInteger(
            "winners"
          );

        const prize =
          interaction.options.getString(
            "prize"
          );

        const requiredRole =
          interaction.options.getRole(
            "required_role"
          );

        // =========================================
        // PARSE DURATION
        // =========================================

        const duration =
          parseDuration(
            ends
          );

        if (!duration) {

          return interaction.reply({
            content:
              "❌ Invalid time.\n\nUse examples:\n`10m` • `1h` • `2d` • `1w`",
            ephemeral: true
          });
        }

        if (
          duration < 10 * 1000
        ) {

          return interaction.reply({
            content:
              "❌ Giveaway must last at least **10 seconds**.",
            ephemeral: true
          });
        }

        // =========================================
        // ROLE VALIDATION
        // =========================================

        if (
          requiredRole &&
          requiredRole.managed
        ) {

          return interaction.reply({
            content:
              "❌ Managed/integration roles cannot be used as a required giveaway role.",
            ephemeral: true
          });
        }

        // =========================================
        // CREATE GIVEAWAY
        // =========================================

        const giveaway = {
          id:
            `${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 8)}`,

          guildId:
            interaction.guild.id,

          channelId:
            interaction.channel.id,

          messageId:
            null,

          hostId:
            interaction.user.id,

          prize:
            prize,

          winners:
            winners,

          requiredRoleId:
            requiredRole
              ? requiredRole.id
              : null,

          endTime:
            Date.now() + duration,

          entries:
            [],

          winnerIds:
            [],

          ended:
            false
        };

        // =========================================
        // SEND GIVEAWAY MESSAGE
        // =========================================

        const giveawayMessage =
          await interaction.channel.send({
            embeds: [
              createGiveawayEmbed(
                giveaway
              )
            ],
            components: [
              createGiveawayButton(
                giveaway
              ]
            ]
          });

        giveaway.messageId =
          giveawayMessage.id;

        giveaways.push(
          giveaway
        );

        saveGiveaways();

        scheduleGiveaway(
          giveaway
        );

        return interaction.reply({
          content:
            "✅ Giveaway created successfully!",
          ephemeral: true
        });
      }

      // =================================================
      // SERVER TAG VERIFY BUTTON
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "server_tag_verify"
      ) {

        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ This button can only be used inside a server.",
            ephemeral: true
          });
        }

        const guild =
          interaction.guild;

        const guildConfig =
          getGuildConfig(
            guild.id
          );

        if (
          !guildConfig.tag ||
          !guildConfig.roleId
        ) {

          return interaction.reply({
            content:
              "❌ Server Tag verification is not configured.",
            ephemeral: true
          });
        }

        const role =
          guild.roles.cache.get(
            guildConfig.roleId
          );

        if (!role) {
          return interaction.reply({
            content:
              "❌ Verification role no longer exists.",
            ephemeral: true
          });
        }

        const botMember =
          guild.members.me;

        if (
          !botMember ||
          role.position >=
          botMember.roles.highest.position
        ) {

          return interaction.reply({
            content:
              "❌ Move my bot role above the verification role.",
            ephemeral: true
          });
        }

        const valid =
          await userHasCorrectTag(
            interaction.user.id,
            guild.id,
            guildConfig.tag
          );

        if (!valid) {

          return interaction.reply({
            content:
              `❌ **Verification Failed**\n\n` +
              `You don't currently have the required Server Tag displayed.\n\n` +
              `**Required Tag:** \`${guildConfig.tag}\``,
            ephemeral: true
          });
        }

        const member =
          await guild.members.fetch(
            interaction.user.id
          );

        if (
          member.roles.cache.has(
            role.id
          )
        ) {

          return interaction.reply({
            content:
              `✅ You are already verified and have ${role}.`,
            ephemeral: true
          });
        }

        await member.roles.add(
          role,
          `Server Tag verification: ${guildConfig.tag}`
        );

        const success =
          new EmbedBuilder()
            .setTitle(
              "✅ Verification Successful"
            )
            .setDescription(
              `Your Server Tag has been successfully verified.\n\n` +
              `🏷️ **Required Tag:** \`${guildConfig.tag}\`\n` +
              `🎖️ **Role Received:** ${role}\n\n` +
              `Keep the Server Tag displayed to keep your verification role.`
            )
            .setColor(
              0x57F287
            )
            .setFooter({
              text:
                "Server Tag Verification"
            });

        return interaction.reply({
          embeds: [success],
          ephemeral: true
        });
      }

      // =================================================
      // GIVEAWAY ENTER BUTTON
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "giveaway_enter_"
        )
      ) {

        const giveawayId =
          interaction.customId.replace(
            "giveaway_enter_",
            ""
          );

        const giveaway =
          giveaways.find(
            g => g.id === giveawayId
          );

        if (!giveaway) {

          return interaction.reply({
            content:
              "❌ This giveaway no longer exists.",
            ephemeral: true
          });
        }

        if (giveaway.ended) {

          return interaction.reply({
            content:
              "❌ This giveaway has already ended.",
            ephemeral: true
          });
        }

        if (
          Date.now() >=
          giveaway.endTime
        ) {

          await endGiveaway(
            giveaway.id
          );

          return interaction.reply({
            content:
              "❌ This giveaway has ended.",
            ephemeral: true
          });
        }

        // =========================================
        // REQUIRED ROLE CHECK
        // =========================================

        if (
          giveaway.requiredRoleId
        ) {

          const member =
            await interaction.guild
              .members.fetch(
                interaction.user.id
              );

          if (
            !member.roles.cache.has(
              giveaway.requiredRoleId
            )
          ) {

            return interaction.reply({
              content:
                `❌ You need <@&${giveaway.requiredRoleId}> to enter this giveaway.`,
              ephemeral: true
            });
          }
        }

        // =========================================
        // ALREADY ENTERED
        // =========================================

        if (
          giveaway.entries.includes(
            interaction.user.id
          )
        ) {

          return interaction.reply({
            content:
              "✅ You are already entered in this giveaway!",
            ephemeral: true
          });
        }

        // =========================================
        // ADD ENTRY
        // =========================================

        giveaway.entries.push(
          interaction.user.id
        );

        saveGiveaways();

        // Update embed
        await updateGiveawayMessage(
          giveaway
        );

        return interaction.reply({
          content:
            "🎉 **You have entered the giveaway!**\nGood luck! 🍀",
          ephemeral: true
        });
      }

    } catch (error) {

      console.error(
        "Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        try {

          await interaction.reply({
            content:
              "❌ Something went wrong. Please try again.",
            ephemeral: true
          });

        } catch {}
      }
    }
  }
);

// =====================================================
// ERROR HANDLING
// =====================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled Promise Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught Exception:",
      error
    );
  }
);

// =====================================================
// TOKEN
// =====================================================

if (!process.env.DISCORD_TOKEN) {

  console.error(
    "❌ DISCORD_TOKEN is missing from .env"
  );

  process.exit(1);
}

// =====================================================
// LOGIN
// =====================================================

client.login(
  process.env.DISCORD_TOKEN
);
