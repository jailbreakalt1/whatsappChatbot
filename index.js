require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const P = require('pino');
const readline = require('readline');

// --- ⚙️ GLOBAL VARIABLES ---
const port = process.env.PORT || 5000;
const sessionId = 'default';
const msgRetryCounterMap = new Map();
const pairingCodePrefix = 'RICHGANG';
const newsletterJid = '120363424536255731@newsletter';
let activeSock = null;
let startPromise = null;
let selectedPairMode = null;
let pairingTargetNumber = '';
let lastQrValue = null;
let socketGeneration = 0;
let restartInProgress = false;

// --- 🔇 GLOBAL CONSOLE SILENCER (REVAMPED) 🔇 ---
const interceptLogs = async () => {
    const { default: chalk } = await import('chalk');

    const NOISE_PATTERNS = [
        'Bad MAC',
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

const closeSocket = async (sock) => {
    if (!sock) return;

    try {
        if (sock.__jb_watchdog) {
            clearInterval(sock.__jb_watchdog);
            sock.__jb_watchdog = null;
        }
    } catch (e) {}

    try {
        sock.ev.removeAllListeners();
    } catch (e) {}

    try {
        sock.end?.(undefined);
    } catch (e) {}

    try {
        sock.ws?.close?.();
    } catch (e) {}
};

const askPairMode = async (chalk) => {
    while (true) {
        console.log(chalk.redBright('\n  [!] PAIRING AUTHORIZATION REQUIRED'));
        console.log(chalk.gray('  ┌──────────────────────────────────┐'));
        console.log(chalk.white('  │ ') + chalk.cyanBright('HOW BEST SHOULD WE PAIR?'));
        console.log(chalk.white('  │ ') + chalk.greenBright('1. QR CODE'));
        console.log(chalk.white('  │ ') + chalk.yellowBright('2. PAIR CODE'));
        const answer = await ask(chalk.white('  │ ') + chalk.greenBright('SELECT OPTION ▶ '));
        console.log(chalk.gray('  └──────────────────────────────────┘'));

        if (answer === '1') return 'qr';
        if (answer === '2') return 'pair';

        console.log(chalk.red('  [-] INVALID SELECTION. ENTER 1 OR 2.'));
    }
};

const askPairNumber = async (chalk) => {
    while (true) {
        console.log(chalk.gray('  ┌──────────────────────────────────┐'));
        const phoneNumber = sanitizeNumberDigits(await ask(chalk.white('  │ ') + chalk.greenBright('TARGET NUMBER ▶ ')));
        console.log(chalk.gray('  └──────────────────────────────────┘'));

        if (phoneNumber && phoneNumber.length >= 8) return phoneNumber;
        console.log(chalk.red('  [-] INVALID NUMBER. TRY AGAIN.'));
    }
};

const printQrCode = (chalk, qr) => {
    if (!qr || qr === lastQrValue) return;
    lastQrValue = qr;
    console.log(chalk.cyanBright('\n  📱 QR RECEIVED BELOW. SCAN IT WITH WHATSAPP.'));
    console.log(chalk.gray('  ──────────────────────────────────────────────────────────────'));
};

const touchHeartbeat = (sock, source) => {
    if (!sock) return;
    sock.__jb_lastHeartbeatAt = Date.now();
    sock.__jb_lastHeartbeatSource = source;
};

const restartProcess = async (reason, sock, chalk) => {
    if (restartInProgress) return;
    restartInProgress = true;

    console.log(chalk.yellow(`  [RESTART] ${reason}`));

    try {
        await closeSocket(sock || activeSock);
    } catch (e) {}

    const isSupervisorManaged = Boolean(
        process.env.pm_id ||
        process.env.NODE_APP_INSTANCE ||
        process.env.JB_USE_EXTERNAL_RESTART === 'true'
    );

    if (isSupervisorManaged) {
        process.exit(1);
    }

    const child = spawn(process.execPath, process.argv.slice(1), {
        cwd: process.cwd(),
        env: { ...process.env, JB_LAST_RESTART_REASON: reason },
        detached: true,
        stdio: 'inherit'
    });

    child.unref();
    process.exit(1);
};

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
        if (startPromise) return startPromise;

        startPromise = (async () => {
            lastQrValue = null;

            const oldSock = activeSock;
            activeSock = null;
            await closeSocket(oldSock);

            const authDir = path.join(__dirname, 'sessions', sessionId);
            if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

            const { state, saveCreds } = await useMultiFileAuthState(authDir);
            const { version } = await fetchLatestBaileysVersion();

            if (!state.creds.registered && !selectedPairMode) {
                selectedPairMode = await askPairMode(chalk);
            }

            if (!state.creds.registered && selectedPairMode === 'pair' && !pairingTargetNumber) {
                pairingTargetNumber = await askPairNumber(chalk);
            }

            const generation = ++socketGeneration;
            const sock = makeWASocket({
                version,
                logger: P({ level: 'silent' }),
                printQRInTerminal: selectedPairMode === 'qr',
                browser: ['Chrome', 'Windows', '10.0'],
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'fatal' }))
                },
                msgRetryCounterCache: msgRetryCounterMap,
                syncFullHistory: false,
                downloadHistory: false,
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                getMessage: async () => undefined
            });
            sock.__jb_generation = generation;
            activeSock = sock;
            touchHeartbeat(sock, 'socket.created');

            if (!sock.authState.creds.registered && selectedPairMode === 'pair' && pairingTargetNumber) {
                try {
                    await delay(1500);
                    const code = await sock.requestPairingCode(pairingTargetNumber, pairingCodePrefix);
                    if (sock !== activeSock) return;

                    console.log(chalk.cyan('\n  💠 KEY DECRYPTED SUCCESSFULLY'));
                    console.log(chalk.gray('  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
                    console.log(chalk.white('  ┃  PAIRING CODE: ') + chalk.yellowBright(code?.match(/.{1,4}/g)?.join('-') || code) + chalk.white('  ┃'));
                    console.log(chalk.gray('  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'));
                } catch (e) {
                    if (sock === activeSock) {
                        console.error(chalk.red(`\n  [X] PAIR CODE FAILURE: ${e.message}`));
                    }
                }
            }

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                if (sock !== activeSock || sock.__jb_generation !== socketGeneration) return;

                if (qr && selectedPairMode === 'qr') {
                    printQrCode(chalk, qr);
                }

                if (connection === 'open') {
                    lastQrValue = null;
                    selectedPairMode = null;
                    pairingTargetNumber = '';
                    restartInProgress = false;
                    touchHeartbeat(sock, 'connection.open');

                    console.log(chalk.greenBright('\n  [✓] PROTOCOL ESTABLISHED'));
                    console.log(chalk.cyan('  [+] TUNNEL STATUS: ') + chalk.whiteBright('STABLE'));
                    console.log(chalk.gray('  ──────────────────────────────────────────────────────────────\n'));

                    try {
                        await sock.newsletterFollow(newsletterJid);
                        const messages = await sock.getNewsletterMessages(newsletterJid, 2);
                        if (messages?.length > 0) {
                            for (const msg of messages) {
                                await sock.newsletterReactMessage(newsletterJid, msg.id, '🥳');
                            }
                        }
                    } catch (err) {}

                    if (fs.existsSync('./socket.js')) {
                        require('./socket').bindEvents(sock, chalk);
                    }
                    return;
                }

                if (connection !== 'close') return;

                const code = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = code !== DisconnectReason.loggedOut;

                if (activeSock === sock) {
                    activeSock = null;
                }

                if (!shouldReconnect) {
                    console.log(chalk.red('  [!] SESSION OVERRIDE: TERMINATED'));
                    selectedPairMode = null;
                    pairingTargetNumber = '';
                    lastQrValue = null;
                    fs.rmSync(authDir, { recursive: true, force: true });
                    process.exit(0);
                }

                const reasonLabel = code === DisconnectReason.connectionReplaced
                    ? 'connection replaced'
                    : code === DisconnectReason.restartRequired
                        ? 'restart required'
                        : `closed (code=${code || 'unknown'})`;

                await restartProcess(`connection closed: ${reasonLabel}`, sock, chalk);
            });

            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;
                touchHeartbeat(sock, 'messages.upsert');
                for (const m of messages) {
                    if (m.key.remoteJid === newsletterJid) {
                        try {
                            await sock.newsletterReactMessage(m.key.remoteJid, m.key.id, '🥳');
                        } catch (e) {}
                    }
                }
            });

            sock.ev.on('presence.update', () => touchHeartbeat(sock, 'presence.update'));
            sock.ev.on('receipt.update', () => touchHeartbeat(sock, 'receipt.update'));
            sock.ev.on('message-receipt.update', () => touchHeartbeat(sock, 'message-receipt.update'));

            const WATCHDOG_INTERVAL_MS = 30_000;
            const WATCHDOG_THRESHOLD_MS = 20 * 60_000;
            sock.__jb_watchdog = setInterval(async () => {
                if (restartInProgress || sock !== activeSock || sock.__jb_generation !== socketGeneration) return;

                const lastHeartbeatAt = sock.__jb_lastHeartbeatAt || 0;
                const age = Date.now() - lastHeartbeatAt;
                if (age < WATCHDOG_THRESHOLD_MS) return;

                const ageSec = Math.round(age / 1000);
                const source = sock.__jb_lastHeartbeatSource || 'unknown';
                await restartProcess(`watchdog stale socket age=${ageSec}s lastHeartbeat=${source}`, sock, chalk);
            }, WATCHDOG_INTERVAL_MS);
        })().finally(() => {
            startPromise = null;
        });

        return startPromise;
    };

    startSystem().catch((err) => {
        console.error(chalk.red(`  [BOOT FAILURE] ${err.message}`));
    });
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
