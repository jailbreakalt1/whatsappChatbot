const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// --- CONFIG ---
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.VOICE_ID;
const JAILBREAK_ENABLED = process.env.JAILBREAK === 'true'; // Global Switch

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CHAT_DIR = path.join(__dirname, '../chats');
const TEMP_DIR = path.join(__dirname, '../temp');

// Ensure directories exist
if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

const PERSONA = `You are JB short for JAILBREAK, a state of the art AI built by Ryan. Your location is Kwekwe, Zimbabwe. Ryan is a tech enthusiastic genius. Only mention Ryan and location when asked. JB is human-like, funny, sarcastic, and existential. Use emojis sparingly but effectively. Keep responses concise unless asked for detail.`;

/**
 * Utility to generate random delay
 */
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Robust request wrapper with exponential backoff
 */
async function requestWithRetry(fn, retries = 3, delay = 2000) {
    try {
        return await fn();
    } catch (error) {
        const status = error.response?.status;
        if ((status === 429 || status === 408 || status === 502 || status === 503 || status === 504) && retries > 0) {
            await new Promise(res => setTimeout(res, delay));
            return requestWithRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
}

function getHistory(sender) {
    const filePath = path.join(CHAT_DIR, `${sender}.json`);
    if (!fs.existsSync(filePath)) return { messages: [], msgCount: 0 };
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return { 
            messages: Array.isArray(data) ? data : (data.messages || []), 
            msgCount: data.msgCount || 0 
        };
    } catch {
        return { messages: [], msgCount: 0 };
    }
}

function saveHistory(sender, data) {
    const filePath = path.join(CHAT_DIR, `${sender}.json`);
    data.messages = data.messages.slice(-10); 
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Converts MP3 Buffer to OGG Opus Buffer using FFmpeg
 */
async function convertToOpus(inputBuffer) {
    return new Promise((resolve, reject) => {
        const inputPath = path.join(TEMP_DIR, `input_${Date.now()}.mp3`);
        const outputPath = path.join(TEMP_DIR, `output_${Date.now()}.ogg`);

        fs.writeFileSync(inputPath, inputBuffer);

        const args = [
            '-i', inputPath,
            '-c:a', 'libopus',
            '-b:a', '64k',
            '-vbr', 'on',
            '-compression_level', '10',
            '-f', 'ogg',
            outputPath
        ];

        const ffmpeg = spawn(ffmpegPath, args);

        ffmpeg.on('close', (code) => {
            try {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (code === 0 && fs.existsSync(outputPath)) {
                    const outputBuffer = fs.readFileSync(outputPath);
                    fs.unlinkSync(outputPath);
                    resolve(outputBuffer);
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            } catch (err) {
                reject(err);
            }
        });

        ffmpeg.on('error', (err) => {
            try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}
            reject(err);
        });
    });
}

async function generateVoice(text) {
    if (!ELEVENLABS_API_KEY || !VOICE_ID) return null;
    try {
        const response = await requestWithRetry(() => axios({
            method: 'post',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
            data: {
                text: text,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            },
            headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
            responseType: 'arraybuffer'
        }));

        const mp3Buffer = Buffer.from(response.data);
        
        try {
            return await convertToOpus(mp3Buffer);
        } catch (convErr) {
            console.error("FFmpeg Conversion Failed:", convErr);
            return mp3Buffer;
        }

    } catch (e) {
        console.error("ElevenLabs Error:", e.message);
        return null;
    }
}

async function handleChatbot(conn, mek, { body, from, pushName, senderNumber, mtype, downloadMedia }) {
    if (!JAILBREAK_ENABLED) return;
    if (!OPENROUTER_API_KEY || !from || !body) return;

    // Inbox Only
    if (from.endsWith('@g.us')) return; 
    if (mek.key.fromMe) return;

    try {
        let chatData = getHistory(senderNumber);
        let history = chatData.messages;

        // --- ⏳ DELAY & PRESENCE ⏳ ---
        const randomDelay = Math.floor(Math.random() * (9000 - 4000 + 1)) + 4000;
        await conn.sendPresenceUpdate("recording", from);

        // --- 🧠 AI LOGIC 🧠 ---
        // Using openrouter/aurora-alpha with reasoning enabled
        let model = "openrouter/aurora-alpha";
        let messages = [{ role: "system", content: PERSONA }];
        
        history.forEach(msg => {
            messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.text });
        });

        let userContent = [{ type: "text", text: body }];

        if (mtype === 'imageMessage') {
            const buffer = await downloadMedia();
            userContent.push({
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` }
            });
        }

        messages.push({ role: "user", content: userContent });

        const payload = {
            model: model,
            messages: messages,
            temperature: 0.8,
            max_tokens: 1000, // Fixed credit/budget error by limiting tokens
            reasoning: {
                enabled: true
            }
        };

        const response = await requestWithRetry(() => axios.post(OPENROUTER_URL, payload, {
            headers: { 
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/ryan/jailbreak-bot',
                'X-Title': 'JB Bot'
            }
        }));

        const aiText = response.data?.choices?.[0]?.message?.content;
        
        if (!aiText) {
            console.error("[JB ERROR] Empty content from Aurora Alpha");
            await conn.sendPresenceUpdate("paused", from);
            return;
        }

        chatData.msgCount++;
        history.push({ role: "user", text: body });
        history.push({ role: "model", text: aiText });
        saveHistory(senderNumber, chatData);

        // --- 🗣️ VOICE GENERATION 🗣️ ---
        let voiceBuffer = (chatData.msgCount % 12 === 0) ? await generateVoice(aiText) : null;

        await sleep(randomDelay);

        if (voiceBuffer) {
            await conn.sendMessage(from, { 
                audio: voiceBuffer, 
                mimetype: 'audio/ogg; codecs=opus', 
                ptt: true 
            }, { quoted: mek });
        } else {
            await conn.sendMessage(from, { 
                text: aiText,
                contextInfo: {
                    externalAdReply: {
                        title: `JB | ${pushName}`,
                        body: `AI Reasoning active`,
                        thumbnailUrl: "https://files.catbox.moe/s80m7e.png",
                        sourceUrl: "https://whatsapp.com/channel/0029VagJIAr3bbVzV70jSU1p",
                        mediaType: 1
                    }
                }
            }, { quoted: mek });
        }
        
        await conn.sendPresenceUpdate("paused", from);

    } catch (err) {
        const errorDetail = err.response?.data?.error?.message || err.message;
        console.error("JB Bot AI Error:", errorDetail);
        await conn.sendPresenceUpdate("paused", from);
    }
}

module.exports = { handleChatbot };