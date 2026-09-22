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

// ======================================================
// RENDER WEB SERVER
// ======================================================

const PORT = process.env.PORT || 3000;

const webServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("Discord bot is online.");
});

webServer.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

// ======================================================
// DISCORD CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});


// ======================================================
// FILE PATHS
// ======================================================

const TAG_CONFIG_FILE = path.join(
  __dirname,
  "tagconfig.json"
);

const GIVEAWAY_FILE = path.join(
  __dirname,
  "giveaways.json"
);

// ======================================================
// TAG CONFIG
// ======================================================

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

const tagConfig = loadTagConfig();

function saveTagConfig() {
  fs.writeFileSync(
    TAG_CONFIG_FILE,
    JSON.stringify(
      tagConfig,
      null,
      2
    )
  );
}

function getGuildConfig(guildId) {
  if (!tagConfig[guildId]) {
    tagConfig[guildId] = {
      tag: null,
      roleId: null
    };

    saveTagConfig();
  }

  return tagConfig[guildId];
}

// ======================================================
// GIVEAWAY DATA
// ======================================================

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
      "Giveaway file error:",
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

// ======================================================
// TIME PARSER
// ======================================================

function parseDuration(value) {
  if (!value) {
    return null;
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*(s|m|h|d|w)$/);

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

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

  // ----------------------------------------------------
  // /tagpanel
  // ----------------------------------------------------

  new SlashCommandBuilder()
    .setName("tagpanel")
    .setDescription(
      "Create a Server Tag verification panel"
    )
    .addStringOption(option =>
      option
        .setName("tag")
        .setDescription(
          "Required Server Tag"
        )
        .setRequired(true)
        .setMaxLength(4)
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Verification reward role"
        )
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.ManageGuild.toString()
    )
    .toJSON(),

  // ----------------------------------------------------
  // /giveaway
  // ----------------------------------------------------

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription(
      "Create a giveaway"
    )
    .addStringOption(option =>
      option
        .setName("ends")
        .setDescription(
          "Duration: 10m, 1h, 2d, 1w"
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

// ======================================================
// REGISTER SLASH COMMANDS
// ======================================================

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
      const guild of client.guilds.cache.values()
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
        `Registered commands in ${guild.name}`
      );
    }

    console.log(
      "Slash command registration complete."
    );

  } catch (error) {
    console.error(
      "Slash command registration failed:",
      error
    );
  }
}

// ======================================================
// SERVER TAG CHECK
// ======================================================

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

    const identityEnabled =
      primaryGuild.identityEnabled === true;

    const correctGuild =
      primaryGuild.identityGuildId === guildId;

    const correctTag =
      typeof primaryGuild.tag === "string" &&
      primaryGuild.tag.toUpperCase() ===
        requiredTag.toUpperCase();

    return (
      identityEnabled &&
      correctGuild &&
      correctTag
    );

  } catch (error) {
    console.error(
      `Server Tag check failed for ${userId}:`,
      error.message
    );

    return false;
  }
}

// ======================================================
// AUTOMATIC TAG ROLE REMOVAL
// ======================================================

async function checkAllTagRoles() {
  for (
    const guild of client.guilds.cache.values()
  ) {
    try {
      const settings =
        getGuildConfig(guild.id);

      if (
        !settings.tag ||
        !settings.roleId
      ) {
        continue;
      }

      const role =
        guild.roles.cache.get(
          settings.roleId
        );

      if (!role) {
        continue;
      }

      const members =
        await guild.members.fetch();

      for (
        const member of members.values()
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
            settings.tag
          );

        if (!valid) {
          try {
            await member.roles.remove(
              role,
              "Server Tag removed or changed"
            );

            console.log(
              `Removed ${role.name} from ${member.user.tag}`
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
        `Tag check failed in ${guild.name}:`,
        error.message
      );
    }
  }
}

// ======================================================
// GIVEAWAY EMBED
// ======================================================

function giveawayEmbed(
  giveaway,
  ended = false,
  winnersText = null
) {
  if (ended) {
    return new EmbedBuilder()
      .setTitle("🎉 Giveaway Ended")
      .setDescription(
        `## 🎁 ${giveaway.prize}\n\n` +
        `🏆 **Winner${giveaway.winners === 1 ? "" : "s"}:**\n` +
        `${winnersText || "No valid winners."}\n\n` +
        `👥 **Entries:** ${giveaway.entries.length}\n` +
        `🏆 **Winners:** ${giveaway.winners}\n\n` +
        `Thank you for participating!`
      )
      .setColor(0x57F287)
      .setFooter({
        text: "Giveaway ended"
      });
  }

  return new EmbedBuilder()
    .setTitle("🎉 Giveaway")
    .setDescription(
      `## 🎁 ${giveaway.prize}\n\n` +
      `Click **Enter Giveaway** below to participate.\n\n` +
      `🏆 **Winners:** ${giveaway.winners}\n` +
      `⏰ **Ends:** <t:${Math.floor(
        giveaway.endTime / 1000
      )}:R>\n` +
      `👥 **Entries:** ${giveaway.entries.length}\n\n` +
      (
        giveaway.requiredRoleId
          ? `🔒 **Required Role:** <@&${giveaway.requiredRoleId}>`
          : `🌎 **Requirement:** Everyone can enter`
      )
    )
    .setColor(0x5865F2)
    .setFooter({
      text: "Good luck everyone! 🍀"
    });
}

// ======================================================
// GIVEAWAY BUTTON
// ======================================================

function giveawayButton(giveaway) {
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

// ======================================================
// UPDATE GIVEAWAY
// ======================================================

async function updateGiveaway(
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
        giveawayEmbed(giveaway)
      ],
      components: [
        giveawayButton(giveaway)
      ]
    });

  } catch (error) {
    console.error(
      "Could not update giveaway:",
      error.message
    );
  }
}

// ======================================================
// END GIVEAWAY
// ======================================================

async function endGiveaway(
  giveawayId
) {
  const giveaway =
    giveaways.find(
      item => item.id === giveawayId
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

    const guild =
      client.guilds.cache.get(
        giveaway.guildId
      );

    if (!guild) {
      return;
    }

    // ----------------------------------------------
    // CHECK VALID ENTRIES
    // ----------------------------------------------

    const validEntries = [];

    for (
      const userId of giveaway.entries
    ) {
      try {
        const member =
          await guild.members.fetch(
            userId
          );

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
        // User left server
      }
    }

    // ----------------------------------------------
    // NO VALID ENTRIES
    // ----------------------------------------------

    if (
      validEntries.length === 0
    ) {
      const message =
        await channel.messages.fetch(
          giveaway.messageId
        );

      await message.edit({
        embeds: [
          giveawayEmbed(
            giveaway,
            true,
            "No valid entries."
          )
        ],
        components: []
      });

      return;
    }

    // ----------------------------------------------
    // RANDOM WINNERS
    // ----------------------------------------------

    const shuffled =
      [...validEntries].sort(
        () => Math.random() - 0.5
      );

    const winnerIds =
      shuffled.slice(
        0,
        Math.min(
          giveaway.winners,
          shuffled.length
        )
      );

    giveaway.winnerIds =
      winnerIds;

    saveGiveaways();

    const mentions =
      winnerIds
        .map(id => `<@${id}>`)
        .join(", ");

    // ----------------------------------------------
    // EDIT GIVEAWAY MESSAGE
    // ----------------------------------------------

    const message =
      await channel.messages.fetch(
        giveaway.messageId
      );

    await message.edit({
      embeds: [
        giveawayEmbed(
          giveaway,
          true,
          mentions
        )
      ],
      components: []
    });

    // ----------------------------------------------
    // PING WINNERS
    // ----------------------------------------------

    await channel.send({
      content:
        `🎉 Congratulations ${mentions}!\n` +
        `You won **${giveaway.prize}**! 🏆`,
      allowedMentions: {
        users: winnerIds
      }
    });

    console.log(
      `Giveaway ${giveaway.id} ended.`
    );

  } catch (error) {
    console.error(
      `Could not end giveaway ${giveaway.id}:`,
      error
    );
  }
}

// ======================================================
// SCHEDULE GIVEAWAY
// ======================================================

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

// ======================================================
// RESTORE GIVEAWAYS
// ======================================================

function restoreGiveaways() {
  console.log(
    `Restoring ${giveaways.length} giveaways...`
  );

  for (
    const giveaway of giveaways
  ) {
    if (!giveaway.ended) {
      scheduleGiveaway(
        giveaway
      );
    }
  }
}

// ======================================================
// READY
// ======================================================

client.once(
  "ready",
  async () => {
    console.log(
      "=================================="
    );

    console.log(
      `Logged in as: ${client.user.tag}`
    );

    console.log(
      `Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "Server Tag + Giveaway Bot Online"
    );

    console.log(
      "=================================="
    );

    await registerCommands();

    restoreGiveaways();

    checkAllTagRoles();

    setInterval(
      () => {
        checkAllTagRoles();
      },
      60 * 1000
    );
  }
);

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {

      // ==================================================
      // /TAGPANEL
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "tagpanel"
      ) {

        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ This command can only be used in a server.",
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
              "❌ Managed roles cannot be used.",
            ephemeral: true
          });
        }

        const botMember =
          interaction.guild.members.me;

        if (!botMember) {
          return interaction.reply({
            content:
              "❌ Bot member could not be found.",
            ephemeral: true
          });
        }

        if (
          role.position >=
          botMember.roles.highest.position
        ) {
          return interaction.reply({
            content:
              "❌ Move the bot role above the verification role.",
            ephemeral: true
          });
        }

        const settings =
          getGuildConfig(
            interaction.guild.id
          );

        settings.tag = tag;
        settings.roleId = role.id;

        saveTagConfig();

        const embed =
          new EmbedBuilder()
            .setTitle(
              "🏷️ Server Tag Verification"
            )
            .setDescription(
              `Want to receive ${role}?\n\n` +
              `### 🏷️ Required Server Tag\n` +
              `**\`${tag}\`**\n\n` +

              `### 📋 How to Apply\n` +
              `**1.** Open your Discord profile.\n` +
              `**2.** Open Server Tags/Profile options.\n` +
              `**3.** Select this server's tag.\n` +
              `**4.** Choose **\`${tag}\`** and display it.\n` +
              `**5.** Make sure it is currently displayed.\n` +
              `**6.** Click **Verify Server Tag** below.\n\n` +

              `### 🎁 Reward\n` +
              `You will receive ${role} after successful verification.\n\n` +

              `> ⚠️ Keep the required Server Tag displayed to keep the role.`
            )
            .addFields(
              {
                name: "🏷️ Required Tag",
                value: `\`${tag}\``,
                inline: true
              },
              {
                name: "🎖️ Reward Role",
                value: `${role}`,
                inline: true
              }
            )
            .setColor(0x5865F2)
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
            "✅ Server Tag panel created.",
          ephemeral: true
        });
      }

      // ==================================================
      // /GIVEAWAY
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "giveaway"
      ) {

        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ This command can only be used in a server.",
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

        const winnerCount =
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

        const duration =
          parseDuration(ends);

        if (!duration) {
          return interaction.reply({
            content:
              "❌ Invalid duration.\n\nExamples: `10m`, `1h`, `2d`, `1w`",
            ephemeral: true
          });
        }

        if (
          duration < 10 * 1000
        ) {
          return interaction.reply({
            content:
              "❌ Giveaway must be at least 10 seconds.",
            ephemeral: true
          });
        }

        if (
          requiredRole &&
          requiredRole.managed
        ) {
          return interaction.reply({
            content:
              "❌ Managed roles cannot be used as giveaway requirements.",
            ephemeral: true
          });
        }

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
            winnerCount,

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

        const message =
          await interaction.channel.send({
            embeds: [
              giveawayEmbed(
                giveaway
              )
            ],
            components: [
              giveawayButton(
                giveaway
              )
            ]
          });

        giveaway.messageId =
          message.id;

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

      // ==================================================
      // SERVER TAG BUTTON
      // ==================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "server_tag_verify"
      ) {

        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ This button only works in a server.",
            ephemeral: true
          });
        }

        const settings =
          getGuildConfig(
            interaction.guild.id
          );

        if (
          !settings.tag ||
          !settings.roleId
        ) {
          return interaction.reply({
            content:
              "❌ Server Tag verification is not configured.",
            ephemeral: true
          });
        }

        const role =
          interaction.guild.roles.cache.get(
            settings.roleId
          );

        if (!role) {
          return interaction.reply({
            content:
              "❌ Verification role no longer exists.",
            ephemeral: true
          });
        }

        const botMember =
          interaction.guild.members.me;

        if (
          !botMember ||
          role.position >=
          botMember.roles.highest.position
        ) {
          return interaction.reply({
            content:
              "❌ Move the bot role above the verification role.",
            ephemeral: true
          });
        }

        const valid =
          await userHasCorrectTag(
            interaction.user.id,
            interaction.guild.id,
            settings.tag
          );

        if (!valid) {
          return interaction.reply({
            content:
              `❌ **Verification Failed**\n\n` +
              `Required Server Tag: \`${settings.tag}\``,
            ephemeral: true
          });
        }

        const member =
          await interaction.guild.members.fetch(
            interaction.user.id
          );

        if (
          member.roles.cache.has(
            role.id
          )
        ) {
          return interaction.reply({
            content:
              `✅ You already have ${role}.`,
            ephemeral: true
          });
        }

        await member.roles.add(
          role,
          `Server Tag verification: ${settings.tag}`
        );

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "✅ Verification Successful"
              )
              .setDescription(
                `🏷️ **Tag:** \`${settings.tag}\`\n` +
                `🎖️ **Role:** ${role}\n\n` +
                `Keep the Server Tag displayed to keep your role.`
              )
              .setColor(0x57F287)
          ],
          ephemeral: true
        });
      }

      // ==================================================
      // GIVEAWAY ENTER BUTTON
      // ==================================================

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
            item =>
              item.id === giveawayId
          );

        if (!giveaway) {
          return interaction.reply({
            content:
              "❌ Giveaway not found.",
            ephemeral: true
          });
        }

        if (giveaway.ended) {
          return interaction.reply({
            content:
              "❌ This giveaway has ended.",
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

        // ----------------------------------------------
        // REQUIRED ROLE
        // ----------------------------------------------

        if (
          giveaway.requiredRoleId
        ) {
          const member =
            await interaction.guild.members.fetch(
              interaction.user.id
            );

          if (
            !member.roles.cache.has(
              giveaway.requiredRoleId
            )
          ) {
            return interaction.reply({
              content:
                `❌ You need <@&${giveaway.requiredRoleId}> to enter.`,
              ephemeral: true
            });
          }
        }

        // ----------------------------------------------
        // ALREADY ENTERED
        // ----------------------------------------------

        if (
          giveaway.entries.includes(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "✅ You are already entered!",
            ephemeral: true
          });
        }

        giveaway.entries.push(
          interaction.user.id
        );

        saveGiveaways();

        await updateGiveaway(
          giveaway
        );

        return interaction.reply({
          content:
            "🎉 You have entered the giveaway! Good luck! 🍀",
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

// ======================================================
// ERROR HANDLING
// ======================================================

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

// ======================================================
// TOKEN CHECK
// ======================================================

if (!process.env.DISCORD_TOKEN) {
  console.error(
    "❌ DISCORD_TOKEN is missing."
  );

  process.exit(1);
}
// ======================================================
// CATEGORY MOVE COMMAND (.move) - ADMIN ONLY
// ======================================================

let savedCategoryId = null;

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  if (message.content.toLowerCase().startsWith(".move")) {
    
    // 1. SIRF ADMINISTRATOR CHECK
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const reply = await message.reply("❌ Only Server Administrators can use this command!");
      setTimeout(() => {
        message.delete().catch(() => {});
        reply.delete().catch(() => {});
      }, 5000);
      return;
    }

    const args = message.content.trim().split(/ +/);
    const inputCategoryId = args[1];

    // Category ID save karein agar provide ki gayi hai
    if (inputCategoryId) {
      savedCategoryId = inputCategoryId;
    }

    // Check agar koi category set nahi hai
    if (!savedCategoryId) {
      const reply = await message.reply("⚠️ No category saved! Set one first using `.move <category_id>`.");
      setTimeout(() => {
        message.delete().catch(() => {});
        reply.delete().catch(() => {});
      }, 5000);
      return;
    }

    // Server me Category dhoondhein
    const targetCategory = message.guild.channels.cache.get(savedCategoryId);

    if (!targetCategory || targetCategory.type !== 4) { // 4 = GuildCategory
      const reply = await message.reply("❌ Saved category ID was not found on this server! Set a valid ID using `.move <category_id>`.");
      setTimeout(() => {
        message.delete().catch(() => {});
        reply.delete().catch(() => {});
      }, 5000);
      return;
    }

    try {
      // 2. Channel ki saari existing Permissions ko copy karein
      const currentPermissions = message.channel.permissionOverwrites.cache.map(overwrite => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield
      }));

      // 3. Channel move karein
      await message.channel.setParent(targetCategory.id, { lockPermissions: false });

      // 4. Exact permissions restore karein taaki ticket private rahe
      await message.channel.permissionOverwrites.set(currentPermissions);

      const responseText = inputCategoryId 
        ? `✅ New category saved! Channel moved to **${targetCategory.name}** with all permissions preserved.` 
        : `✅ Moved channel to **${targetCategory.name}** with all permissions preserved.`;

      const reply = await message.reply(responseText);

      // 5. Auto delete messages after 5 seconds
      setTimeout(() => {
        message.delete().catch(() => {});
        reply.delete().catch(() => {});
      }, 5000);

    } catch (error) {
      console.error("Move command error:", error);
      const reply = await message.reply("❌ Failed to move channel! Check bot role order and permissions.");
      
      setTimeout(() => {
        message.delete().catch(() => {});
        reply.delete().catch(() => {});
      }, 5000);
    }
  }
});


// ======================================================
// LOGIN
// ======================================================

client.login(
  process.env.DISCORD_TOKEN
);
             
