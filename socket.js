const fs = require('fs');
const path = require('path');

// --- IMPORTS ---
const ryan = require('./ryan'); 
const { handleStatusUpdate } = require('./plugins/status.js');
const { storeMessage, handleAntiDelete } = require('./plugins/antidelete.js');
const { handleChatbot } = require('./plugins/chatbot.js'); // AI IMPORT

// --- CONFIG ---
const prefix = process.env.PREFIX || '.';
const mode = process.env.MODE || 'public';
const ownerNumbers = (process.env.OWNER_NUMBER || '').split(',').map(num => num.trim());
const disableReadReceipts = process.env.DISABLE_READ_RECEIPTS === 'true';
const SONG_REQUEST_CHANNEL_LINK = "https://whatsapp.com/channel/0029VagJIAr3bbVzV70jSU1p";

const jbContext = {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
        newsletterJid: '120363424536255731@newsletter',
        newsletterName: 'JAILBREAK HOME',
        serverMessageId: -1
    }
};

const dynamicImport = new Function('modulePath', 'return import(modulePath)');
const sanitizeNumberDigits = (x = '') => String(x).replace(/\D/g, '');

const bindEvents = async (conn, chalk) => {
    let baileys;
    try { 
        baileys = await dynamicImport('@whiskeysockets/baileys'); 
    } catch(e) {}
    
    const { getContentType, downloadMediaMessage } = baileys || {};

    const pluginDir = path.join(__dirname, 'plugins');
    if (fs.existsSync(pluginDir)) {
        ryan.commands.length = 0; 
        const files = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js'));
        console.log(chalk.blueBright(`[SYSTEM] Found ${files.length} plugin files...`));
        for (const file of files) {
            try {
                const fullPath = path.join(pluginDir, file);
                if (require.cache[require.resolve(fullPath)]) delete require.cache[require.resolve(fullPath)];
                require(fullPath);
            } catch (e) {
                console.error(chalk.red(`[ERROR] Plugin failed: ${file}`), e);
            }
        }
        console.log(chalk.blueBright(`[SYSTEM] Registry active. Loaded ${ryan.commands.length} commands.`));
    }

    console.log(chalk.greenBright(`[HANDLER] System Online. Monitoring Inbox...`));

    try { if (conn.__jb_unbind) conn.__jb_unbind(); } catch (e) {}

    const messagesUpsertHandler = async ({ messages, type }) => {
        if (type !== 'notify') return;
        conn.__jb_lastMessageAt = Date.now();

        for (const mek of messages) {
            try {
                if (!mek?.message || !mek?.key) continue;

                await storeMessage(mek, conn).catch(() => {});
                await handleAntiDelete(conn, mek).catch(() => {});

                const from = mek.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                const senderJid = mek.key.participant || mek.key.remoteJid;
                const senderNumber = sanitizeNumberDigits(senderJid.split('@')[0]);
                const isOwner = ownerNumbers.includes(senderNumber) || mek.key.fromMe;
                const pushName = mek.pushName || 'User';

                if (from === 'status@broadcast') {
                    await handleStatusUpdate(conn, mek, conn.user.id, disableReadReceipts, { getContentType, downloadMediaMessage });
                    continue;
                }

                let mtype = getContentType(mek.message);
                if (!mtype && mek.message.messageContextInfo) {
                    mtype = getContentType(mek.message.messageContextInfo.deviceListMetadata?.messageSecret ? mek.message : {});
                }

                const msgContent = mek.message;
                const rawBody = (
                    mtype === 'conversation' ? msgContent.conversation :
                    mtype === 'extendedTextMessage' ? msgContent.extendedTextMessage?.text :
                    mtype === 'imageMessage' ? msgContent.imageMessage?.caption :
                    mtype === 'videoMessage' ? msgContent.videoMessage?.caption :
                    mtype === 'buttonsResponseMessage' ? msgContent.buttonsResponseMessage?.selectedButtonId :
                    mtype === 'listResponseMessage' ? msgContent.listResponseMessage?.singleSelectReply?.selectedRowId :
                    mtype === 'templateButtonReplyMessage' ? msgContent.templateButtonReplyMessage?.selectedId :
                    msgContent[mtype]?.caption || msgContent[mtype]?.text || msgContent[mtype] || ''
                );

                const body = String(rawBody || '').trim();
                const isCmd = body.startsWith(prefix);

                // --- 📟 LOGGING 📟 ---
                const logTag = isGroup ? chalk.yellow('[GROUP]') : chalk.green('[P-CHAT]');
                const time = new Date().toLocaleTimeString();
                console.log(chalk.gray(`\n┌─── `) + chalk.cyan(`INTERCEPT`) + chalk.gray(` ───\n`) + chalk.gray(`│ `) + logTag + chalk.white(` ${pushName}: ${body.substring(0, 30)}...`));

                // --- 🤖 CHATBOT TRIGGER 🤖 ---
                if (!isCmd && body && !mek.key.fromMe) {
                    await handleChatbot(conn, mek, { 
                        body, from, pushName, senderNumber, mtype, 
                        downloadMedia: () => downloadMediaMessage(mek, 'buffer', {}, { logger: console })
                    });
                    continue; 
                }

                // --- ⚡ COMMAND EXECUTION ⚡ ---
                if (!isCmd) continue;
                const input = body.slice(prefix.length).trim();
                const args = input.split(/ +/);
                const cmdName = args.shift().toLowerCase();
                const q = args.join(" ");

                const cmd = ryan.commands.find(c => c.pattern.toLowerCase() === cmdName || (c.alias && c.alias.includes(cmdName)));
                if (!cmd) continue;

                if (!isOwner && mode === 'private') continue;
                if (cmd.category === 'group' && !isGroup && !isOwner) {
                    await conn.sendMessage(from, { text: "Restricted to Groups.", contextInfo: jbContext }, { quoted: mek });
                    continue;
                }

                if (cmd.react) await conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
                const reply = (text) => conn.sendMessage(from, { text, contextInfo: jbContext, ai: true }, { quoted: mek });

                try {
                    await cmd.function(conn, mek, {}, { sender: senderJid, body, args, q, text: q, from, isGroup, reply, isOwner, senderNumber, prefix });
                } catch (cmdErr) {
                    reply(`⧯ *System Fault:* \`${cmdErr.message}\``);
                }
            } catch (e) {
                console.error(chalk.red("[HANDLER CRASHED]"), e);
            }
        }
    };

    conn.ev.on('messages.upsert', messagesUpsertHandler);
    conn.__jb_unbind = () => { try { conn.ev.off('messages.upsert', messagesUpsertHandler); } catch (e) {} }
};

module.exports = { bindEvents };