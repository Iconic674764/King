const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    PermissionFlagsBits
} = require('discord.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const axios = require('axios');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let db;
const tournamentSetupCache = new Map();
const PREFIX = '!';

// --------------------------------------------------------------------------
// 🗄️ SECURE PERSISTENT DATABASE SETUP
// --------------------------------------------------------------------------
async function setupDatabase() {
    const database = await open({
        filename: './poker_bot_database.db',
        driver: sqlite3.Database
    });

    await database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            balance REAL DEFAULT 0.0,
            last_deposit REAL DEFAULT 0.0
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS tournaments (
            id TEXT PRIMARY KEY,
            title TEXT,
            prize_structure TEXT,
            rules TEXT,
            link TEXT,
            entry_fee REAL DEFAULT 0,
            required_role TEXT,
            house_edge REAL DEFAULT 4.0
        );
        CREATE TABLE IF NOT EXISTS invite_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id TEXT,
            code TEXT,
            is_used INTEGER DEFAULT 0
        );
    `);
    return database;
}

client.once('ready', async () => {
    db = await setupDatabase();
    console.log(`✅ Logged in as ${client.user.tag} & Database connected securely!`);
});

async function getSetting(key, defaultValue = null) {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : defaultValue;
}

async function sendLog(guild, embed) {
    const logChannelId = await getSetting('log_channel');
    if (logChannelId) {
        const channel = guild.channels.cache.get(logChannelId);
        if (channel) channel.send({ embeds: [embed] });
    }
}

// --------------------------------------------------------------------------
// 💳 REAL CRYPTO PAYMENT INVOICE GENERATOR (NOWPayments API)
// --------------------------------------------------------------------------
async function createRealCryptoInvoice(userId, amountUSD, currency) {
    try {
        const response = await axios.post('https://api.nowpayments.io/v1/invoice', {
            price_amount: amountUSD,
            price_currency: 'usd',
            pay_currency: currency, // 'usdtpolygon', 'sol', 'ltc'
            order_id: `user_${userId}_${Date.now()}`
        }, {
            headers: {
                'x-api-key': process.env.NOWPAYMENTS_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('Crypto Invoice Error:', error.response?.data || error.message);
        return null;
    }
}

// --------------------------------------------------------------------------
// 📥 MESSAGE & PREFIX COMMAND HANDLER
// --------------------------------------------------------------------------
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    try {
        // --- 1. !poker Command ---
        if (commandName === 'poker') {
            const setupId = `tourn_${message.author.id}_${Date.now()}`;
            tournamentSetupCache.set(message.author.id, {
                id: setupId,
                title: 'Poker Tournament',
                prizeStructure: 'Custom Dynamic Pool',
                rules: 'Standard Poker Rules Apply',
                link: 'https://stake.com',
                entryFee: 0,
                requiredRole: null,
                houseEdge: 4.0
            });

            const embed = new EmbedBuilder()
                .setTitle('♠️ Poker Tournament Setup Panel')
                .setDescription('Configure your tournament details, entry fee, roles, and invite codes using the buttons below.')
                .setColor(0x00FF88);

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_details').setLabel('1. Details & Rules').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('btn_fee_prizes').setLabel('2. Fee & Stake Auto-Calc').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_roles').setLabel('3. Required Role').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('btn_codes').setLabel('4. Add Codes Queue').setStyle(ButtonStyle.Secondary)
            );

            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_submit_tournament').setLabel('🚀 Launch Tournament').setStyle(ButtonStyle.Success)
            );

            await message.reply({ embeds: [embed], components: [row1, row2] });
        }

        // --- 2. !wallet Command ---
        if (commandName === 'wallet') {
            const userId = message.author.id;
            let user = await db.get('SELECT * FROM users WHERE user_id = ?', [userId]);

            if (!user) {
                await db.run('INSERT INTO users (user_id, balance, last_deposit) VALUES (?, 0.0, 0.0)', [userId]);
                user = { balance: 0.0, last_deposit: 0.0 };
            }

            const embed = new EmbedBuilder()
                .setTitle('💳 Real Crypto Wallet')
                .setColor(0x3498DB)
                .addFields(
                    { name: '💰 Balance', value: `$${user.balance.toFixed(2)}`, inline: true },
                    { name: '📥 Last Deposit', value: `$${user.last_deposit.toFixed(2)}`, inline: true }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('wallet_deposit').setLabel('Deposit Real Crypto').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('wallet_withdraw').setLabel('Withdrawal').setStyle(ButtonStyle.Danger)
            );

            await message.reply({ embeds: [embed], components: [row] });
        }

        // --- 3. !settings Command (Admin Only) ---
        if (commandName === 'settings') {
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply({ content: '🚫 Only Administrators can access bot settings.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('⚙️ Bot Master Settings')
                .setDescription('Click the buttons below to set the current channel as Logs or Withdrawal channel:')
                .setColor(0xF1C40F);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('set_logs_channel').setLabel('Set Logs Channel').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('set_withdrawal_channel').setLabel('Set Withdrawal Channel').setStyle(ButtonStyle.Primary)
            );

            await message.reply({ embeds: [embed], components: [row] });
        }
    } catch (error) {
        console.error('Command Error:', error);
    }
});

// --------------------------------------------------------------------------
// 📥 BUTTON, MODAL & SELECT MENU INTERACTION HANDLER
// --------------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isButton()) {
            const { customId, user } = interaction;
            const setupData = tournamentSetupCache.get(user.id);

            if (customId === 'btn_details') {
                const modal = new ModalBuilder().setCustomId('modal_details').setTitle('Tournament Details');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_title').setLabel('Tournament Title').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_rules').setLabel('Rules Description').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_link').setLabel('Tournament Link').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_prize').setLabel('Prize Structure (Optional)').setStyle(TextInputStyle.Paragraph).setRequired(false))
                );
                await interaction.showModal(modal);
            }

            if (customId === 'btn_fee_prizes') {
                const modal = new ModalBuilder().setCustomId('modal_fee').setTitle('Entry Fee & House Edge');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_fee').setLabel('Entry Fee Amount ($) [Optional]').setStyle(TextInputStyle.Short).setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_edge').setLabel('House Edge (%) [Default 4%]').setStyle(TextInputStyle.Short).setValue('4').setRequired(false))
                );
                await interaction.showModal(modal);
            }

            if (customId === 'btn_roles') {
                const roleSelect = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('select_tournament_role')
                        .setPlaceholder('Select required role for tournament (Optional)')
                        .setMinValues(0)
                        .setMaxValues(1)
                );
                await interaction.reply({ content: 'Select required role:', components: [roleSelect], ephemeral: true });
            }

            if (customId === 'btn_codes') {
                const modal = new ModalBuilder().setCustomId('modal_codes').setTitle('Add Invite Codes Queue');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('input_codes_list')
                            .setLabel('Paste Codes (One Per Line - Max 4000 Chars)')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                    )
                );
                await interaction.showModal(modal);
            }

            if (customId === 'btn_submit_tournament') {
                if (!setupData) return interaction.reply({ content: '❌ Setup session expired. Please run `!poker` again.', ephemeral: true });

                await db.run(
                    `INSERT INTO tournaments (id, title, prize_structure, rules, link, entry_fee, required_role, house_edge)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [setupData.id, setupData.title, setupData.prizeStructure, setupData.rules, setupData.link, setupData.entryFee, setupData.requiredRole, setupData.houseEdge]
                );

                const displayEmbed = new EmbedBuilder()
                    .setTitle(`🏆 ${setupData.title}`)
                    .setColor(0xF39C12)
                    .setDescription(setupData.rules)
                    .addFields(
                        { name: '💰 Entry Fee', value: setupData.entryFee > 0 ? `$${setupData.entryFee}` : 'FREE', inline: true },
                        { name: '🎁 Prize Structure', value: setupData.prizeStructure, inline: false }
                    )
                    .setFooter({ text: 'Click Join Tournament to receive your single-use code!' });

                const joinRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`join_tourn_${setupData.id}`).setLabel('Join Tournament').setStyle(ButtonStyle.Success)
                );

                await interaction.channel.send({ embeds: [displayEmbed], components: [joinRow] });
                await interaction.reply({ content: '✅ Tournament Embed Successfully Published!', ephemeral: true });

                const logEmbed = new EmbedBuilder()
                    .setTitle('🎰 New Tournament Created')
                    .addFields({ name: 'Title', value: setupData.title }, { name: 'Created By', value: `<@${interaction.user.id}>` })
                    .setColor(0x2ECC71);
                await sendLog(interaction.guild, logEmbed);
            }

            if (customId.startsWith('join_tourn_')) {
                const tournamentId = customId.replace('join_tourn_', '');
                const tournament = await db.get('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);

                if (!tournament) return interaction.reply({ content: '❌ This tournament is no longer active.', ephemeral: true });

                if (tournament.required_role && !interaction.member.roles.cache.has(tournament.required_role)) {
                    return interaction.reply({ content: `🚫 You do not have the required role: <@&${tournament.required_role}>`, ephemeral: true });
                }

                const userId = interaction.user.id;
                let userWallet = await db.get('SELECT balance FROM users WHERE user_id = ?', [userId]);
                const currentBalance = userWallet ? userWallet.balance : 0.0;

                if (tournament.entry_fee > 0 && currentBalance < tournament.entry_fee) {
                    return interaction.reply({ content: `❌ Insufficient Balance! Entry Fee: $${tournament.entry_fee} | Your Balance: $${currentBalance}`, ephemeral: true });
                }

                const availableCode = await db.get('SELECT * FROM invite_codes WHERE tournament_id = ? AND is_used = 0 LIMIT 1', [tournamentId]);
                if (!availableCode) {
                    return interaction.reply({ content: '⚠️ Invite codes are out of stock! Please contact an admin.', ephemeral: true });
                }

                if (tournament.entry_fee > 0) {
                    await db.run('UPDATE users SET balance = balance - ? WHERE user_id = ?', [tournament.entry_fee, userId]);
                }
                await db.run('UPDATE invite_codes SET is_used = 1 WHERE id = ?', [availableCode.id]);

                await interaction.reply({
                    content: `🎉 **Successfully Joined Tournament!**\n\n🔗 **Link:** ${tournament.link}\n🔑 **Your Single-Use Code:** \`${availableCode.code}\``,
                    ephemeral: true
                });

                const logJoinEmbed = new EmbedBuilder()
                    .setTitle('👤 Tournament Join Event')
                    .addFields({ name: 'User', value: `<@${userId}>` }, { name: 'Tournament', value: tournament.title }, { name: 'Assigned Code', value: availableCode.code })
                    .setColor(0x34495E);
                await sendLog(interaction.guild, logJoinEmbed);
            }

            if (customId === 'wallet_deposit') {
                const cryptoMenu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('select_deposit_crypto')
                        .setPlaceholder('Select Crypto Currency')
                        .addOptions([
                            { label: 'USDT (Polygon)', value: 'usdtpolygon', description: 'Deposit via USDT Polygon Network' },
                            { label: 'Solana (SOL)', value: 'sol', description: 'Deposit via Solana Network' },
                            { label: 'Litecoin (LTC)', value: 'ltc', description: 'Deposit via Litecoin Network' }
                        ])
                );
                await interaction.reply({ content: 'Choose deposit currency:', components: [cryptoMenu], ephemeral: true });
            }

            if (customId === 'wallet_withdraw') {
                const modal = new ModalBuilder().setCustomId('modal_withdraw').setTitle('Crypto Withdrawal Request');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wd_crypto').setLabel('Crypto (USDT / SOL / LTC)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wd_amount').setLabel('Amount ($)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('wd_address').setLabel('Destination Wallet Address').setStyle(TextInputStyle.Short).setRequired(true))
                );
                await interaction.showModal(modal);
            }

            if (customId === 'set_logs_channel') {
                await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['log_channel', interaction.channelId]);
                await interaction.reply({ content: `✅ This channel is now set as the **Logs Channel**!`, ephemeral: true });
            }

            if (customId === 'set_withdrawal_channel') {
                await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['withdrawal_channel', interaction.channelId]);
                await interaction.reply({ content: `✅ This channel is now set as the **Withdrawal Requests Channel**!`, ephemeral: true });
            }
        }

        if (interaction.isModalSubmit()) {
            const { customId, user } = interaction;
            let setupData = tournamentSetupCache.get(user.id) || {};

            if (customId === 'modal_details') {
                setupData.title = interaction.fields.getTextInputValue('input_title');
                setupData.rules = interaction.fields.getTextInputValue('input_rules');
                setupData.link = interaction.fields.getTextInputValue('input_link');
                const customPrize = interaction.fields.getTextInputValue('input_prize');
                if (customPrize) setupData.prizeStructure = customPrize;

                tournamentSetupCache.set(user.id, setupData);
                await interaction.reply({ content: '✅ Tournament details updated successfully!', ephemeral: true });
            }

            if (customId === 'modal_fee') {
                const feeInput = parseFloat(interaction.fields.getTextInputValue('input_fee')) || 0;
                const edgeInput = parseFloat(interaction.fields.getTextInputValue('input_edge')) || 4.0;

                setupData.entryFee = feeInput;
                setupData.houseEdge = edgeInput;

                if (feeInput > 0) {
                    const netPoolPerPlayer = feeInput * (1 - (edgeInput / 100));
                    setupData.prizeStructure = 
                        `**Stake Style Net Pool Dynamic Distro:**\n` +
                        `• Base Entry Fee: $${feeInput}\n` +
                        `• House Edge Subtracted: ${edgeInput}%\n` +
                        `• Net Contribution/Player: $${netPoolPerPlayer.toFixed(2)}\n\n` +
                        `**Winning Percent Split Tier:**\n` +
                        `🥇 1st Place: 50% Pool Share\n` +
                        `🥈 2nd Place: 30% Pool Share\n` +
                        `🥉 3rd Place: 20% Pool Share`;
                }

                tournamentSetupCache.set(user.id, setupData);
                await interaction.reply({ content: `✅ Fee: $${feeInput} & House Edge (${edgeInput}%) auto-calculated!`, ephemeral: true });
            }

            if (customId === 'modal_codes') {
                const rawCodes = interaction.fields.getTextInputValue('input_codes_list');
                const newCodes = rawCodes.split('\n').map(c => c.trim()).filter(c => c.length > 0);

                for (const code of newCodes) {
                    await db.run('INSERT INTO invite_codes (tournament_id, code) VALUES (?, ?)', [setupData.id, code]);
                }

                await interaction.reply({ content: `✅ Added **${newCodes.length}** new codes sequentially to the queue!`, ephemeral: true });
            }

            if (customId === 'modal_deposit_amount') {
                const usdAmount = parseFloat(interaction.fields.getTextInputValue('dep_amount'));
                const currency = interaction.customDataCurrency || 'usdtpolygon';

                await interaction.deferReply({ ephemeral: true });
                const invoice = await createRealCryptoInvoice(user.id, usdAmount, currency);

                if (!invoice) {
                    return interaction.editReply({ content: '❌ Error generating deposit invoice. Please check your API key.' });
                }

                const embed = new EmbedBuilder()
                    .setTitle('📥 Real Crypto Deposit Invoice')
                    .setDescription(`Please send exactly **$${usdAmount}** worth of **${currency.toUpperCase()}** to the address below:`)
                    .addFields(
                        { name: 'Deposit Address', value: `\`${invoice.pay_address}\`` },
                        { name: 'Payment Link', value: `[Click Here to Pay Securely](${invoice.invoice_url})` }
                    )
                    .setColor(0x2ECC71);

                await interaction.editReply({ embeds: [embed] });
            }

            if (customId === 'modal_withdraw') {
                const crypto = interaction.fields.getTextInputValue('wd_crypto');
                const amount = parseFloat(interaction.fields.getTextInputValue('wd_amount'));
                const address = interaction.fields.getTextInputValue('wd_address');

                const userWallet = await db.get('SELECT balance FROM users WHERE user_id = ?', [user.id]);
                if (!userWallet || userWallet.balance < amount) {
                    return interaction.reply({ content: '❌ Insufficient wallet balance for withdrawal!', ephemeral: true });
                }

                await db.run('UPDATE users SET balance = balance - ? WHERE user_id = ?', [amount, user.id]);

                const withdrawChannelId = await getSetting('withdrawal_channel');
                if (withdrawChannelId) {
                    const wChannel = interaction.guild.channels.cache.get(withdrawChannelId);
                    const wEmbed = new EmbedBuilder()
                        .setTitle('🚨 Withdrawal Request Pending')
                        .setColor(0xE74C3C)
                        .addFields(
                            { name: 'User', value: `<@${user.id}> (${user.id})` },
                            { name: 'Crypto', value: crypto.toUpperCase(), inline: true },
                            { name: 'Amount', value: `$${amount}`, inline: true },
                            { name: 'Destination Address', value: `\`${address}\`` }
                        )
                        .setTimestamp();
                    if (wChannel) wChannel.send({ embeds: [wEmbed] });
                }

                await interaction.reply({ content: '✅ Withdrawal request successfully submitted and sent to admin logs!', ephemeral: true });
            }
        }

        if (interaction.isRoleSelectMenu()) {
            if (interaction.customId === 'select_tournament_role') {
                const selectedRoleId = interaction.values[0] || null;
                let setupData = tournamentSetupCache.get(interaction.user.id) || {};
                setupData.requiredRole = selectedRoleId;
                tournamentSetupCache.set(interaction.user.id, setupData);

                await interaction.reply({ content: `✅ Required Role Updated: ${selectedRoleId ? `<@&${selectedRoleId}>` : 'None'}`, ephemeral: true });
            }
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_deposit_crypto') {
                const selectedCurrency = interaction.values[0];
                const modal = new ModalBuilder().setCustomId('modal_deposit_amount').setTitle(`Deposit via ${selectedCurrency.toUpperCase()}`);
                
                interaction.customDataCurrency = selectedCurrency;
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dep_amount').setLabel('Deposit Amount in USD ($)').setStyle(TextInputStyle.Short).setRequired(true))
                );

                await interaction.showModal(modal).catch(async () => {
                    const invoice = await createRealCryptoInvoice(user.id, 10, selectedCurrency);
                    await interaction.reply({ content: `✅ Invoice generated for ${selectedCurrency.toUpperCase()}: \`${invoice?.pay_address || 'N/A'}\``, ephemeral: true });
                });
            }
        }
    } catch (error) {
        console.error('Interaction Error:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
