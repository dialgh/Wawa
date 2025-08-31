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
 🏴‍☠️ 𝗕𝗜𝗘𝗡𝗩𝗘𝗡𝗨𝗘 𝗦𝗨𝗥 𝗧𝗦𝗨𝗞𝗜𝗕𝗢𝗧 𝗩4  
╚═━━━━━━✦✨✦━━━━━━═╝
... (reste de la présentation inchangé)
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

function displayQRCode(qr) {
    console.log('\n📲 Veuillez scanner ce QR dans WhatsApp mobile :');
    qrcode.generate(qr, { small: true });
    console.log();
}

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
            
            if (qr && config.USE_QR) {
                displayQRCode(qr);
            }
            
            if (connection === 'open') {
                logger.info('✅ Connecté à WhatsApp');
                clearInterval(intervalId);
            }
            
            if (connection === 'close') {
                handleDisconnection(lastDisconnect);
            }
        });

        socket.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const message of messages) {
                if (messageTracker.has(message.key.id)) continue;
                messageTracker.add(message.key.id);

                const messageText = message.message?.conversation || message.message?.extendedTextMessage?.text;
                if (!messageText) continue;

                // === Debug + Forcer acces ===
                console.log('Message reçu:', messageText);
                acces = true; // Fòse bot la toujou reponn
                // =================================

                if (messageText.startsWith(config.PREFIXE_COMMANDE) && acces) {
                    const { command, args } = parseCommand(messageText);
                    console.log('Commande détectée:', command, 'Args:', args);

                    await handleCommand(
                        socket,
                        message,
                        message.key.remoteJid,
                        command,
                        args,
                        message.key.remoteJid.includes('@g.us')
                    );
                }
            }
        });

        // ... (reste des event handlers et fonctions unchanged)
        // Group participants update, autojoin, send presentation etc.
        // Toutes les parties originales restent inchangées
        // Juste QR code + debug log + acces forcé ajouté
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
