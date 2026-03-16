const fs = require('fs');
const path = require('path');
const { handleChatbot } = require('./plugins/chatbot.js');

const prefix = process.env.PREFIX || '.';
const mode = process.env.MODE || 'public';
const ownerNumbers = (process.env.OWNER_NUMBER || '').split(',').map((num) => num.trim());

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

const commands = [];

function registerCommand(info, func) {
    const data = { ...info, function: func };

    if (data.dontAddCommandList === undefined) data.dontAddCommandList = false;
    if (data.desc === undefined) data.desc = '';
    if (data.fromMe === undefined) data.fromMe = false;
    if (data.category === undefined) data.category = 'misc';
    if (data.filename === undefined) data.filename = 'Not Provided';

    const index = commands.findIndex((c) => c.pattern === data.pattern);
    if (index !== -1) {
        commands[index] = data;
    } else {
        commands.push(data);
    }

    return data;
}

const bindEvents = async (conn, chalk) => {
    let baileys;
    try {
        baileys = await dynamicImport('@whiskeysockets/baileys');
    } catch (e) {}

    const { getContentType, downloadMediaMessage } = baileys || {};

    const pluginDir = path.join(__dirname, 'plugins');
    if (fs.existsSync(pluginDir)) {
        commands.length = 0;

        global.JB = registerCommand;
        global.AddCommand = registerCommand;
        global.Function = registerCommand;
        global.Module = registerCommand;

        const files = fs.readdirSync(pluginDir).filter((f) => f.endsWith('.js'));
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

        console.log(chalk.blueBright(`[SYSTEM] Registry active. Loaded ${commands.length} commands.`));
    }

    console.log(chalk.greenBright('[HANDLER] System Online. Monitoring Inbox...'));

    try {
        if (conn.__jb_unbind) conn.__jb_unbind();
    } catch (e) {}

    const messagesUpsertHandler = async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const mek of messages) {
            try {
                if (!mek?.message || !mek?.key) continue;

                const from = mek.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                const senderJid = mek.key.participant || mek.key.remoteJid;
                const senderNumber = sanitizeNumberDigits(senderJid.split('@')[0]);
                const isOwner = ownerNumbers.includes(senderNumber) || mek.key.fromMe;
                const pushName = mek.pushName || 'User';

                const mtype = getContentType ? getContentType(mek.message) : Object.keys(mek.message)[0];
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

                const logTag = isGroup ? chalk.yellow('[GROUP]') : chalk.green('[P-CHAT]');
                console.log(
                    chalk.gray('\n┌─── ') +
                    chalk.cyan('INTERCEPT') +
                    chalk.gray(' ───\n') +
                    chalk.gray('│ ') +
                    logTag +
                    chalk.white(` ${pushName}: ${body.substring(0, 30)}...`)
                );

                if (!isCmd && body && !mek.key.fromMe) {
                    await handleChatbot(conn, mek, {
                        body,
                        from,
                        pushName,
                        senderNumber,
                        mtype,
                        downloadMedia: () => downloadMediaMessage(mek, 'buffer', {}, { logger: console })
                    });
                    continue;
                }

                if (!isCmd) continue;

                const input = body.slice(prefix.length).trim();
                const args = input.split(/ +/);
                const cmdName = args.shift().toLowerCase();
                const q = args.join(' ');

                const cmd = commands.find(
                    (c) => c.pattern.toLowerCase() === cmdName || (c.alias && c.alias.includes(cmdName))
                );
                if (!cmd) continue;

                if (!isOwner && mode === 'private') continue;
                if (cmd.category === 'group' && !isGroup && !isOwner) {
                    await conn.sendMessage(from, { text: 'Restricted to Groups.', contextInfo: jbContext }, { quoted: mek });
                    continue;
                }

                if (cmd.react) await conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });

                const reply = (text) =>
                    conn.sendMessage(from, { text, contextInfo: jbContext, ai: true }, { quoted: mek });

                try {
                    await cmd.function(conn, mek, {}, {
                        sender: senderJid,
                        body,
                        args,
                        q,
                        text: q,
                        from,
                        isGroup,
                        reply,
                        isOwner,
                        senderNumber,
                        prefix
                    });
                } catch (cmdErr) {
                    await reply(`⧯ *System Fault:* \`${cmdErr.message}\``);
                }
            } catch (e) {
                console.error(chalk.red('[HANDLER CRASHED]'), e);
            }
        }
    };

    conn.ev.on('messages.upsert', messagesUpsertHandler);
    conn.__jb_unbind = () => {
        try {
            conn.ev.off('messages.upsert', messagesUpsertHandler);
        } catch (e) {}
    };
};

module.exports = { bindEvents };
