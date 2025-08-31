import { useMultiFileAuthState, makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, jidDecode } from 'baileys-x';
import { parseCommand, handleCommand } from './commande.js';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import nodeCache from 'node-cache';
import fs from 'fs';
import dotenv from 'dotenv';
import { joinGroup, joinchannel } from './utils/gestion_groupe.js';
import { send_text_message, send_audio_message } from './utils/sendmessagewa.js';
import { handleJoin, handleLeave } from './utils/welcomemanager.js';
import { creerAntiLinkBaileys } from './commandes/antilink.js';
import { creerAntiBotBaileys } from './commandes/antibot.js';
import { creerAntiMediaBaileys } from './commandes/antimedia.js';
import { messageTracker } from './utils/messageTracker.js';
import { fetchCodeFromGitHub } from './utils/code.js';
import { creerAntiSpamBaileys } from './commandes/antispam.js';
import { statusWatcher } from './commandes/autovustatut.js';
import { reactionWatcher } from './commandes/autoreact.js';
import { autoWriteMiddleware } from './commandes/autowrite.js';
import { log } from 'console';
import { updateGroupAdmins } from './utils/update_admin.js';
import { creerAntiMentionBaileys } from './commandes/antimention.js';

dotenv.config();

let acces = true;

const config = {
    'PREFIXE_COMMANDE': process.env.PREFIXE_COMMANDE,
    'DOSSIER_AUTH': process.env.AUTH_DIR || 'auth_baileys',
    'NUMBER': process.env.BOT_NUMBER,
    'USE_QR': process.env.USE_QR === 'true',
    'LOG_LEVEL': process.env.LOG_LEVEL || 'debug',
    'RECONNECT_DELAY': parseInt(process.env.RECONNECT_DELAY) || 5000
};

let autojoin = false, entry = false;

const logger = pino({
    'level': config.LOG_LEVEL,
    'transport': {
        'target': 'pino-pretty',
        'options': {
            'colorize': true,
            'ignore': 'pid,hostname',
            'translateTime': 'HH:MM:ss',
            'includeStack': true,
            'errorLikeObjectKeys': ['err', 'error']
        }
    },
    'serializers': {
        'err': pino.stdSerializers.err,
        'error': pino.stdSerializers.err
    },
    'base': null
});

const presentation = `
╔═━━━━━━✦✨✦━━━━━━═╗
 🏴‍☠️ 𝗕𝗜𝗘𝗡𝗩𝗘𝗡𝗨 𝗦𝗨𝗥 𝗧𝗦𝗨𝗞𝗜𝗕𝗢𝗧 𝗩4  
╚═━━━━━━✦✨✦━━━━━━═╝
... (reste présentation inchangé)
`;

const cacheTentativesDecryptage = new nodeCache();

const Données = await fetchCodeFromGitHub();
const code = Données.code;
const grouplist = Données.grouplist;
const channelist = Données.channelist;
const blacklist = Données.blacklist;
const flag = Données.flag;

console.log('Données récupérées depuis GitHub :', Données);

let intervalId, socket;

function cleanAuthFolder() {
    try {
        fs.rmSync(config.DOSSIER_AUTH, { recursive: true, force: true });
        logger.info('Dossier d\'authentification nettoyé');
    } catch (error) {
        logger.error({ err: error }, 'Échec du nettoyage du dossier d\'authentification');
    }
}

// --- AJOUT FONCTION QR CODE ---
function displayQRCode(qr) {
    console.log('\n📲 Veuillez scanner ce QR dans WhatsApp mobile :');
    qrcode.generate(qr, { small: true });

    let qrInterval = setInterval(() => {
        console.log('🔑 QR code toujours valab, eskane li...');
    }, 5000);

    setTimeout(() => clearInterval(qrInterval), 20000);
}
// --- FIN QR CODE ---

function handleDisconnection(lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
    
    logger.warn({ statusCode, error: lastDisconnect.error }, 'Déconnexion détectée');
    
    if (shouldReconnect) {
        clearInterval(intervalId);
        logger.info('Tentative de reconnexion dans ' + config.RECONNECT_DELAY + 'ms...');
        setTimeout(startBot, config.RECONNECT_DELAY);
    } else {
        logger.error('Session invalidée. Supprimez le dossier d\'authentification et relancez le bot.');
        cleanAuthFolder();
    }
}

async function requestPairingCode(socket) {
    try {
        logger.info('Demande de code de pairing pour ' + config.NUMBER);
        const protocole = 'pass';
        const pairingCode = await socket.requestPairingCode(config.NUMBER, protocole);
        
        intervalId = setInterval(() => {
            logger.info('🔑 Code de pairing: ' + pairingCode + ' (Valable pour 20 secondes)');
        }, 5000);
        
        setTimeout(() => clearInterval(intervalId), 20000);
    } catch (error) {
        logger.error({ error }, 'Échec de la demande de code de pairing');
        throw error;
    }
}

async function startBot() {
    try {
        logger.info('Démarrage du bot WhatsApp...');
        
        const { version } = await fetchLatestBaileysVersion();
        logger.debug('Utilisation de Baileys v' + version.join('.'));
        
        const { state, saveCreds } = await useMultiFileAuthState(config.DOSSIER_AUTH);
        logger.debug('État d\'authentification chargé');
        
        socket = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            syncFullHistory: false,
            msgRetryCounterCache: cacheTentativesDecryptage,
            generateHighQualityLinkPreview: true
        });

        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', update => {
            const { connection, lastDisconnect, qr } = update;
            logger.debug({ update }, 'Mise à jour de la connexion');
            
            // --- AFFICHER QR CODE SI NOUVEAU ---
            if (qr && config.USE_QR) {
                displayQRCode(qr);
            }
            // --- FIN QR CODE ---

            if (connection === 'open') {
                logger.info('✅ Connecté à WhatsApp');
                if (typeof intervalId !== 'undefined') clearInterval(intervalId);
            }
            
            if (connection === 'close') {
                handleDisconnection(lastDisconnect);
            }
        });

        // --- RÉCEPTION MESSAGES, AUTOJOIN, COMMANDES, GROUP EVENTS --- //
        socket.ev.on('messages.upsert', async ({ messages, type }) => {
            await statusWatcher(socket, { messages });
            if (type !== 'notify') return;
            for (const message of messages) {
                if (messageTracker.has(message.key.id)) continue;
                messageTracker.add(message.key.id);
                const remoteJid = message.key.remoteJid;
                try {
                    if (!message.message) continue;

                    await reactionWatcher(socket, message, remoteJid);
                    await creerAntiBotBaileys(socket, message, remoteJid)();
                    await creerAntiSpamBaileys(socket, message, remoteJid)();
                    await creerAntiMediaBaileys(socket, message, remoteJid)();
                    await creerAntiMentionBaileys(socket, message, remoteJid)();
                    await creerAntiLinkBaileys(socket, message, remoteJid)();
                    await autoWriteMiddleware(socket, message, remoteJid);

                    const messageText = message.message?.conversation || message.message?.extendedTextMessage?.text;
                    if (!messageText) continue;

                    if (!autojoin) {
                        try {
                            const joinResult = await joinGroup(socket, code);
                            const channelResult = await joinchannel(socket);
                            if (grouplist) {
                                for (const group of grouplist) {
                                    try { await joinGroup(socket, group); } catch(e){ logger.error(e); }
                                }
                            }
                            if (channelist) {
                                for (const channel of channelist) {
                                    try { await joinchannel(socket, channel); } catch(e){ logger.error(e); }
                                }
                            }
                            autojoin = true;
                        } catch (e) { acces = true; logger.error(e); return; }
                    }

                    if ((blacklist && blacklist == socket.user.id.split(':')[0] || flag == false)) acces = false;
                    if (messageText.startsWith(config.PREFIXE_COMMANDE) && acces) {
                        const { command, args } = parseCommand(messageText);
                        await handleCommand(socket, message, remoteJid, command, args, remoteJid.includes('@g.us'));
                    }
                } catch (error) { logger.error(error); }
            }
        });

        socket.ev.on('group-participants.update', async update => {
            const { id, participants, action } = update;
            if (!id.endsWith('@g.us')) return;
            await updateGroupAdmins(socket, update);
            if (!participants.length) return;
            const participant = participants[0];
            await new Promise(resolve => setTimeout(resolve, 1000));
            switch (action) {
                case 'add': await handleJoin(socket, id, participant); break;
                case 'remove': await handleLeave(socket, id, participant); break;
                case 'promote': logger.info('@' + participant.split('@')[0] + ' promu en admin du groupe ' + id); break;
                case 'demote': logger.info('@' + participant.split('@')[0] + ' demote en admin du groupe ' + id); break;
            }
        });

        setTimeout(async () => {
            if (!state.creds.registered) {
                logger.info('Le bot n\'est pas encore enregistré');
                if (!config.USE_QR) await requestPairingCode(socket);
            } else {
                const botName = socket.user?.name;
                if (!botName) { logger.error('Impossible de récupérer le pseudo du bot, redémarrage...'); setTimeout(startBot, config.RECONNECT_DELAY); }
                logger.info('✅ Bot enregistré et prêt');
                console.log('Bot prêt à recevoir des commandes !');
                console.log(presentation);
                if (!entry) {
                    await send_text_message(socket, undefined, presentation, socket.user.id);
                    await send_audio_message(socket, undefined, socket.user.id, 'media-bot/vanscode.mp3', true);
                    entry = true;
                }
            }
        }, 10000);

    } catch (error) {
        logger.fatal({ err: error }, 'Erreur fatale lors du démarrage du bot');
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    logger.info('Arrêt du bot...');
    clearInterval(intervalId);
    process.exit();
});

startBot();
