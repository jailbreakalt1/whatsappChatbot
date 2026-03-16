require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const P = require('pino');
const readline = require('readline');

// --- ⚙️ GLOBAL VARIABLES ---
const port = process.env.PORT || 5000;
const sessionId = 'default';
const msgRetryCounterMap = new Map();
const pairingCodePrefix = "RICHGANG"; 
const newsletterJid = "120363424536255731@newsletter";

// --- 🔇 GLOBAL CONSOLE SILENCER (REVAMPED) 🔇 ---
const interceptLogs = async () => {
    const { default: chalk } = await import('chalk');
    
    const NOISE_PATTERNS = [
        'Bad MAC', 
        'Session error', 
        'session', 
        'Closing connection', 
        'Stream error',
        'conflict',
        'unexpected-disconnect',
        'rate-overlimit'
    ];

    const REPLACEMENTS = [
        { pattern: 'Removing old closed session', label: 'SYSTEM PURGE EXECUTED', color: chalk.cyan },
        { pattern: 'Connection Terminated', label: 'RECONNECTING', color: chalk.yellow }
    ];

    const silencer = (originalFn) => {
        return (...args) => {
            const msg = args.map(a => {
                try {
                    return typeof a === 'object' ? JSON.stringify(a) : String(a);
                } catch {
                    return '[Unserializable Content]';
                }
            }).join(' ');

            if (NOISE_PATTERNS.some(p => msg.toLowerCase().includes(p.toLowerCase()))) {
                return; 
            }

            const match = REPLACEMENTS.find(r => msg.includes(r.pattern));
            if (match) {
                originalFn(match.color(`[${match.label}]`));
            } else {
                originalFn(...args);
            }
        };
    };

    console.log = silencer(console.log);
    console.error = silencer(console.error);
    console.warn = silencer(console.warn);
    console.info = silencer(console.info);

    return chalk;
};

// --- 🛠️ HELPERS ---
const dynamicImport = new Function('modulePath', 'return import(modulePath)');
const sanitizeNumberDigits = (x = '') => String(x).replace(/\D/g, '');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, ans => res(ans.trim())));

// --- 🚀 MAIN ---
(async () => {
    console.clear();
    const chalk = await interceptLogs();

    // 🔥 STARTUP BANNER
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

    const app = express();
    app.get('/', (_, res) => res.send('JAILBREAK SYSTEM ONLINE'));
    app.listen(port, () => {
        console.log(chalk.cyan('  ⧈ ') + chalk.white('NETWORK STATUS: ') + chalk.greenBright('ACTIVE'));
        console.log(chalk.cyan('  ⧈ ') + chalk.white('ACCESS PORT:    ') + chalk.yellowBright(port));
        console.log(chalk.gray('  ──────────────────────────────────────────────────────────────'));
    });

    let baileys;
    try {
        baileys = await dynamicImport('@whiskeysockets/baileys');
    } catch (e) {
        process.exit(1);
    }

    const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
        makeCacheableSignalKeyStore,
        delay
    } = baileys;

    const startSystem = async () => {
        const authDir = path.join(__dirname, 'sessions', sessionId);
        if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: P({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'fatal' }))
            },
            msgRetryCounterCache: msgRetryCounterMap,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        // --- 🛡️ ROBUST PAIRING FLOW ---
        if (!sock.authState.creds.registered) {
            console.log(chalk.redBright('\n  [!] PAIRING AUTHORIZATION REQUIRED'));
            console.log(chalk.gray('  ┌──────────────────────────────────┐'));
            const phoneNumber = sanitizeNumberDigits(await ask(chalk.white('  │ ') + chalk.greenBright('TARGET NUMBER ▶ ')));
            console.log(chalk.gray('  └──────────────────────────────────┘'));
            
            if (!phoneNumber || phoneNumber.length < 8) {
                console.log(chalk.red('  [-] INVALID SEQUENCE. REBOOTING...'));
                return startSystem();
            }

            await delay(5000); 

            try {
                let codeFetched = false;
                let attempts = 0;

                while (!codeFetched && attempts < 3) {
                    try {
                        attempts++;
                        const code = await sock.requestPairingCode(phoneNumber, pairingCodePrefix);
                        if (code) {
                            console.log(chalk.cyan('\n  💠 KEY DECRYPTED SUCCESSFULY'));
                            console.log(chalk.gray('  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
                            console.log(chalk.white('  ┃  PAIRING CODE: ') + chalk.yellowBright(code?.match(/.{1,4}/g)?.join('-') || code) + chalk.white('  ┃'));
                            console.log(chalk.gray('  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'));
                            codeFetched = true;
                        }
                    } catch (err) {
                        if (attempts >= 3) throw err;
                        await delay(3000);
                    }
                }
            } catch (e) {
                console.error(chalk.red(`\n  [X] CRITICAL UPLINK FAILURE: ${e.message}`));
                await delay(2000);
                return startSystem();
            }
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                console.log(chalk.greenBright('\n  [✓] PROTOCOL ESTABLISHED'));
                console.log(chalk.cyan('  [+] TUNNEL STATUS: ') + chalk.whiteBright('STABLE'));
                console.log(chalk.gray('  ──────────────────────────────────────────────────────────────\n'));

                try {
                    await sock.newsletterFollow(newsletterJid);
                    const messages = await sock.getNewsletterMessages(newsletterJid, 2);
                    if (messages?.length > 0) {
                        for (const msg of messages) {
                            await sock.newsletterReactMessage(newsletterJid, msg.id, "🥳");
                        }
                    }
                } catch (err) {}

                if (fs.existsSync('./socket.js')) {
                    require('./socket').bindEvents(sock, chalk);
                }
            } else if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = code !== DisconnectReason.loggedOut;

                if (!shouldReconnect) {
                    console.log(chalk.red('  [!] SESSION OVERRIDE: TERMINATED'));
                    fs.rmSync(authDir, { recursive: true, force: true });
                    process.exit(0);
                } else {
                    setTimeout(() => startSystem(), 3000);
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const m of messages) {
                if (m.key.remoteJid === newsletterJid) {
                    try {
                        await sock.newsletterReactMessage(m.key.remoteJid, m.key.id, "🥳");
                    } catch (e) {}
                }
            }
        });

        // Start a watchdog to detect stale socket and trigger a reconnect (in-process)
        sock.__jb_lastMessageAt = Date.now();
        const WATCHDOG_INTERVAL = 30 * 1000; // check every 30s
        const WATCHDOG_THRESHOLD = 2 * 60 * 1000; // 2 minutes of inactivity
        sock.__jb_watchdog = setInterval(async () => {
            try {
                const age = Date.now() - (sock.__jb_lastMessageAt || 0);
                if (age > WATCHDOG_THRESHOLD) {
                    console.log(chalk.yellow('[WATCHDOG] Socket stale. Restarting connection...'));
                    try { sock.ev.removeAllListeners(); } catch (e) {}
                    try { clearInterval(sock.__jb_watchdog); } catch (e) {}
                    try { sock.ws?.close(); } catch (e) {}
                    try { await sock.logout(); } catch (e) {}
                    // small delay then restart
                    setTimeout(() => startSystem(), 1500);
                }
            } catch (e) {}
        }, WATCHDOG_INTERVAL);

        // clear watchdog on normal session termination
        sock.ev.on('connection.update', ({ connection }) => {
            if (connection === 'close' || connection === 'close') {
                try { clearInterval(sock.__jb_watchdog); } catch (e) {}
            }
        });
    };

    startSystem();
})();

process.on('uncaughtException', e => {
    const msg = e.message || '';
    if (msg.includes('session') || msg.includes('ECONNRESET')) return;
    if (!msg.includes('Socket')) console.error('  [ERR]', e);
});

process.on('unhandledRejection', (reason) => {
    const msg = String(reason);
    if (msg.includes('Session') || msg.includes('Conflict')) return;
});