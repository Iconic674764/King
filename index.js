require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const PREFIX = '.';
const DB_FILE = path.join(__dirname, 'tickets.json');

let db = {
  guilds: {},
  tickets: {},
  panels: {},
  pendingButtons: {},
  vouches: {}
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(
      fs.readFileSync(DB_FILE, 'utf8')
    );
  } catch {
    console.log('Database reset.');
  }
}

db.guilds ??= {};
db.tickets ??= {};
db.panels ??= {};
db.pendingButtons ??= {};
db.vouches ??= {};

function saveDB() {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.Message
  ]
});

// =====================================================
// DEFAULT EMBEDS
// =====================================================

function defaultEmbeds() {
  return {

    ticket: {
      color: '5865F2',
      title: '🎫 {type} Ticket',
      description:
        'Welcome <@{owner}>!\n\n' +
        'A member of the support team will assist you shortly.\n\n' +
        '> 👤 **Owner:** <@{owner}>\n' +
        '> 🎫 **Type:** {type}\n' +
        '> 🔢 **Ticket:** `{ticketId}`\n' +
        '> 🕐 **Opened:** <t:{created}:F> • <t:{created}:R>',
      footer:
        '{guild} • Ticket {ticketId}',
      thumbnail: 'server'
    },

    vouch: {
      color: '57F287',
      title: '💸 VOUCH REQUIRED',
      description:
        'Your payment has been marked as completed.\n\n' +
        '**Amount:** `${amount}`\n\n' +
        '**Vouch Format:**\n' +
        '`Legit got ${amount} from @user`\n\n' +
        'Click **📋 Copy Vouch** below to get the exact format.\n\n' +
        '⚠️ This ticket will remain open until your vouch is verified.',
      footer:
        '{guild} • Vouch Required',
      thumbnail: 'owner'
    },

    thankyou: {
      color: '57F287',
      title: '❤️ THANK YOU FOR VOUCHING!',
      description:
        'Your vouch has been successfully verified! 🎉\n\n' +
        'Thank you for your support and for taking the time to leave a vouch.\n\n' +
        'This ticket will be automatically deleted in **5 minutes**.',
      footer:
        '{guild} • Vouch Verified',
      thumbnail: 'owner'
    },

    reminder: {
      color: 'FEE75C',
      title: '⏰ VOUCH REMINDER',
      description:
        '<@{owner}>, your vouch is still pending.\n\n' +
        'Please post your vouch in {vouchChannel} using the required format.',
      footer:
        '{guild} • Vouch Reminder'
    },

    close: {
      color: 'ED4245',
      title: '🔒 TICKET CLOSED',
      description:
        'This ticket is being closed and a transcript will be generated.',
      footer:
        '{guild} • Ticket Closed'
    }
  };
}

// =====================================================
// SETTINGS
// =====================================================

function settings(guildId) {

  db.guilds[guildId] ??= {
    transcriptChannel: null,
    vouchChannel: null,
    reminderChannel: null,
    vouchUserId: null,
    reminderHours: 12,
    adminRoles: [],
    embeds: {}
  };

  const s = db.guilds[guildId];

  s.transcriptChannel ??= null;
  s.vouchChannel ??= null;
  s.reminderChannel ??= null;
  s.vouchUserId ??= null;
  s.reminderHours ??= 12;
  s.adminRoles ??= [];
  s.embeds ??= {};

  const defaults = defaultEmbeds();

  for (
    const [name, value]
    of Object.entries(defaults)
  ) {
    s.embeds[name] = {
      ...value,
      ...(s.embeds[name] || {})
    };
  }

  return s;
}

// =====================================================
// PERMISSION HELPERS
// =====================================================

function isAdmin(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

function isTicketAdmin(member, guildId) {

  if (isAdmin(member)) {
    return true;
  }

  return settings(guildId)
    .adminRoles
    .some(
      roleId =>
        member.roles.cache.has(roleId)
    );
}

// =====================================================
// HELPERS
// =====================================================

function timestamp(time = Date.now()) {
  return Math.floor(time / 1000);
}

function serverIcon(guild) {
  return guild.iconURL({
    extension: 'png',
    size: 256
  }) || undefined;
}

function parseAmount(value) {

  const n = Number(
    String(value || '')
      .replace(/[$,\s]/g, '')
  );

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return null;
  }

  return n;
}

function formatAmount(value) {

  const n = Number(value);

  if (Number.isInteger(n)) {
    return String(n);
  }

  return n
    .toFixed(2)
    .replace(/\.00$/, '');
}

function render(text, data = {}) {

  return String(text || '').replace(
    /\{(\w+)\}/g,
    (_, key) =>
      data[key] ?? ''
  );
}

function hexColor(value) {

  const clean =
    String(value || '')
      .replace('#', '')
      .trim();

  if (
    !/^[0-9a-f]{6}$/i.test(clean)
  ) {
    return 0x5865F2;
  }

  return parseInt(clean, 16);
}

function getTicket(channelId) {
  return db.tickets[channelId] || null;
}

// =====================================================
// EMBED BUILDER
// =====================================================

function makeEmbed(
  guild,
  type,
  data = {}
) {

  const config = {
    ...defaultEmbeds()[type],
    ...(settings(guild.id).embeds[type] || {})
  };

  const values = {
    guild: guild.name,
    ...data
  };

  const embed =
    new EmbedBuilder()
      .setColor(
        hexColor(config.color)
      )
      .setTitle(
        render(
          config.title,
          values
        ).slice(0, 256)
      )
      .setDescription(
        render(
          config.description,
          values
        ).slice(0, 4096)
      )
      .setTimestamp();

  if (config.footer) {
    embed.setFooter({
      text:
        render(
          config.footer,
          values
        ).slice(0, 2048)
    });
  }

  let thumbnail = null;

  if (
    config.thumbnail === 'server'
  ) {
    thumbnail =
      serverIcon(guild);
  }

  if (
    config.thumbnail === 'owner'
  ) {
    thumbnail =
      data.ownerAvatar;
  }

  if (
    config.thumbnail &&
    /^https?:\/\//i.test(
      config.thumbnail
    )
  ) {
    thumbnail =
      config.thumbnail;
  }

  if (thumbnail) {
    embed.setThumbnail(
      thumbnail
    );
  }

  return embed;
}

// =====================================================
// BUTTONS
// =====================================================

function closeButtonRow() {

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          'ticket_close'
        )
        .setLabel(
          'Close Ticket'
        )
        .setEmoji('🔒')
        .setStyle(
          ButtonStyle.Danger
        )
    );
}

function vouchButtonRow(vouchId) {

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          `copy_vouch_${vouchId}`
        )
        .setLabel(
          'Copy Vouch'
        )
        .setEmoji('📋')
        .setStyle(
          ButtonStyle.Success
        )
    );
}

// =====================================================
// PANEL EMBED
// =====================================================

function panelEmbed(
  guild,
  panel
) {

  const embed =
    new EmbedBuilder()
      .setColor(
        hexColor(panel.color)
      )
      .setTitle(
        panel.title ||
        '🎫 Support Tickets'
      )
      .setDescription(
        panel.description ||
        'Select a ticket type below to open a ticket.'
      )
      .setFooter({
        text:
          `${guild.name} • Ticket Support`
      });

  if (panel.thumbnail) {
    embed.setThumbnail(
      panel.thumbnail
    );
  } else if (
    serverIcon(guild)
  ) {
    embed.setThumbnail(
      serverIcon(guild)
    );
  }

  if (panel.banner) {
    embed.setImage(
      panel.banner
    );
  }

  return embed;
}

function panelButtons(panel) {

  const rows = [];

  for (
    let i = 0;
    i < panel.buttons.length;
    i += 5
  ) {

    const row =
      new ActionRowBuilder();

    for (
      const button
      of panel.buttons.slice(i, i + 5)
    ) {

      const styles = {
        primary:
          ButtonStyle.Primary,

        success:
          ButtonStyle.Success,

        danger:
          ButtonStyle.Danger,

        secondary:
          ButtonStyle.Secondary
      };

      const b =
        new ButtonBuilder()
          .setCustomId(
            `ticket_open_${button.id}`
          )
          .setLabel(
            String(
              button.name
            ).slice(0, 80)
          )
          .setStyle(
            styles[button.style] ||
            ButtonStyle.Primary
          );

      if (button.emoji) {
        try {
          b.setEmoji(
            button.emoji
          );
        } catch {}
      }

      row.addComponents(b);
    }

    rows.push(row);
  }

  return rows;
}
// =====================================================
// TRANSCRIPT
// =====================================================

async function createTranscript(
  channel,
  ticket
) {

  let messages = [];
  let before;

  try {

    while (
      messages.length < 1000
    ) {

      const batch =
        await channel.messages.fetch({
          limit: 100,
          ...(before
            ? { before }
            : {})
        });

      if (!batch.size) {
        break;
      }

      messages.push(
        ...batch.values()
      );

      before =
        batch.last().id;

      if (batch.size < 100) {
        break;
      }
    }

  } catch (error) {
    console.error(
      'Transcript fetch error:',
      error
    );
  }

  messages.sort(
    (a, b) =>
      a.createdTimestamp -
      b.createdTimestamp
  );

  const safe = text =>
    String(text || '')
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      );

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">

<title>
Ticket ${safe(ticket.ticketId)}
</title>

<style>

body {
  background:#0b0b0f;
  color:#eeeeee;
  font-family:Arial,sans-serif;
  padding:25px;
}

.header {
  background:#15151c;
  padding:20px;
  border-radius:12px;
  margin-bottom:20px;
}

.message {
  background:#15151c;
  padding:12px;
  margin:8px 0;
  border-radius:8px;
}

.name {
  font-weight:bold;
}

.time {
  color:#888;
  font-size:12px;
}

.content {
  margin-top:7px;
  white-space:pre-wrap;
}

</style>
</head>

<body>

<div class="header">

<h1>
🎫 Ticket Transcript
</h1>

<p>

<b>Ticket ID:</b>
${safe(ticket.ticketId)}
<br>

<b>Owner:</b>
${safe(ticket.ownerTag)}
<br>

<b>Type:</b>
${safe(ticket.type)}
<br>

<b>Opened:</b>
${new Date(
  ticket.createdAt
).toLocaleString()}

</p>

</div>

${messages.map(
  message => `

<div class="message">

<span class="name">
${safe(message.author.tag)}
</span>

<span class="time">
${new Date(
  message.createdTimestamp
).toLocaleString()}
</span>

<div class="content">
${safe(
  message.content ||
  '(No text message)'
)}
</div>

</div>

`
).join('')}

</body>
</html>
`;

  const fileName =
    `transcript-${ticket.ticketId}-${Date.now()}.html`;

  const filePath =
    path.join(
      __dirname,
      fileName
    );

  fs.writeFileSync(
    filePath,
    html
  );

  return {
    fileName,
    filePath
  };
}

// =====================================================
// SEND TRANSCRIPT
// =====================================================

async function sendTranscript(
  guild,
  channel,
  ticket
) {

  const s =
    settings(guild.id);

  if (
    !s.transcriptChannel
  ) {
    return;
  }

  const logChannel =
    guild.channels.cache.get(
      s.transcriptChannel
    );

  if (!logChannel) {
    return;
  }

  const transcript =
    await createTranscript(
      channel,
      ticket
    );

  try {

    await logChannel.send({

      embeds: [

        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(
            '📄 Ticket Transcript'
          )
          .setDescription(
            `Transcript generated for **${channel.name}**`
          )

          .addFields(

            {
              name:
                '🎫 Ticket',

              value:
                `\`${ticket.ticketId}\``,

              inline: true
            },

            {
              name:
                '👤 Owner',

              value:
                `<@${ticket.ownerId}>`,

              inline: true
            },

            {
              name:
                '📁 Type',

              value:
                ticket.type,

              inline: true
            },

            {
              name:
                '🕐 Opened',

              value:
                `<t:${timestamp(
                  ticket.createdAt
                )}:F>`,

              inline: true
            },

            {
              name:
                '🔒 Closed',

              value:
                `<t:${timestamp()}:F>`,

              inline: true
            }

          )
      ],

      files: [

        {
          attachment:
            transcript.filePath,

          name:
            transcript.fileName
        }

      ]

    });

  } catch (error) {

    console.error(
      'Transcript send error:',
      error
    );

  }

  try {

    fs.unlinkSync(
      transcript.filePath
    );

  } catch {}
}

// =====================================================
// DELETE TICKET
// =====================================================

async function deleteTicket(
  channel,
  reason = 'Ticket closed'
) {

  const ticket =
    getTicket(channel.id);

  if (!ticket) {
    return;
  }

  try {

    await sendTranscript(
      channel.guild,
      channel,
      ticket
    );

  } catch {}

  // Cancel pending vouches
  for (
    const vouch
    of Object.values(db.vouches)
  ) {

    if (
      vouch.ticketChannelId ===
        channel.id &&
      vouch.status ===
        'pending'
    ) {

      vouch.status =
        'cancelled';
    }
  }

  delete db.tickets[
    channel.id
  ];

  saveDB();

  try {

    await channel.delete(
      reason
    );

  } catch (error) {

    console.error(
      'Ticket delete error:',
      error
    );

  }
}

// =====================================================
// PANEL BUILDER
// =====================================================

async function showPanelBuilder(
  interaction,
  panel
) {

  const rows =
    panelButtons(panel);

  rows.push(

    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            `panel_add_${panel.id}`
          )
          .setLabel(
            panel.buttons.length >= 25
              ? '25 Button Limit'
              : 'Add Ticket Button'
          )
          .setEmoji('➕')
          .setStyle(
            ButtonStyle.Primary
          )
          .setDisabled(
            panel.buttons.length >= 25
          ),

        new ButtonBuilder()
          .setCustomId(
            `panel_publish_${panel.id}`
          )
          .setLabel(
            'Publish Panel'
          )
          .setEmoji('📢')
          .setStyle(
            ButtonStyle.Success
          )

      )

  );

  return interaction.update({

    content:
      `### 🎫 Ticket Panel Builder\nButtons: **${panel.buttons.length}/25**`,

    embeds: [

      panelEmbed(
        interaction.guild,
        panel
      )

    ],

    components:
      rows

  });
}

// =====================================================
// MESSAGE COMMANDS
// =====================================================

client.on(
  'messageCreate',
  async message => {

    if (
      message.author.bot ||
      !message.guild
    ) {
      return;
    }

    // Check vouch first
    await checkVouchMessage(
      message
    );

    const content =
      message.content.trim();

    if (
      !content.startsWith(
        PREFIX
      )
    ) {
      return;
    }

    const args =
      content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);

    const command =
      args
        .shift()
        ?.toLowerCase();

    // =================================================
    // HELP
    // =================================================

    if (
      command === 'thelp'
    ) {

      return message.reply({

        embeds: [

          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(
              '🎫 Advanced Ticket Bot'
            )
            .setDescription(
              'Professional ticket management system.'
            )

            .addFields(

              {
                name:
                  '⚙️ Setup',

                value:
                  '`.tsetting`\n' +
                  '`.tpanel`\n' +
                  '`.treminder #channel`'
              },

              {
                name:
                  '🎫 Ticket',

                value:
                  '`.vouch <amount>`\n' +
                  '`.rename <name>`\n' +
                  '`.delete`'
              }

            )

        ]

      });
    }

    // =================================================
    // TSETTING
    // =================================================

    if (
      command === 'tsetting'
    ) {

      if (
        !isAdmin(
          message.member
        )
      ) {

        return message.reply(
          '❌ You need **Administrator** permission.'
        );

      }

      const s =
        settings(
          message.guild.id
        );

      const embed =
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(
            '⚙️ Ticket Settings'
          )
          .setDescription(
            'Manage your ticket, vouch and embed settings below.'
          )

          .addFields(

            {
              name:
                '📄 Transcript',

              value:
                s.transcriptChannel
                  ? `<#${s.transcriptChannel}>`
                  : 'Not configured',

              inline: true
            },

            {
              name:
                '💸 Vouch Channel',

              value:
                s.vouchChannel
                  ? `<#${s.vouchChannel}>`
                  : 'Not configured',

              inline: true
            },

            {
              name:
                '👤 Vouch User',

              value:
                s.vouchUserId
                  ? `<@${s.vouchUserId}>`
                  : 'Not configured',

              inline: true
            },

            {
              name:
                '⏰ Reminder',

              value:
                `${s.reminderHours} hours`,

              inline: true
            },

            {
              name:
                '🛡️ Ticket Admin',

              value:
                s.adminRoles.length
                  ? s.adminRoles
                      .map(
                        id =>
                          `<@&${id}>`
                      )
                      .join(', ')
                  : 'Not configured'
            }

          );

      const row1 =
        new ActionRowBuilder()
          .addComponents(

            new ButtonBuilder()
              .setCustomId(
                'setting_transcript'
              )
              .setLabel(
                'Transcript'
              )
              .setEmoji('📄')
              .setStyle(
                ButtonStyle.Primary
              ),

            new ButtonBuilder()
              .setCustomId(
                'setting_vouch_channel'
              )
              .setLabel(
                'Vouch Channel'
              )
              .setEmoji('💸')
              .setStyle(
                ButtonStyle.Success
              ),

            new ButtonBuilder()
              .setCustomId(
                'setting_vouch_user'
              )
              .setLabel(
                'Vouch User'
              )
              .setEmoji('👤')
              .setStyle(
                ButtonStyle.Secondary
              )

          );

      const row2 =
        new ActionRowBuilder()
          .addComponents(

            new ButtonBuilder()
              .setCustomId(
                'setting_roles'
              )
              .setLabel(
                'Admin Roles'
              )
              .setEmoji('🛡️')
              .setStyle(
                ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(
                'setting_embeds'
              )
              .setLabel(
                'Embed Manager'
              )
              .setEmoji('🎨')
              .setStyle(
                ButtonStyle.Primary
              ),

            new ButtonBuilder()
              .setCustomId(
                'setting_reminder'
              )
              .setLabel(
                'Reminder'
              )
              .setEmoji('⏰')
              .setStyle(
                ButtonStyle.Success
              )

          );

      return message.reply({

        embeds: [
          embed
        ],

        components: [
          row1,
          row2
        ]

      });
    }

    // =================================================
    // TPANEL
    // =================================================

    if (
      command === 'tpanel'
    ) {

      if (
        !isAdmin(
          message.member
        )
      ) {

        return message.reply(
          '❌ You need **Administrator** permission.'
        );

      }

      const id =
        `${message.guild.id}_${Date.now()}`;

      db.panels[id] = {

        id,

        guildId:
          message.guild.id,

        title:
          '🎫 Support Tickets',

        description:
          'Select a ticket type below to open a ticket.',

        thumbnail:
          '',

        banner:
          '',

        color:
          '5865F2',

        buttons:
          []

      };

      saveDB();

      return message.reply({

        content:
          '🎫 Click below to configure your ticket panel.',

        components: [

          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()
                .setCustomId(
                  `panel_setup_${id}`
                )
                .setLabel(
                  'Create Ticket Panel'
                )
                .setEmoji('🎫')
                .setStyle(
                  ButtonStyle.Primary
                )

            )

        ]

      });
    }

    // =================================================
    // TREminder
    // =================================================

    if (
      command === 'treminder'
    ) {

      if (
        !isAdmin(
          message.member
        )
      ) {

        return message.reply(
          '❌ You need **Administrator** permission.'
        );

      }

      const channel =
        message.mentions.channels.first();

      if (!channel) {

        return message.reply(
          '❌ Usage: `.treminder #channel`'
        );

      }

      settings(
        message.guild.id
      ).reminderChannel =
        channel.id;

      saveDB();

      return message.reply(
        `✅ Vouch reminder channel set to ${channel}.`
      );
    }

    // =================================================
    // CURRENT TICKET
    // =================================================

    const ticket =
      getTicket(
        message.channel.id
      );

    // =================================================
    // DELETE
    // =================================================

    if (
      command === 'delete'
    ) {

      if (!ticket) {

        return message.reply(
          '❌ This command can only be used inside a ticket.'
        );

      }

      if (
        !isTicketAdmin(
          message.member,
          message.guild.id
        )
      ) {

        return message.reply(
          '❌ You do not have Ticket Admin permission.'
        );

      }

      await message.reply(
        '📄 Generating transcript and deleting ticket...'
      );

      return deleteTicket(
        message.channel,
        `Deleted by ${message.author.tag}`
      );
    }

    // =================================================
    // RENAME
    // =================================================

    if (
      command === 'rename'
    ) {

      if (!ticket) {

        return message.reply(
          '❌ This command can only be used inside a ticket.'
        );

      }

      if (
        !isTicketAdmin(
          message.member,
          message.guild.id
        )
      ) {

        return message.reply(
          '❌ You do not have Ticket Admin permission.'
        );

      }

      const newName =
        args
          .join('-')
          .toLowerCase()
          .replace(
            /[^a-z0-9-_]/g,
            '-'
          )
          .replace(
            /-+/g,
            '-'
          )
          .slice(
            0,
            90
          );

      if (!newName) {

        return message.reply(
          '❌ Usage: `.rename new-name`'
        );

      }

      await message.channel.setName(
        newName
      );

      return message.reply(
        `✅ Ticket renamed to **${newName}**`
      );
    }

    // =================================================
    // VOUCH
    // =================================================

    if (
      command === 'vouch'
    ) {

      if (!ticket) {

        return message.reply(
          '❌ `.vouch` can only be used inside a ticket.'
        );

      }

      if (
        !isTicketAdmin(
          message.member,
          message.guild.id
        )
      ) {

        return message.reply(
          '❌ You do not have Ticket Admin permission.'
        );

      }

      const amount =
        parseAmount(
          args[0]
        );

      if (!amount) {

        return message.reply(
          '❌ Usage: `.vouch 2`'
        );

      }

      const s =
        settings(
          message.guild.id
        );

      if (!s.vouchChannel) {

        return message.reply(
          '❌ Vouch channel is not configured. Use `.tsetting` first.'
        );

      }

      if (!s.vouchUserId) {

        return message.reply(
          '❌ Vouch User is not configured. Open `.tsetting` and select the user.'
        );

      }

      const vouchId =
        `${message.channel.id}_${Date.now()}`;

      db.vouches[vouchId] = {

        id:
          vouchId,

        guildId:
          message.guild.id,

        ticketChannelId:
          message.channel.id,

        ticketId:
          ticket.ticketId,

        recipientId:
          ticket.ownerId,

        sentById:
          s.vouchUserId,

        amount:
          amount,

        vouchChannelId:
          s.vouchChannel,

        status:
          'pending',

        createdAt:
          Date.now(),

        reminderAt:
          Date.now() +
          (
            Number(
              s.reminderHours
            ) *
            60 *
            60 *
            1000
          )

      };

      saveDB();

      return message.channel.send({

        embeds: [

          makeEmbed(
            message.guild,
            'vouch',
            {
              owner:
                ticket.ownerId,

              ownerAvatar:
                ticket.ownerAvatar,

              amount:
                formatAmount(
                  amount
                ),

              vouchChannel:
                `<#${s.vouchChannel}>`,

              user:
                s.vouchUserId,

              ticketId:
                ticket.ticketId
            }
          )

        ],

        components: [

          vouchButtonRow(
            vouchId
          )

        ]

      });
    }
  }
);
// =====================================================
// INTERACTION HANDLER
// =====================================================

client.on(
  'interactionCreate',
  async interaction => {

    try {

      // =================================================
      // BUTTONS
      // =================================================

      if (
        interaction.isButton()
      ) {

        const id =
          interaction.customId;

        // -----------------------------------------------
        // COPY VOUCH
        // -----------------------------------------------

        if (
          id.startsWith(
            'copy_vouch_'
          )
        ) {

          const vouchId =
            id.replace(
              'copy_vouch_',
              ''
            );

          const vouch =
            db.vouches[vouchId];

          if (!vouch) {

            return interaction.reply({

              content:
                '❌ This vouch request no longer exists.',

              ephemeral: true

            });

          }

          const s =
            settings(
              interaction.guild.id
            );

          const mention =
            s.vouchUserId
              ? `<@${s.vouchUserId}>`
              : '@user';

          const format =
            `Legit got $${formatAmount(
              vouch.amount
            )} from ${mention}`;

          return interaction.reply({

            content:
              `\`${format}\``,

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // CLOSE TICKET
        // -----------------------------------------------

        if (
          id ===
          'ticket_close'
        ) {

          const ticket =
            getTicket(
              interaction.channel.id
            );

          if (!ticket) {

            return interaction.reply({

              content:
                '❌ This is not a ticket.',

              ephemeral: true

            });

          }

          if (
            !isTicketAdmin(
              interaction.member,
              interaction.guild.id
            )
          ) {

            return interaction.reply({

              content:
                '❌ Only Ticket Admins can close this ticket.',

              ephemeral: true

            });

          }

          await interaction.reply({

            content:
              '🔒 Closing ticket and generating transcript...',

            ephemeral: true

          });

          return deleteTicket(
            interaction.channel,
            `Closed by ${interaction.user.tag}`
          );

        }

        // -----------------------------------------------
        // TRANSCRIPT CHANNEL
        // -----------------------------------------------

        if (
          id ===
          'setting_transcript'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          return interaction.reply({

            content:
              '📄 Select the channel where ticket transcripts should be sent.',

            components: [

              new ActionRowBuilder()
                .addComponents(

                  new ChannelSelectMenuBuilder()
                    .setCustomId(
                      'select_transcript_channel'
                    )
                    .setPlaceholder(
                      'Select transcript channel'
                    )
                    .setChannelTypes(
                      ChannelType.GuildText
                    )

                )

            ],

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // VOUCH CHANNEL
        // -----------------------------------------------

        if (
          id ===
          'setting_vouch_channel'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          return interaction.reply({

            content:
              '💸 Select the channel where members must post their vouch.',

            components: [

              new ActionRowBuilder()
                .addComponents(

                  new ChannelSelectMenuBuilder()
                    .setCustomId(
                      'select_vouch_channel'
                    )
                    .setPlaceholder(
                      'Select vouch channel'
                    )
                    .setChannelTypes(
                      ChannelType.GuildText
                    )

                )

            ],

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // VOUCH USER
        // -----------------------------------------------

        if (
          id ===
          'setting_vouch_user'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          return interaction.reply({

            content:
              '👤 Select the user who should be mentioned in the vouch format.',

            components: [

              new ActionRowBuilder()
                .addComponents(

                  new UserSelectMenuBuilder()
                    .setCustomId(
                      'select_vouch_user'
                    )
                    .setPlaceholder(
                      'Select vouch user'
                    )
                    .setMaxValues(1)

                )

            ],

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // ADMIN ROLES
        // -----------------------------------------------

        if (
          id ===
          'setting_roles'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          return interaction.reply({

            content:
              '🛡️ Select the roles that can manage tickets.',

            components: [

              new ActionRowBuilder()
                .addComponents(

                  new RoleSelectMenuBuilder()
                    .setCustomId(
                      'select_admin_roles'
                    )
                    .setPlaceholder(
                      'Select Ticket Admin roles'
                    )
                    .setMinValues(1)
                    .setMaxValues(10)

                )

            ],

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // REMINDER SETTINGS
        // -----------------------------------------------

        if (
          id ===
          'setting_reminder'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const modal =
            new ModalBuilder()
              .setCustomId(
                'reminder_modal'
              )
              .setTitle(
                '⏰ Vouch Reminder Settings'
              );

          const hours =
            new TextInputBuilder()
              .setCustomId(
                'reminder_hours'
              )
              .setLabel(
                'Reminder after how many hours?'
              )
              .setPlaceholder(
                'Example: 12'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true)
              .setValue(
                String(
                  settings(
                    interaction.guild.id
                  ).reminderHours
                )
              );

          modal.addComponents(

            new ActionRowBuilder()
              .addComponents(
                hours
              )

          );

          return interaction.showModal(
            modal
          );

        }

        // -----------------------------------------------
        // EMBED MANAGER
        // -----------------------------------------------

        if (
          id ===
          'setting_embeds'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const row1 =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setCustomId(
                    'embed_edit_ticket'
                  )
                  .setLabel(
                    'Ticket Embed'
                  )
                  .setEmoji('🎫')
                  .setStyle(
                    ButtonStyle.Primary
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    'embed_edit_vouch'
                  )
                  .setLabel(
                    'Vouch Embed'
                  )
                  .setEmoji('💸')
                  .setStyle(
                    ButtonStyle.Success
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    'embed_edit_thankyou'
                  )
                  .setLabel(
                    'Thank You'
                  )
                  .setEmoji('❤️')
                  .setStyle(
                    ButtonStyle.Success
                  )

              );

          const row2 =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setCustomId(
                    'embed_edit_reminder'
                  )
                  .setLabel(
                    'Reminder'
                  )
                  .setEmoji('⏰')
                  .setStyle(
                    ButtonStyle.Secondary
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    'embed_reset_all'
                  )
                  .setLabel(
                    'Reset Embeds'
                  )
                  .setEmoji('♻️')
                  .setStyle(
                    ButtonStyle.Danger
                  )

              );

          return interaction.reply({

            content:
              '🎨 **Embed Manager**\n\nSelect which embed you want to edit.',

            components: [
              row1,
              row2
            ],

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // EMBED EDIT BUTTONS
        // -----------------------------------------------

        if (
          id.startsWith(
            'embed_edit_'
          )
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const type =
            id.replace(
              'embed_edit_',
              ''
            );

          const embed =
            settings(
              interaction.guild.id
            ).embeds[type];

          if (!embed) {

            return interaction.reply({

              content:
                '❌ Embed not found.',

              ephemeral: true

            });

          }

          const modal =
            new ModalBuilder()
              .setCustomId(
                `embed_modal_${type}`
              )
              .setTitle(
                `Edit ${type} Embed`
              );

          const title =
            new TextInputBuilder()
              .setCustomId(
                'embed_title'
              )
              .setLabel(
                'Title'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(false)
              .setValue(
                String(
                  embed.title || ''
                ).slice(0, 256)
              );

          const description =
            new TextInputBuilder()
              .setCustomId(
                'embed_description'
              )
              .setLabel(
                'Description'
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(false)
              .setValue(
                String(
                  embed.description || ''
                ).slice(0, 4000)
              );

          const color =
            new TextInputBuilder()
              .setCustomId(
                'embed_color'
              )
              .setLabel(
                'Color HEX'
              )
              .setPlaceholder(
                '5865F2'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(false)
              .setValue(
                String(
                  embed.color ||
                  '5865F2'
                )
              );

          const footer =
            new TextInputBuilder()
              .setCustomId(
                'embed_footer'
              )
              .setLabel(
                'Footer'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(false)
              .setValue(
                String(
                  embed.footer || ''
                ).slice(0, 2000)
              );

          modal.addComponents(

            new ActionRowBuilder()
              .addComponents(
                title
              ),

            new ActionRowBuilder()
              .addComponents(
                description
              ),

            new ActionRowBuilder()
              .addComponents(
                color
              ),

            new ActionRowBuilder()
              .addComponents(
                footer
              )

          );

          return interaction.showModal(
            modal
          );

        }

        // -----------------------------------------------
        // RESET EMBEDS
        // -----------------------------------------------

        if (
          id ===
          'embed_reset_all'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          settings(
            interaction.guild.id
          ).embeds =
            defaultEmbeds();

          saveDB();

          return interaction.reply({

            content:
              '♻️ All embeds have been reset to default.',

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // PANEL SETUP
        // -----------------------------------------------

        if (
          id.startsWith(
            'panel_setup_'
          )
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const panelId =
            id.replace(
              'panel_setup_',
              ''
            );

          const panel =
            db.panels[
              panelId
            ];

          if (!panel) {

            return interaction.reply({

              content:
                '❌ Panel expired.',

              ephemeral: true

            });

          }

          return showPanelBuilder(
            interaction,
            panel
          );

        }

        // -----------------------------------------------
        // ADD PANEL BUTTON
        // -----------------------------------------------

        if (
          id.startsWith(
            'panel_add_'
          )
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const panelId =
            id.replace(
              'panel_add_',
              ''
            );

          const panel =
            db.panels[
              panelId
            ];

          if (!panel) {

            return interaction.reply({

              content:
                '❌ Panel not found.',

              ephemeral: true

            });

          }

          if (
            panel.buttons.length >= 25
          ) {

            return interaction.reply({

              content:
                '❌ Maximum 25 buttons allowed.',

              ephemeral: true

            });

          }

          const modal =
            new ModalBuilder()
              .setCustomId(
                `panel_button_modal_${panelId}`
              )
              .setTitle(
                '➕ Add Ticket Button'
              );

          const name =
            new TextInputBuilder()
              .setCustomId(
                'button_name'
              )
              .setLabel(
                'Button Name'
              )
              .setPlaceholder(
                'Support'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true)
              .setMaxLength(80);

          const category =
            new TextInputBuilder()
              .setCustomId(
                'button_category'
              )
              .setLabel(
                'Category Channel ID'
              )
              .setPlaceholder(
                '123456789012345678'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true);

          const emoji =
            new TextInputBuilder()
              .setCustomId(
                'button_emoji'
              )
              .setLabel(
                'Emoji'
              )
              .setPlaceholder(
                '🎫'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(false);

          const style =
            new TextInputBuilder()
              .setCustomId(
                'button_style'
              )
              .setLabel(
                'Style'
              )
              .setPlaceholder(
                'primary / success / danger / secondary'
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(false)
              .setValue(
                'primary'
              );

          modal.addComponents(

            new ActionRowBuilder()
              .addComponents(
                name
              ),

            new ActionRowBuilder()
              .addComponents(
                category
              ),

            new ActionRowBuilder()
              .addComponents(
                emoji
              ),

            new ActionRowBuilder()
              .addComponents(
                style
              )

          );

          return interaction.showModal(
            modal
          );

        }

        // -----------------------------------------------
        // PUBLISH PANEL
        // -----------------------------------------------

        if (
          id.startsWith(
            'panel_publish_'
          )
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const panelId =
            id.replace(
              'panel_publish_',
              ''
            );

          const panel =
            db.panels[
              panelId
            ];

          if (!panel) {

            return interaction.reply({

              content:
                '❌ Panel not found.',

              ephemeral: true

            });

          }

          if (
            !panel.buttons.length
          ) {

            return interaction.reply({

              content:
                '❌ Add at least one ticket button first.',

              ephemeral: true

            });

          }

          await interaction.channel.send({

            embeds: [

              panelEmbed(
                interaction.guild,
                panel
              )

            ],

            components:
              panelButtons(panel)

          });

          return interaction.reply({

            content:
              '✅ Ticket panel published successfully.',

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // OPEN TICKET
        // -----------------------------------------------

        if (
          id.startsWith(
            'ticket_open_'
          )
        ) {

          const buttonId =
            id.replace(
              'ticket_open_',
              ''
            );

          let selectedButton = null;

          for (
            const panel
            of Object.values(
              db.panels
            )
          ) {

            const found =
              panel.buttons.find(
                b =>
                  b.id ===
                  buttonId
              );

            if (found) {

              selectedButton =
                found;

              break;
            }
          }

          if (!selectedButton) {

            return interaction.reply({

              content:
                '❌ This ticket button is no longer active.',

              ephemeral: true

            });

          }

          const existing =
            Object.values(
              db.tickets
            ).find(
              t =>
                t.guildId ===
                  interaction.guild.id &&
                t.ownerId ===
                  interaction.user.id &&
                t.status ===
                  'open'
            );

          if (existing) {

            return interaction.reply({

              content:
                `❌ You already have an open ticket: <#${existing.channelId}>`,

              ephemeral: true

            });

          }

          const category =
            interaction.guild.channels.cache.get(
              selectedButton.categoryId
            );

          if (
            !category ||
            category.type !==
              ChannelType.GuildCategory
          ) {

            return interaction.reply({

              content:
                '❌ The configured ticket category is invalid or missing.',

              ephemeral: true

            });

          }

          const ticketNumber =
            Object.keys(
              db.tickets
            ).length + 1;

          const ticketId =
            String(
              ticketNumber
            ).padStart(
              4,
              '0'
            );

          const channelName =
            `${interaction.user.username}-${ticketId}`
              .toLowerCase()
              .replace(
                /[^a-z0-9-_]/g,
                '-'
              )
              .slice(
                0,
                95
              );

          const channel =
            await interaction.guild.channels.create({

              name:
                channelName,

              type:
                ChannelType.GuildText,

              parent:
                category.id,

              permissionOverwrites: [

                {
                  id:
                    interaction.guild.roles.everyone.id,

                  deny: [
                    PermissionsBitField.Flags.ViewChannel
                  ]
                },

                {
                  id:
                    interaction.user.id,

                  allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.AttachFiles
                  ]
                }

              ]

            });

          const ticketData = {

            channelId:
              channel.id,

            guildId:
              interaction.guild.id,

            ownerId:
              interaction.user.id,

            ownerTag:
              interaction.user.tag,

            ownerAvatar:
              interaction.user.displayAvatarURL({
                extension: 'png',
                size: 256
              }),

            ticketId,

            type:
              selectedButton.name,

            createdAt:
              Date.now(),

            status:
              'open'

          };

          db.tickets[
            channel.id
          ] = ticketData;

          saveDB();

          await channel.send({

            content:
              `<@${interaction.user.id}>`,

            embeds: [

              makeEmbed(
                interaction.guild,
                'ticket',
                {
                  owner:
                    interaction.user.id,

                  ownerAvatar:
                    ticketData.ownerAvatar,

                  type:
                    selectedButton.name,

                  ticketId,

                  created:
                    timestamp(
                      ticketData.createdAt
                    )
                }
              )

            ],

            components: [

              closeButtonRow()

            ]

          });

          return interaction.reply({

            content:
              `✅ Ticket created: ${channel}`,

            ephemeral: true

          });

        }
      }

      // =================================================
      // SELECT MENUS
      // =================================================

      if (
        interaction.isChannelSelectMenu()
      ) {

        if (
          !isAdmin(
            interaction.member
          )
        ) {

          return interaction.reply({

            content:
              '❌ Administrator permission required.',

            ephemeral: true

          });

        }

        const channelId =
          interaction.values[0];

        if (
          interaction.customId ===
          'select_transcript_channel'
        ) {

          settings(
            interaction.guild.id
          ).transcriptChannel =
            channelId;

          saveDB();

          return interaction.update({

            content:
              `✅ Transcript channel set to <#${channelId}>`,

            components: []

          });

        }

        if (
          interaction.customId ===
          'select_vouch_channel'
        ) {

          settings(
            interaction.guild.id
          ).vouchChannel =
            channelId;

          saveDB();

          return interaction.update({

            content:
              `✅ Vouch channel set to <#${channelId}>`,

            components: []

          });

        }

      }

      // =================================================
      // USER SELECT
      // =================================================

      if (
        interaction.isUserSelectMenu()
      ) {

        if (
          interaction.customId ===
          'select_vouch_user'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const userId =
            interaction.values[0];

          settings(
            interaction.guild.id
          ).vouchUserId =
            userId;

          saveDB();

          return interaction.update({

            content:
              `✅ Vouch user set to <@${userId}>.\n\nThe vouch format will now use this user.`,

            components: []

          });

        }

      }

      // =================================================
      // ROLE SELECT
      // =================================================

      if (
        interaction.isRoleSelectMenu()
      ) {

        if (
          interaction.customId ===
          'select_admin_roles'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          settings(
            interaction.guild.id
          ).adminRoles =
            interaction.values;

          saveDB();

          return interaction.update({

            content:
              `✅ Ticket Admin roles updated.\n\n${interaction.values.map(id => `<@&${id}>`).join(', ')}`,

            components: []

          });

        }

      }

      // =================================================
      // MODALS
      // =================================================

      if (
        interaction.isModalSubmit()
      ) {

        // -----------------------------------------------
        // REMINDER MODAL
        // -----------------------------------------------

        if (
          interaction.customId ===
          'reminder_modal'
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const hours =
            Number(
              interaction.fields.getTextInputValue(
                'reminder_hours'
              )
            );

          if (
            !Number.isFinite(hours) ||
            hours < 1 ||
            hours > 168
          ) {

            return interaction.reply({

              content:
                '❌ Enter a number between 1 and 168 hours.',

              ephemeral: true

            });

          }

          settings(
            interaction.guild.id
          ).reminderHours =
            hours;

          saveDB();

          return interaction.reply({

            content:
              `✅ Vouch reminder set to **${hours} hours**.`,

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // EMBED MODAL
        // -----------------------------------------------

        if (
          interaction.customId.startsWith(
            'embed_modal_'
          )
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const type =
            interaction.customId.replace(
              'embed_modal_',
              ''
            );

          const s =
            settings(
              interaction.guild.id
            );

          const embed =
            s.embeds[type];

          if (!embed) {

            return interaction.reply({

              content:
                '❌ Embed not found.',

              ephemeral: true

            });

          }

          const title =
            interaction.fields.getTextInputValue(
              'embed_title'
            );

          const description =
            interaction.fields.getTextInputValue(
              'embed_description'
            );

          const color =
            interaction.fields.getTextInputValue(
              'embed_color'
            );

          const footer =
            interaction.fields.getTextInputValue(
              'embed_footer'
            );

          if (
            color &&
            !/^[0-9a-f]{6}$/i.test(
              color.replace('#', '')
            )
          ) {

            return interaction.reply({

              content:
                '❌ Invalid HEX color. Example: `5865F2`',

              ephemeral: true

            });

          }

          embed.title =
            title ||
            embed.title;

          embed.description =
            description ||
            embed.description;

          embed.color =
            color
              .replace('#', '') ||
            embed.color;

          embed.footer =
            footer;

          saveDB();

          return interaction.reply({

            content:
              `✅ **${type}** embed updated successfully.`,

            ephemeral: true

          });

        }

        // -----------------------------------------------
        // PANEL BUTTON MODAL
        // -----------------------------------------------

        if (
          interaction.customId.startsWith(
            'panel_button_modal_'
          )
        ) {

          if (
            !isAdmin(
              interaction.member
            )
          ) {

            return interaction.reply({

              content:
                '❌ Administrator permission required.',

              ephemeral: true

            });

          }

          const panelId =
            interaction.customId.replace(
              'panel_button_modal_',
              ''
            );

          const panel =
            db.panels[
              panelId
            ];

          if (!panel) {

            return interaction.reply({

              content:
                '❌ Panel not found.',

              ephemeral: true

            });

          }

          const name =
            interaction.fields.getTextInputValue(
              'button_name'
            );

          const categoryId =
            interaction.fields.getTextInputValue(
              'button_category'
            ).trim();

          const emoji =
            interaction.fields.getTextInputValue(
              'button_emoji'
            ).trim();

          const style =
            interaction.fields.getTextInputValue(
              'button_style'
            )
            .trim()
            .toLowerCase();

          const category =
            interaction.guild.channels.cache.get(
              categoryId
            );

          if (
            !category ||
            category.type !==
              ChannelType.GuildCategory
          ) {

            return interaction.reply({

              content:
                '❌ Invalid Category ID. Please use the ID of a Category channel.',

              ephemeral: true

            });

          }

          const allowedStyles = [
            'primary',
            'success',
            'danger',
            'secondary'
          ];

          panel.buttons.push({

            id:
              `${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 7)}`,

            name,

            categoryId,

            emoji,

            style:
              allowedStyles.includes(
                style
              )
                ? style
                : 'primary'

          });

          saveDB();

          await interaction.reply({

            content:
              '✅ Ticket button added.',

            ephemeral: true

          });

        }
      }

    } catch (error) {

      console.error(
        'Interaction error:',
        error
      );

      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {

          await interaction.followUp({

            content:
              '❌ Something went wrong.',

            ephemeral: true

          });

        } else {

          await interaction.reply({

            content:
              '❌ Something went wrong.',

            ephemeral: true

          });

        }

      } catch {}

    }

  }
);
// =====================================================
// VOUCH VERIFICATION
// =====================================================

async function checkVouchMessage(message) {

  if (
    !message.guild ||
    message.author.bot
  ) {
    return;
  }

  const s =
    settings(
      message.guild.id
    );

  // Vouch channel configured hai?
  if (
    !s.vouchChannel ||
    message.channel.id !==
      s.vouchChannel
  ) {
    return;
  }

  const content =
    message.content.trim();

  // ---------------------------------------------------
  // Pending vouch requests
  // ---------------------------------------------------

  const pending =
    Object.values(
      db.vouches
    ).filter(
      vouch =>
        vouch.guildId ===
          message.guild.id &&
        vouch.vouchChannelId ===
          message.channel.id &&
        vouch.status ===
          'pending'
    );

  if (!pending.length) {
    return;
  }

  // ---------------------------------------------------
  // Check every pending vouch
  // ---------------------------------------------------

  for (
    const vouch
    of pending
  ) {

    // -----------------------------------------------
    // Only ticket owner can vouch
    // -----------------------------------------------

    if (
      message.author.id !==
      vouch.recipientId
    ) {
      continue;
    }

    // -----------------------------------------------
    // Required amount
    // -----------------------------------------------

    const amount =
      formatAmount(
        vouch.amount
      );

    // -----------------------------------------------
    // Configured vouch user
    // -----------------------------------------------

    const configuredUser =
      s.vouchUserId
        ? `<@${s.vouchUserId}>`
        : '';

    const configuredUserId =
      s.vouchUserId || '';

    // -----------------------------------------------
    // Normalize text
    // -----------------------------------------------

    const normalized =
      content
        .toLowerCase()
        .replace(
          /[`*_~]/g,
          ''
        )
        .replace(
          /\s+/g,
          ' '
        )
        .trim();

    // -----------------------------------------------
    // Possible valid formats
    // -----------------------------------------------

    const expectedWithMention =
      `legit got $${amount} from ${configuredUser}`
        .toLowerCase();

    const expectedWithUser =
      `legit got $${amount} from <@${configuredUserId}>`
        .toLowerCase();

    const expectedWithoutDollar =
      `legit got ${amount} from ${configuredUser}`
        .toLowerCase();

    // -----------------------------------------------
    // Also allow a few natural variations
    // -----------------------------------------------

    const validExact =
      normalized ===
        expectedWithMention ||

      normalized ===
        expectedWithUser ||

      normalized ===
        expectedWithoutDollar;

    // -----------------------------------------------
    // Flexible verification
    // -----------------------------------------------

    const amountRegex =
      new RegExp(
        `\\$?${escapeRegex(amount)}`
      );

    const hasLegit =
      normalized.includes(
        'legit got'
      );

    const hasFrom =
      normalized.includes(
        ' from '
      );

    const hasAmount =
      amountRegex.test(
        normalized
      );

    const hasConfiguredUser =
      configuredUserId &&
      (
        content.includes(
          `<@${configuredUserId}>`
        ) ||
        content.includes(
          `<@!${configuredUserId}>`
        )
      );

    const flexibleValid =
      hasLegit &&
      hasFrom &&
      hasAmount &&
      hasConfiguredUser;

    if (
      !validExact &&
      !flexibleValid
    ) {
      continue;
    }

    // -----------------------------------------------
    // Mark verified
    // -----------------------------------------------

    vouch.status =
      'verified';

    vouch.verifiedAt =
      Date.now();

    vouch.vouchMessageId =
      message.id;

    vouch.vouchAuthorId =
      message.author.id;

    saveDB();

    // -----------------------------------------------
    // React to vouch
    // -----------------------------------------------

    try {

      await message.react('✅');

    } catch {}

    // -----------------------------------------------
    // Find ticket
    // -----------------------------------------------

    const ticket =
      getTicket(
        vouch.ticketChannelId
      );

    if (!ticket) {
      continue;
    }

    const ticketChannel =
      message.guild.channels.cache.get(
        vouch.ticketChannelId
      );

    if (!ticketChannel) {
      continue;
    }

    // -----------------------------------------------
    // Thank You Embed
    // -----------------------------------------------

    try {

      await ticketChannel.send({

        embeds: [

          makeEmbed(
            message.guild,
            'thankyou',
            {
              owner:
                ticket.ownerId,

              ownerAvatar:
                ticket.ownerAvatar,

              amount:
                amount,

              user:
                s.vouchUserId,

              ticketId:
                ticket.ticketId
            }
          )

        ]

      });

    } catch (error) {

      console.error(
        'Thank you embed error:',
        error
      );

    }

    // -----------------------------------------------
    // Optional transcript before deletion
    // -----------------------------------------------

    setTimeout(
      async () => {

        const currentTicket =
          getTicket(
            ticketChannel.id
          );

        if (!currentTicket) {
          return;
        }

        await deleteTicket(
          ticketChannel,
          'Vouch verified - automatic deletion'
        );

      },
      5 * 60 * 1000
    );

  }

}

// =====================================================
// ESCAPE REGEX
// =====================================================

function escapeRegex(
  string
) {

  return String(
    string
  ).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

}

// =====================================================
// VOUCH REMINDER SYSTEM
// =====================================================

async function checkVouchReminders() {

  const now =
    Date.now();

  for (
    const vouch
    of Object.values(
      db.vouches
    )
  ) {

    if (
      vouch.status !==
      'pending'
    ) {
      continue;
    }

    if (
      !vouch.reminderAt ||
      now <
      vouch.reminderAt
    ) {
      continue;
    }

    const guild =
      client.guilds.cache.get(
        vouch.guildId
      );

    if (!guild) {
      continue;
    }

    const s =
      settings(
        guild.id
      );

    // -----------------------------------------------
    // Reminder channel
    // -----------------------------------------------

    const reminderChannelId =
      s.reminderChannel ||
      s.vouchChannel;

    if (
      !reminderChannelId
    ) {
      continue;
    }

    const channel =
      guild.channels.cache.get(
        reminderChannelId
      );

    if (!channel) {
      continue;
    }

    // -----------------------------------------------
    // Prevent duplicate reminder
    // -----------------------------------------------

    if (
      vouch.reminderSent
    ) {
      continue;
    }

    try {

      await channel.send({

        content:
          `<@${vouch.recipientId}>`,

        embeds: [

          makeEmbed(
            guild,
            'reminder',
            {
              owner:
                vouch.recipientId,

              vouchChannel:
                `<#${vouch.vouchChannelId}>`,

              amount:
                formatAmount(
                  vouch.amount
                )
            }
          )

        ]

      });

      vouch.reminderSent =
        true;

      vouch.reminderSentAt =
        Date.now();

      saveDB();

    } catch (error) {

      console.error(
        'Reminder error:',
        error
      );

    }

  }

}

// =====================================================
// REMINDER LOOP
// =====================================================

setInterval(
  async () => {

    try {

      await checkVouchReminders();

    } catch (error) {

      console.error(
        'Reminder loop error:',
        error
      );

    }

  },
  60 * 1000
);

// =====================================================
// CLEAN OLD VOUCH DATA
// =====================================================

setInterval(
  () => {

    const cutoff =
      Date.now() -
      (
        30 *
        24 *
        60 *
        60 *
        1000
      );

    let changed = false;

    for (
      const [
        id,
        vouch
      ]
      of Object.entries(
        db.vouches
      )
    ) {

      if (
        vouch.createdAt &&
        vouch.createdAt <
        cutoff
      ) {

        delete db.vouches[
          id
        ];

        changed = true;

      }

    }

    if (changed) {
      saveDB();
    }

  },
  6 * 60 * 60 * 1000
);

// =====================================================
// BOT READY
// =====================================================

client.once(
  'ready',
  () => {

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `🎫 Advanced Ticket System is online`
    );

    console.log(
      `💸 Vouch system enabled`
    );

    console.log(
      `⏰ Vouch reminder system enabled`
    );

    client.user.setPresence({

      activities: [

        {
          name:
            'Advanced Tickets',
          type: 3
        }

      ],

      status:
        'online'

    });

  }
);

// =====================================================
// ERROR HANDLING
// =====================================================

client.on(
  'error',
  error => {

    console.error(
      'Discord client error:',
      error
    );

  }
);

process.on(
  'unhandledRejection',
  error => {

    console.error(
      'Unhandled rejection:',
      error
    );

  }
);

process.on(
  'uncaughtException',
  error => {

    console.error(
      'Uncaught exception:',
      error
    );

  }
);

// =====================================================
// LOGIN
// =====================================================

const TOKEN =
  process.env.DISCORD_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  process.env.TOKEN;

if (!TOKEN) {

  console.error(
    '❌ Discord bot token not found in .env'
  );

  process.exit(1);

}

client.login(
  TOKEN
);
// =====================================================
// EXTRA ADMIN COMMANDS
// =====================================================

// .vsetting
// Quick view of current vouch configuration

client.on(
  'messageCreate',
  async message => {

    if (
      message.author.bot ||
      !message.guild ||
      !message.content.startsWith('.')
    ) {
      return;
    }

    const args =
      message.content
        .slice(1)
        .trim()
        .split(/\s+/);

    const command =
      args.shift()?.toLowerCase();

    // =================================================
    // VSETTING
    // =================================================

    if (
      command === 'vsetting'
    ) {

      if (
        !isAdmin(
          message.member
        )
      ) {
        return message.reply(
          '❌ Administrator permission required.'
        );
      }

      const s =
        settings(
          message.guild.id
        );

      const embed =
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(
            '💸 Vouch System Settings'
          )
          .setDescription(
            'Current vouch configuration for this server.'
          )
          .addFields(

            {
              name:
                '💬 Vouch Channel',

              value:
                s.vouchChannel
                  ? `<#${s.vouchChannel}>`
                  : '❌ Not configured',

              inline: true
            },

            {
              name:
                '👤 Vouch User',

              value:
                s.vouchUserId
                  ? `<@${s.vouchUserId}>`
                  : '❌ Not configured',

              inline: true
            },

            {
              name:
                '⏰ Reminder',

              value:
                `${s.reminderHours} hours`,

              inline: true
            },

            {
              name:
                '📄 Transcript',

              value:
                s.transcriptChannel
                  ? `<#${s.transcriptChannel}>`
                  : '❌ Not configured',

              inline: true
            }

          )
          .setFooter({
            text:
              `${message.guild.name} • Vouch System`
          });

      return message.reply({
        embeds: [
          embed
        ]
      });

    }

    // =================================================
    // RESET VOUCHES
    // =================================================

    if (
      command === 'vreset'
    ) {

      if (
        !isAdmin(
          message.member
        )
      ) {
        return message.reply(
          '❌ Administrator permission required.'
        );
      }

      let count = 0;

      for (
        const vouch
        of Object.values(
          db.vouches
        )
      ) {

        if (
          vouch.guildId ===
          message.guild.id
        ) {

          vouch.status =
            'cancelled';

          count++;

        }

      }

      saveDB();

      return message.reply(
        `♻️ Cancelled **${count}** pending vouch request(s).`
      );

    }

  }
);

// =====================================================
// AUTO SAVE
// =====================================================

setInterval(
  () => {

    try {

      saveDB();

    } catch (error) {

      console.error(
        'Auto-save error:',
        error
      );

    }

  },
  5 * 60 * 1000
);

// =====================================================
// SHUTDOWN SAVE
// =====================================================

process.on(
  'SIGINT',
  () => {

    try {
      saveDB();
    } catch {}

    client.destroy();

    process.exit(
      0
    );

  }
);

process.on(
  'SIGTERM',
  () => {

    try {
      saveDB();
    } catch {}

    client.destroy();

    process.exit(
      0
    );

  }
);

// =====================================================
// END OF INDEX.JS
// =====================================================
//
// IMPORTANT
// -----------------------------------------------------
// .env file:
//
// DISCORD_TOKEN=YOUR_BOT_TOKEN
//
// -----------------------------------------------------
// package.json dependencies:
//
// discord.js
// dotenv
//
// -----------------------------------------------------
// Required Bot Intents in Discord Developer Portal:
//
// ✅ Server Members Intent
// ✅ Message Content Intent
//
//
// Required bot permissions:
//
// ✅ View Channels
// ✅ Send Messages
// ✅ Embed Links
// ✅ Read Message History
// ✅ Manage Channels
// ✅ Manage Messages
// ✅ Attach Files
//
//
// -----------------------------------------------------
// MAIN COMMANDS
// -----------------------------------------------------
//
// .thelp
// .tsetting
// .tpanel
// .treminder #channel
// .vsetting
// .vouch 2
// .rename new-name
// .delete
// .vreset
//
// -----------------------------------------------------
// VOUCH FLOW
// -----------------------------------------------------
//
// 1. Admin uses:
//
//    .vouch 2
//
// 2. Bot sends a Vouch Required embed.
//
// 3. User clicks:
//
//    📋 Copy Vouch
//
// 4. Bot gives:
//
//    Legit got $2 from @configured-user
//
// 5. Ticket owner posts the vouch
//    in the configured Vouch Channel.
//
// 6. Bot checks:
//
//    - Correct ticket owner
//    - Correct amount
//    - "Legit got"
//    - "from"
//    - Configured user mention
//
// 7. Bot reacts:
//
//    ✅
//
// 8. Bot sends Thank You embed
//    inside the ticket.
//
// 9. Ticket remains open for:
//
//    5 minutes
//
// 10. Bot creates transcript.
//
// 11. Ticket is deleted.
//
// -----------------------------------------------------
// VOUCH REMINDER
// -----------------------------------------------------
//
// If the owner doesn't vouch within the
// configured reminder time:
//
// Bot sends a reminder in the configured
// reminder channel.
//
// Default:
//
// 12 hours
//
// -----------------------------------------------------
// EMBED MANAGEMENT
// -----------------------------------------------------
//
// .tsetting
//
// Then:
//
// 🎨 Embed Manager
//
// You can edit:
//
// 🎫 Ticket Embed
// 💸 Vouch Embed
// ❤️ Thank You Embed
// ⏰ Reminder Embed
//
// Editable:
//
// Title
// Description
// HEX Color
// Footer
//
// -----------------------------------------------------
// DATABASE
// -----------------------------------------------------
//
// tickets.json is automatically created.
//
// DO NOT manually delete tickets.json
// while the bot is running.
//
// -----------------------------------------------------
//
// END
// =====================================================
