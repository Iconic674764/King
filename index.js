const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, StringSelectMenuBuilder, PermissionsBitField, ChannelType 
} = require('discord.js');
const axios = require('axios');
const { createCanvas } = require('canvas');
const express = require('express');
require('dotenv').config();

// Express Server for Render Uptime
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is active and running!'));
app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// NOWPayments API Key & Config
const NOWPAYMENTS_API_KEY = "X6N6M4Q-E65MZVR-N0A4X87-8Q2YRMR";
const NOWPAYMENTS_API_URL = "https://api.nowpayments.io/v1";

// Database Simulations
const userWallets = new Map(); 
const guildSettings = new Map(); 
const activeTournaments = new Map(); 
const tempTournaments = new Map(); 

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const commands = [
        { name: 'wallet', description: 'Check your wallet balance, deposit, or withdraw funds.' },
        { name: 'setting', description: 'Configure bot channels, logs, and house edge via menus.' },
        { name: 'poker', description: 'Create and launch a new Poker Tournament embed.' },
        { 
            name: 'addbal', 
            description: 'Add balance to a user wallet (Admin Only)',
            options: [
                { name: 'user', type: 6, description: 'The user to add balance to', required: true },
                { name: 'amount', type: 10, description: 'Amount in USD to add', required: true }
            ]
        },
        { 
            name: 'removebal', 
            description: 'Remove balance from a user wallet (Admin Only)',
            options: [
                { name: 'user', type: 6, description: 'The user to remove balance from', required: true },
                { name: 'amount', type: 10, description: 'Amount in USD to remove', required: true }
            ]
        }
    ];

    await client.application.commands.set(commands);
    console.log('Slash commands registered successfully.');
});

// Exact Match Banner Generator (Jaise image me hai)
async function generateTournamentBanner(titleText) {
    const canvas = createCanvas(800, 400);
    const ctx = canvas.getContext('2d');

    // Rich Dark Poker Table Background
    ctx.fillStyle = '#07120a';
    ctx.fillRect(0, 0, 800, 400);

    // Subtle table felt pattern lines / glow
    ctx.fillStyle = 'rgba(0, 255, 100, 0.03)';
    ctx.fillRect(20, 20, 760, 360);

    // Outer neon border box matching the image style[span_6](start_span)[span_6](end_span)[span_7](start_span)[span_7](end_span)
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.strokeRect(30, 30, 740, 340);

    // Top icon/label text
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('♠  POKER TOURNAMENT  ♣', 400, 110);

    // Main Big Tournament Title (Jaise image me bold white me likha hai)[span_8](start_span)[span_8](end_span)[span_9](start_span)[span_9](end_span)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(titleText.toUpperCase(), 400, 205);

    // Footer instructions inside banner
    ctx.fillStyle = '#a3e635';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('REGISTER NOW   •   CLICK THE BUTTON BELOW', 400, 290);

    return canvas.toBuffer();
}

function getWallet(userId) {
    if (!userWallets.has(userId)) {
        userWallets.set(userId, { balance: 0, deposits: [], history: [] });
    }
    return userWallets.get(userId);
}

function getSettings(guildId) {
    if (!guildSettings.has(guildId)) {
        guildSettings.set(guildId, { logsChannel: '', withdrawChannel: '', houseEdge: 5 });
    }
    return guildSettings.get(guildId);
}

client.on('interactionCreate', async interaction => {
    try {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        // ==================== /WALLET COMMAND ====================
        if (interaction.isChatInputCommand() && interaction.commandName === 'wallet') {
            const wallet = getWallet(userId);
            const lastDeposits = wallet.deposits.slice(-5).reverse().join('\n') || 'No recent deposits.';

            const embed = new EmbedBuilder()
                .setColor('#00ff66')
                .setTitle(`💰 ${interaction.user.username}'s Wallet`)
                .setDescription(`**Balance:** $${wallet.balance.toFixed(2)} USD`)
                .addFields({ name: '📥 Last 5 Deposits', value: lastDeposits })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('wallet_deposit').setLabel('Deposit').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('wallet_withdraw').setLabel('Withdraw').setStyle(ButtonStyle.Danger)
            );

            return await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        // ==================== /ADDBAL COMMAND ====================
        else if (interaction.isChatInputCommand() && interaction.commandName === 'addbal') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return await interaction.reply({ content: '❌ You need Administrator permissions to add balance.', ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            const amount = interaction.options.getNumber('amount');
            const wallet = getWallet(targetUser.id);

            wallet.balance += amount;
            wallet.history.push(`+ Added $${amount} by Admin (${interaction.user.tag})`);

            return await interaction.reply({ content: `✅ Successfully added **$${amount}** to <@${targetUser.id}>'s wallet. New Balance: **$${wallet.balance.toFixed(2)}**`, ephemeral: true });
        }

        // ==================== /REMOVEBAL COMMAND ====================
        else if (interaction.isChatInputCommand() && interaction.commandName === 'removebal') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return await interaction.reply({ content: '❌ You need Administrator permissions to remove balance.', ephemeral: true });
            }

            const targetUser = interaction.options.getUser('user');
            const amount = interaction.options.getNumber('amount');
            const wallet = getWallet(targetUser.id);

            wallet.balance = Math.max(0, wallet.balance - amount);
            wallet.history.push(`- Removed $${amount} by Admin (${interaction.user.tag})`);

            return await interaction.reply({ content: `✅ Successfully removed **$${amount}** from <@${targetUser.id}>'s wallet. New Balance: **$${wallet.balance.toFixed(2)}**`, ephemeral: true });
        }

        // ==================== /SETTING COMMAND ====================
        else if (interaction.isChatInputCommand() && interaction.commandName === 'setting') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return await interaction.reply({ content: '❌ You need Administrator permissions to configure settings.', ephemeral: true });
            }

            const settings = getSettings(guildId);
            const logsText = settings.logsChannel ? `<#${settings.logsChannel}>` : 'Not Set';
            const withdrawText = settings.withdrawChannel ? `<#${settings.withdrawChannel}>` : 'Not Set';

            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('⚙️ Bot Configuration Panel')
                .setDescription(`Select channels below to configure where logs and withdrawal requests will be sent[span_10](start_span)[span_10](end_span).\n\n**Current Config:**\n• **Logs Channel:** ${logsText}\n• **Withdrawal Channel:** ${withdrawText}\n• **House Edge:** ${settings.houseEdge}%`);

            const logsChannelSelect = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('settings_select_logs_channel')
                    .setPlaceholder('Select Logs Channel from this server')
                    .addOptions(
                        interaction.guild.channels.cache
                            .filter(c => c.type === ChannelType.GuildText)
                            .first(25)
                            .map(c => ({ label: c.name, value: c.id }))
                    )
            );

            const withdrawChannelSelect = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('settings_select_withdraw_channel')
                    .setPlaceholder('Select Withdrawal Request Channel')
                    .addOptions(
                        interaction.guild.channels.cache
                            .filter(c => c.type === ChannelType.GuildText)
                            .first(25)
                            .map(c => ({ label: c.name, value: c.id }))
                    )
            );

            const rowButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('settings_set_house_edge').setLabel('Set House Edge %').setStyle(ButtonStyle.Secondary)
            );

            return await interaction.reply({ embeds: [embed], components: [logsChannelSelect, withdrawChannelSelect, rowButtons], ephemeral: true });
        }

        // ==================== /POKER COMMAND ====================
        else if (interaction.isChatInputCommand() && interaction.commandName === 'poker') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return await interaction.reply({ content: '❌ You need Manage Guild permissions to host tournaments.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor('#2b2d31')
                .setTitle('🃏 Poker Tournament Setup Dashboard')
                .setDescription('Configure your tournament details step by step using the buttons below before publishing.');

            tempTournaments.set(userId, {
                title: 'Poker Tournament #1',
                description: 'A new Poker.now tournament has been announced!',
                rules: 'No multi account',
                ends: '1h',
                codes: [],
                link: 'https://pokernow.com',
                entryFee: 10
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('poker_step1_info').setLabel('1. Info & Timer').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('poker_step2_codes').setLabel('2. Add Codes').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('poker_step3_link_fee').setLabel('3. Link & Fee').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('poker_step4_publish').setLabel('4. Publish Embed').setStyle(ButtonStyle.Success)
            );

            return await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        // ==================== SELECT MENUS (SETTINGS) ====================
        else if (interaction.isStringSelectMenu()) {
            const settings = getSettings(guildId);
            const selectedId = interaction.values[0];

            if (interaction.customId === 'settings_select_logs_channel') {
                settings.logsChannel = selectedId;
                return await interaction.reply({ content: `✅ Logs channel successfully set to <#${selectedId}>`, ephemeral: true });
            } 
            else if (interaction.customId === 'settings_select_withdraw_channel') {
                settings.withdrawChannel = selectedId;
                return await interaction.reply({ content: `✅ Withdrawal request channel successfully set to <#${selectedId}>`, ephemeral: true });
            }
        }

        // ==================== BUTTON INTERACTIONS ====================
        else if (interaction.isButton()) {
            if (interaction.customId === 'wallet_deposit') {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('dep_SOL').setLabel('SOL').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('dep_USDT').setLabel('USDT (Polygon)').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('dep_LTC').setLabel('LTC').setStyle(ButtonStyle.Secondary)
                );
                return await interaction.update({ content: 'Select the cryptocurrency you want to deposit with:', components: [row], embeds: [] });
            }

            if (interaction.customId.startsWith('dep_')) {
                const crypto = interaction.customId.split('_')[1];
                const modal = new ModalBuilder().setCustomId(`modal_deposit_${crypto}`).setTitle(`Deposit ${crypto}`);
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('deposit_amount').setLabel('Enter Amount (USD equivalent)').setStyle(TextInputStyle.Short).setRequired(true)
                ));
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'wallet_withdraw') {
                const modal = new ModalBuilder().setCustomId('modal_withdraw').setTitle('Withdraw Funds');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('w_crypto').setLabel('Crypto Type (SOL / USDT / LTC)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('w_amount').setLabel('Amount in USD').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('w_address').setLabel('Destination Wallet Address').setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'poker_step1_info') {
                const modal = new ModalBuilder().setCustomId('modal_poker_info').setTitle('Tournament Info & Timer');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_title').setLabel('Title').setStyle(TextInputStyle.Short).setValue('Poker Tournament #1').setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_desc').setLabel('Description').setStyle(TextInputStyle.Paragraph).setValue('A new Poker.now tournament has been announced!').setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_rules').setLabel('Rules').setStyle(TextInputStyle.Paragraph).setValue('No multi account').setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_ends').setLabel('Ends (e.g. 1h, 1m, 1d)').setStyle(TextInputStyle.Short).setValue('1h').setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'poker_step2_codes') {
                const modal = new ModalBuilder().setCustomId('modal_poker_codes').setTitle('Tournament Access Codes');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_codes').setLabel('Paste Codes (One per line)').setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'poker_step3_link_fee') {
                const modal = new ModalBuilder().setCustomId('modal_poker_link').setTitle('Link & Entry Fee');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_link').setLabel('Poker.now Link').setStyle(TextInputStyle.Short).setValue('https://pokernow.com').setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_fee').setLabel('Entry Fee ($)').setStyle(TextInputStyle.Short).setValue('10').setRequired(true))
                );
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'poker_step4_publish') {
                const data = tempTournaments.get(userId);
                if (!data || !data.codes || data.codes.length === 0) {
                    return await interaction.reply({ content: '❌ Please add tournament codes first using Step 2!', ephemeral: true });
                }

                const buffer = await generateTournamentBanner(data.title);
                const attachment = { attachment: buffer, name: 'banner.png' };

                // Exact Layout matching the image embed structure[span_11](start_span)[span_11](end_span)[span_12](start_span)[span_12](end_span)
                const embed = new EmbedBuilder()
                    .setColor('#0f172a')
                    .setTitle(`🎯 ${data.title}`)
                    .setDescription(`A new Poker.now tournament has been announced!\nClick Register below to join. Fill in your Poker username to secure your spot.\n\n⚠️ **Rules**\n${data.rules}\n\n🎁 **Prizes**\n$0 (Dynamic Prize Pool)\n\n⏰ **Ends**\n${data.ends}\n\n» **Required Role**\nOpen to Everyone\n\n» **Registered**\n0 players\n\n» **Host**\n<@${userId}>`)
                    .setImage('attachment://banner.png');

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('tournament_join').setLabel('Register').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('tournament_view').setLabel('View Details').setStyle(ButtonStyle.Secondary)
                );

                const sentMessage = await interaction.channel.send({ embeds: [embed], files: [attachment], components: [row] });

                activeTournaments.set(sentMessage.id, {
                    ...data,
                    hostId: userId,
                    registeredUsers: new Map(),
                    prizePool: 0
                });

                tempTournaments.delete(userId);
                return await interaction.reply({ content: '✅ Tournament successfully published!', ephemeral: true });
            }

            if (interaction.customId === 'tournament_join') {
                const tournament = activeTournaments.get(interaction.message.id);
                if (!tournament) return await interaction.reply({ content: '❌ Tournament data not found.', ephemeral: true });

                if (tournament.registeredUsers.has(userId)) {
                    return await interaction.reply({ content: '❌ You have already registered for this tournament!', ephemeral: true });
                }

                const wallet = getWallet(userId);
                if (wallet.balance < tournament.entryFee) {
                    return await interaction.reply({ content: `❌ Insufficient balance! Entry fee is $${tournament.entryFee}, but your balance is $${wallet.balance.toFixed(2)}.`, ephemeral: true });
                }

                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`confirm_pay_${interaction.message.id}`).setLabel(`Confirm Pay $${tournament.entryFee}`).setStyle(ButtonStyle.Success)
                );
                return await interaction.reply({ content: `⚠️ **Confirm Registration**\nEntry Fee: $${tournament.entryFee}\nThis amount will be deducted from your wallet.`, components: [confirmRow], ephemeral: true });
            }

            if (interaction.customId.startsWith('confirm_pay_')) {
                const msgId = interaction.customId.split('_')[2];
                const tournament = activeTournaments.get(msgId);
                const wallet = getWallet(userId);
                const settings = getSettings(guildId);

                if (!tournament) return await interaction.reply({ content: 'Tournament expired.', ephemeral: true });

                if (tournament.codes.length === 0) {
                    return await interaction.reply({ content: '❌ Sorry, all tournament access codes have been claimed!', ephemeral: true });
                }

                wallet.balance -= tournament.entryFee;
                const houseCut = (tournament.entryFee * (settings.houseEdge || 5)) / 100;
                const prizeAdd = tournament.entryFee - houseCut;
                tournament.prizePool += prizeAdd;

                const assignedCode = tournament.codes.shift();

                const modal = new ModalBuilder().setCustomId(`modal_poker_username_${msgId}_${encodeURIComponent(assignedCode)}`).setTitle('Enter Poker Username');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('poker_username').setLabel('Pokernow Username').setStyle(TextInputStyle.Short).setRequired(true)
                ));
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'tournament_view') {
                const tournament = activeTournaments.get(interaction.message.id);
                if (!tournament) return await interaction.reply({ content: 'Tournament not found.', ephemeral: true });

                const userData = tournament.registeredUsers?.get(userId);
                if (!userData) {
                    return await interaction.reply({ content: '❌ You are not registered in this tournament.', ephemeral: true });
                }

                const detailsEmbed = new EmbedBuilder()
                    .setColor('#00ff66')
                    .setTitle('🎯 Your Tournament Details')
                    .setDescription(`**Poker Username:** ${userData.pokerUsername}\n**Assigned Access Code:** \`${userData.code}\`\n**Tournament Link:** [Join Table](${tournament.link})\n\n**How to join:** Go to [pokernow.com](${tournament.link}), use your assigned code to join the table!`);

                return await interaction.reply({ embeds: [detailsEmbed], ephemeral: true });
            }

            if (interaction.customId === 'settings_set_house_edge') {
                const modal = new ModalBuilder().setCustomId('modal_set_house_edge').setTitle('Set House Edge');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('edge_val').setLabel('House Edge Percentage (%)').setStyle(TextInputStyle.Short).setValue('5').setRequired(true)
                ));
                return await interaction.showModal(modal);
            }
        }

        // ==================== MODAL SUBMISSIONS ====================
        else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('modal_deposit_')) {
                const crypto = interaction.customId.split('_')[2];
                const amount = parseFloat(interaction.fields.getTextInputValue('deposit_amount'));

                if (isNaN(amount) || amount <= 0) {
                    return await interaction.reply({ content: '❌ Invalid amount entered.', ephemeral: true });
                }

                const wallet = getWallet(userId);
                wallet.balance += amount; 
                wallet.deposits.push(`+ $${amount} (${crypto}) [Simulated]`);

                return await interaction.reply({ 
                    content: `✅ **Deposit simulated successfully!** Added $${amount} to your wallet balance.\n(Deposit address generated for ${crypto}).`, 
                    ephemeral: true 
                });
            }

            if (interaction.customId === 'modal_withdraw') {
                const crypto = interaction.fields.getTextInputValue('w_crypto');
                const amount = parseFloat(interaction.fields.getTextInputValue('w_amount'));
                const address = interaction.fields.getTextInputValue('w_address');
                const wallet = getWallet(userId);

                if (wallet.balance < amount) {
                    return await interaction.reply({ content: '❌ Insufficient balance for withdrawal.', ephemeral: true });
                }

                wallet.balance -= amount;
                const settings = getSettings(guildId);

                const reqEmbed = new EmbedBuilder()
                    .setColor('#ff3333')
                    .setTitle('📤 New Withdrawal Request')
                    .addFields(
                        { name: 'User', value: `<@${userId}> (${interaction.user.tag})`, inline: true },
                        { name: 'Amount', value: `$${amount} (${crypto})`, inline: true },
                        { name: 'Destination Address', value: `\`${address}\`` }
                    )
                    .setTimestamp();

                if (settings.withdrawChannel) {
                    const channel = interaction.guild.channels.cache.get(settings.withdrawChannel);
                    if (channel) await channel.send({ embeds: [reqEmbed] });
                }

                return await interaction.reply({ 
                    content: '✅ Withdrawal request submitted successfully! Funds will be sent within **12 hours**.', 
                    ephemeral: true 
                });
            }

            if (interaction.customId === 'modal_poker_info') {
                let data = tempTournaments.get(userId);
                if (!data) {
                    data = { title: 'Poker Tournament #1', description: '', rules: '', ends: '1h', codes: [], link: 'https://pokernow.com', entryFee: 10 };
                    tempTournaments.set(userId, data);
                }
                data.title = interaction.fields.getTextInputValue('p_title');
                data.description = interaction.fields.getTextInputValue('p_desc');
                data.rules = interaction.fields.getTextInputValue('p_rules');
                data.ends = interaction.fields.getTextInputValue('p_ends');
                return await interaction.reply({ content: '✅ Tournament info & timer updated successfully!', ephemeral: true });
            }

            if (interaction.customId === 'modal_poker_codes') {
                let data = tempTournaments.get(userId);
                if (!data) {
                    data = { title: 'Poker Tournament #1', description: '', rules: '', ends: '1h', codes: [], link: 'https://pokernow.com', entryFee: 10 };
                    tempTournaments.set(userId, data);
                }
                const rawCodes = interaction.fields.getTextInputValue('p_codes');
                const codesArray = rawCodes.split('\n').map(c => c.trim()).filter(c => c.length > 0);
                data.codes = codesArray;
                return await interaction.reply({ content: `✅ Successfully loaded ${codesArray.length} tournament codes!`, ephemeral: true });
            }

            if (interaction.customId === 'modal_poker_link') {
                let data = tempTournaments.get(userId);
                if (!data) {
                    data = { title: 'Poker Tournament #1', description: '', rules: '', ends: '1h', codes: [], link: 'https://pokernow.com', entryFee: 10 };
                    tempTournaments.set(userId, data);
                }
                data.link = interaction.fields.getTextInputValue('p_link');
                data.entryFee = parseFloat(interaction.fields.getTextInputValue('p_fee'));
                return await interaction.reply({ content: '✅ Link & entry fee configured successfully!', ephemeral: true });
            }

            if (interaction.customId.startsWith('modal_poker_username_')) {
                const parts = interaction.customId.split('_');
                const msgId = parts[3];
                const assignedCode = decodeURIComponent(parts[4]);
                const pokerUsername = interaction.fields.getTextInputValue('poker_username');

                const tournament = activeTournaments.get(msgId);
                if (!tournament) return await interaction.reply({ content: 'Tournament closed.', ephemeral: true });

                tournament.registeredUsers.set(userId, { pokerUsername, code: assignedCode });

                let winnersText = '';
                let rank = 1;
                for (let [uId, uData] of tournament.registeredUsers.entries()) {
                    const share = (tournament.prizePool / tournament.registeredUsers.size).toFixed(2);
                    winnersText += `**#${rank}** <@${uId}> (${uData.pokerUsername}) — **$${share}**\n`;
                    rank++;
                }

                try {
                    const message = await interaction.channel.messages.fetch(msgId);
                    if (message) {
                        const oldEmbed = message.embeds[0];
                        const updatedEmbed = EmbedBuilder.from(oldEmbed)
                            .setDescription(`A new Poker.now tournament has been announced!\nClick Register below to join. Fill in your Poker username to secure your spot.\n\n⚠️ **Rules**\n${tournament.rules}\n\n🎁 **Prizes (Total: $${tournament.prizePool.toFixed(2)})**\n${winnersText}\n\n⏰ **Ends**\n${tournament.ends}\n\n» **Required Role**\nOpen to Everyone\n\n» **Registered**\n${tournament.registeredUsers.size} players\n\n» **Host**\n<@${tournament.hostId}>`);
                        
                        await message.edit({ embeds: [updatedEmbed] });
                    }
                } catch (e) {
                    console.error('Could not update live embed message', e);
                }

                const settings = getSettings(guildId);
                if (settings.logsChannel) {
                    const logChannel = interaction.guild.channels.cache.get(settings.logsChannel);
                    if (logChannel) {
                        logChannel.send(`📝 **Tournament Join Log:** <@${userId}> joined tournament with code \`${assignedCode}\`. PokerNow Username: **${pokerUsername}**`);
                    }
                }

                return await interaction.reply({ 
                    content: `✅ **Successfully Registered!** Click **View Details** on the main embed to see your PokerNow link and assigned table code.`, 
                    ephemeral: true 
                });
            }

            if (interaction.customId === 'modal_set_house_edge') {
                const edge = parseFloat(interaction.fields.getTextInputValue('edge_val'));
                const settings = getSettings(guildId);
                settings.houseEdge = edge;
                return await interaction.reply({ content: `✅ House edge updated to **${edge}%** successfully!`, ephemeral: true });
            }
        }

    } catch (error) {
        console.error('Interaction Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An error occurred while processing your request.', ephemeral: true }).catch(() => {});
        }
    }
});

client.login(process.env.TOKEN);
