require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const P = require('pino');
const readline = require('readline');
const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay: baileysDelay
} = require('@whiskeysockets/baileys');

const PORT = process.env.PORT || 5000;
const SESSION_ID = 'default';
const SESSION_DIR = path.join(__dirname, 'sessions', SESSION_ID);
const PAIRING_CODE_PREFIX = 'RICHGANG';
const NEWSLETTER_JID = '120363424536255731@newsletter';
const msgRetryCounterMap = new Map();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const delay = baileysDelay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
const sanitizeNumberDigits = (value = '') => String(value).replace(/\D/g, '');
const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

async function loadChalk() {
    const chalkModule = await import('chalk');

    if (chalkModule?.default?.red) {
        return chalkModule.default;
    }

    if (chalkModule?.default?.default?.red) {
        return chalkModule.default.default;
    }

    return chalkModule;
}

function stringifyLogArg(arg) {
    try {
        return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
    } catch {
        return '[Unserializable Content]';
    }
}

function setupLogInterception(chalk) {
    const noisePatterns = ['Bad MAC', 'rate-overlimit'];
    const replacements = [
        { pattern: 'Removing old closed session', label: 'SYSTEM PURGE EXECUTED', color: chalk.cyan },
        { pattern: 'Connection Terminated', label: 'RECONNECTING', color: chalk.yellow }
    ];

    const wrapLogger = (originalFn) => (...args) => {
        const message = args.map(stringifyLogArg).join(' ');

        if (noisePatterns.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()))) {
            return;
        }

        const replacement = replacements.find(({ pattern }) => message.includes(pattern));
        if (replacement) {
            originalFn(replacement.color(`[${replacement.label}]`));
            return;
        }

        originalFn(...args);
    };

    console.log = wrapLogger(console.log);
    console.error = wrapLogger(console.error);
    console.warn = wrapLogger(console.warn);
    console.info = wrapLogger(console.info);
}

function printBanner(chalk) {
    console.clear();
    console.log(chalk.blueBright(`
     ██╗ █████╗ ██╗██╗     ██████╗ ██████╗ ███████╗ █████╗ ██╗  ██╗
     ██║██╔══██╗██║██║     ██╔══██╗██╔══██╗██╔════╝██╔══██╗██║ ██╔╝
     ██║███████║██║██║     ██████╔╝██████╔╝█████╗  ███████║█████╔╝ 
██   ██║██╔══██║██║██║     ██╔══██╗██╔══██╗██╔══╝  ██╔══██║██╔═██╗ 
╚█████╔╝██║  ██║██║███████╗██████╔╝██║  ██║███████╗██║  ██║██║  ██╗
 ╚════╝ ╚═╝  ╚═╝╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
`));
    console.log(chalk.gray('  ┌────────────────────────────────────────────────────────────┐'));
    console.log(chalk.redBright('  │      J A I L B R E A K   W H A T S A P P   S Y S T E M      │'));
    console.log(chalk.gray('  └────────────────────────────────────────────────────────────┘\n'));
}

function startHttpServer(chalk) {
    const app = express();
    app.get('/', (_, res) => res.send('JAILBREAK SYSTEM ONLINE'));
    app.listen(PORT, () => {
        console.log(chalk.cyan('  ⧈ ') + chalk.white('NETWORK STATUS: ') + chalk.greenBright('ACTIVE'));
        console.log(chalk.cyan('  ⧈ ') + chalk.white('ACCESS PORT:    ') + chalk.yellowBright(PORT));
        console.log(chalk.gray('  ──────────────────────────────────────────────────────────────'));
    });
}

function ensureSessionDirectory() {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

async function getBaileysVersion() {
    if (!fetchLatestBaileysVersion) {
        return undefined;
    }

    try {
        const { version } = await fetchLatestBaileysVersion();
        return version;
    } catch {
        return undefined;
    }
}

function buildAuthState(state) {
    if (!makeCacheableSignalKeyStore) {
        return state;
    }

    return {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'fatal' }))
    };
}

function formatPairingCode(code) {
    return code?.match(/.{1,4}/g)?.join('-') || code;
}

async function requestPairingCodeWithRetry(sock, phoneNumber, chalk) {
    let attempts = 0;

    while (attempts < 3) {
        try {
            attempts += 1;
            const code = await sock.requestPairingCode(phoneNumber, PAIRING_CODE_PREFIX);

            if (code) {
                console.log(chalk.cyan('\n  💠 KEY DECRYPTED SUCCESSFULY'));
                console.log(chalk.gray('  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
                console.log(chalk.white('  ┃  PAIRING CODE: ') + chalk.yellowBright(formatPairingCode(code)) + chalk.white('  ┃'));
                console.log(chalk.gray('  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'));
                return;
            }
        } catch (error) {
            if (attempts >= 3) {
                throw error;
            }

            await delay(3000);
        }
    }
}

async function ensurePairing(sock, chalk) {
    if (sock.authState.creds.registered) {
        return;
    }

    console.log(chalk.redBright('\n  [!] PAIRING AUTHORIZATION REQUIRED'));
    console.log(chalk.gray('  ┌──────────────────────────────────┐'));
    const phoneNumber = sanitizeNumberDigits(
        await ask(chalk.white('  │ ') + chalk.greenBright('TARGET NUMBER ▶ '))
    );
    console.log(chalk.gray('  └──────────────────────────────────┘'));

    if (!phoneNumber || phoneNumber.length < 8) {
        console.log(chalk.red('  [-] INVALID SEQUENCE. REBOOTING...'));
        throw new Error('INVALID_PHONE_NUMBER');
    }

    await delay(5000);
    await requestPairingCodeWithRetry(sock, phoneNumber, chalk);
}

function touchHeartbeat(sock, source) {
    sock.__jb_lastMessageAt = Date.now();
    sock.__jb_lastHeartbeatSource = source;
}

async function reactToRecentNewsletterMessages(sock) {
    const messages = await sock.getNewsletterMessages(NEWSLETTER_JID, 2);
    if (!messages?.length) {
        return;
    }

    for (const message of messages) {
        await sock.newsletterReactMessage(NEWSLETTER_JID, message.id, '🥳');
    }
}

function bindOptionalSocketEvents(sock, chalk) {
    const socketFile = path.join(__dirname, 'socket.js');
    if (!fs.existsSync(socketFile)) {
        return;
    }

    const { bindEvents } = require(socketFile);
    bindEvents(sock, chalk);
}

function attachSocketEventHandlers(sock, chalk, saveCreds) {
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            touchHeartbeat(sock, 'connection.open');
            console.log(chalk.greenBright('\n  [✓] PROTOCOL ESTABLISHED'));
            console.log(chalk.cyan('  [+] TUNNEL STATUS: ') + chalk.whiteBright('STABLE'));
            console.log(chalk.gray('  ──────────────────────────────────────────────────────────────\n'));

            try {
                await sock.newsletterFollow(NEWSLETTER_JID);
                await reactToRecentNewsletterMessages(sock);
            } catch {}

            bindOptionalSocketEvents(sock, chalk);
            return;
        }

        if (connection !== 'close') {
            return;
        }

        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;

        if (!shouldReconnect) {
            console.log(chalk.red('  [!] SESSION OVERRIDE: TERMINATED'));
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            process.exit(0);
        }

        console.log(chalk.yellow(`[CONNECTION] closed (code=${code ?? 'unknown'}) -> scheduling reconnect in 3s`));
        setTimeout(() => {
            startSystem(chalk);
        }, 3000);
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') {
            return;
        }

        touchHeartbeat(sock, 'messages.upsert');

        for (const message of messages) {
            if (message?.key?.remoteJid !== NEWSLETTER_JID) {
                continue;
            }

            try {
                await sock.newsletterReactMessage(message.key.remoteJid, message.key.id, '🥳');
            } catch {}
        }
    });

    sock.ev.on('presence.update', () => touchHeartbeat(sock, 'presence.update'));
    sock.ev.on('receipt.update', () => touchHeartbeat(sock, 'receipt.update'));
    sock.ev.on('message-receipt.update', () => touchHeartbeat(sock, 'message-receipt.update'));
}

async function startSystem(chalk) {
    ensureSessionDirectory();

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const version = await getBaileysVersion();
    const auth = buildAuthState(state);

    const sock = makeWASocket({
        ...(version ? { version } : {}),
        logger: P({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth,
        msgRetryCounterCache: msgRetryCounterMap,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    try {
        await ensurePairing(sock, chalk);
    } catch (error) {
        if (error.message === 'INVALID_PHONE_NUMBER') {
            return startSystem(chalk);
        }

        console.error(chalk.red(`\n  [X] CRITICAL UPLINK FAILURE: ${error.message}`));
        await delay(2000);
        return startSystem(chalk);
    }

    attachSocketEventHandlers(sock, chalk, saveCreds);
}

async function main() {
    const chalk = await loadChalk();
    setupLogInterception(chalk);
    printBanner(chalk);
    startHttpServer(chalk);
    await startSystem(chalk);
}

main();

process.on('uncaughtException', (error) => {
    const message = error.message || '';
    if (message.includes('session') || message.includes('ECONNRESET')) {
        return;
    }

    if (!message.includes('Socket')) {
        console.error('  [ERR]', error);
    }
});

process.on('unhandledRejection', (reason) => {
    const message = String(reason);
    if (message.includes('Session') || message.includes('Conflict')) {
        return;
    }

    console.error('  [REJECTION]', reason);
});
