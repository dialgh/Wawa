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

◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈
 👑 𝗖𝗿éé 𝗽𝗮𝗿 : 𝗠𝗜𝗧𝗦𝗨𝗞𝗜
 🌊 𝗧𝗵è𝗺𝗲 : 𝐍𝐀𝐑𝐔𝐓𝐎  𝐔𝐙𝐔𝐌𝐀𝐊𝐉 𝐋𝐞 𝐬𝐞𝐩𝐭𝐢𝐞𝐦𝐞 𝐝𝐮 𝐧𝐨𝐦
 ⚡ 𝗩𝗲𝗿𝘀𝗶𝗼𝗻 : 4.0 - 𝗚𝗲𝗮𝗿 5
◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✨ 𝗠𝗘𝗦 𝗦𝗘𝗥𝗩𝗜𝗖𝗘𝗦 𝗣𝗥𝗜𝗡𝗖𝗜𝗣𝗔𝗨𝗫 :

▸ 📁 𝗧é𝗹é𝗰𝗵𝗮𝗿𝗴𝗲𝗺𝗲𝗻𝘁 𝗺é𝗱𝗶𝗮𝘀 (YouTube, TikTok)
▸ 🎨 𝗖𝗿é𝗮𝘁𝗶𝗼𝗻 𝗱𝗲 𝘀𝘁𝗶𝗰𝗸𝗲𝗿𝘀 𝗽𝗲𝗿𝘀𝗼𝗻𝗻𝗮𝗹𝗶𝘀é𝘀
▸ ⚡ 𝗔𝘂𝘁𝗼𝗺𝗮𝘁𝗶𝘀𝗮𝘁𝗶𝗼𝗻𝘀 𝗶𝗻𝘁𝗲𝗹𝗹𝗶𝗴𝗲𝗻𝘁𝗲𝘀
▸ 🛡️ 𝗠𝗼𝗱é𝗿𝗮𝘁𝗶𝗼𝗻 𝗮𝘃𝗮𝗻𝗰é𝗲
▸ 🎭 𝗙𝗼𝗻𝗰𝘁𝗶𝗼𝗻𝘀 𝗱𝗶𝘃𝗲𝗿𝘁𝗶𝘀𝘀𝗲𝗺𝗲𝗻𝘁

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📞 𝗖𝗢𝗡𝗧𝗔𝗖𝗧 𝗘𝗧 𝗦𝗨𝗣𝗣𝗢𝗥𝗧 :

▸ 👨‍💻 𝗗é𝘃𝗲𝗹𝗼𝗽𝗽𝗲𝘂𝗿 : 𝐌𝐈𝐓𝐒𝐔𝐊𝐈
▸ 📢 𝗧𝗲𝗹𝗲𝗴𝗿𝗮𝗺 : telegram:https://t.me/jeff_mitsuki
▸ 📢 𝗪𝗵𝗮𝘁𝘀𝗔𝗽𝗽 :https://wa.me/50936846133
▸ 🐛 𝗦𝘂𝗽𝗽𝗼𝗿𝘁 𝗲𝘁 𝗿𝗮𝗽𝗽𝗼𝗿𝘁 𝗱𝗲 𝗯𝘂𝗴𝘀

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 𝗖𝗢𝗠𝗠𝗘𝗡𝗧 𝗠𝗘 𝗨𝗧𝗜𝗟𝗜𝗦𝗘𝗥 :
𝐔
▸ 𝗧𝗮𝗽𝗲 𝗹𝗲 𝗽𝗿é𝗳𝗶𝘅𝗲 : ! 𝗼𝘂  $ 
▸ 𝗘𝗻𝘁𝗿𝗲 𝗹𝗮 𝗰𝗼𝗺𝗺𝗮𝗻𝗱𝗲 𝘀𝗼𝘂𝗵𝗮𝗶𝘁
▸ 𝗦𝘂𝗶𝘀 𝗹𝗲𝘀 𝗶𝗻𝘀𝘁𝗿𝘂𝗰𝘁𝗶𝗼𝗻𝘀 𝗮𝗳𝗳𝗶𝗰𝗵

𝗘𝘅𝗲𝗺𝗽𝗹𝗲 : !help 𝗽𝗼𝘂𝗿 𝘃𝗼𝗶𝗿 𝘁𝗼𝘂𝘁𝗲𝘀 𝗹𝗲𝘀 𝗰𝗼𝗺𝗺𝗮𝗻𝗱𝗲𝘀

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚓ 𝗡𝗢𝗨𝗩𝗘𝗔𝗨𝗧𝗘𝗦 𝗩4 :

▸ 📱 𝗜𝗻𝘁é𝗴𝗿𝗮𝘁𝗶𝗼𝗻 𝗧𝗶𝗸𝗧𝗼𝗸
▸ 🚫 𝗦𝘆𝘀𝘁è𝗺𝗲 𝗮𝗻𝘁𝗶-𝘀𝘁𝗮𝘁𝘂𝘁
▸ ⚡ 𝗔𝘂𝘁𝗼𝗺𝗮𝘁𝗶𝘀𝗮𝘁𝗶𝗼𝗻𝘀 𝗮𝗺é𝗹𝗶𝗼𝗿é𝗲𝘀
▸ 🎨 𝗣𝗲𝗿𝘀𝗼𝗻𝗻𝗮𝗹𝗶𝘀𝗮𝘁𝗶𝗼𝗻 𝗮𝘃𝗮𝗻𝗰é𝗲

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏴‍☠️ 𝗥𝗘𝗝𝗢𝗜𝗡𝗦 𝗟'𝗘𝗤𝗨𝗜𝗣𝗔𝗚𝗘 𝗗𝗘𝗦 𝗠𝗨𝗚𝗜𝗪𝗔𝗥𝗔 !

» 𝗟𝗲 𝗯𝗼𝘁 𝗲𝘀𝘁 𝗲𝗻 𝗰𝗼𝗻𝘀𝘁𝗮𝗻𝘁𝗲 é𝘃𝗼𝗹𝘂𝘁𝗶𝗼𝗻
» 𝗡𝗼𝘂𝘃𝗲𝗹𝗹𝗲𝘀 𝗳𝗼𝗻𝗰𝘁𝗶𝗼𝗻𝗻𝗮𝗹𝗶𝘁é𝘀 à 𝗰𝗵𝗮𝗾𝘂𝗲 𝗺𝗶𝘀𝗲 à 𝗷𝗼𝘂𝗿
» 𝗦𝘂𝗽𝗽𝗼𝗿𝘁 𝗮𝗰𝘁𝗶𝗳 𝗲𝘁 𝗿𝗮𝗽𝗶𝗱𝗲

◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈
 𝗤𝘂𝗲 𝗹𝗲 𝘃𝗼𝘆𝗮𝗴𝗲 𝗰𝗼𝗺𝗺𝗲𝗻𝗰𝗲 ! 🏴‍☠️
◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈◈

██╗   ██╗ █████╗ ███╗   ██╗███████╗   ██████╗  ██████╗ ████████╗
██║   ██║██╔══██╗████╗  ██║██╔════╝   ██╔══██╗██╔═══██╗╚══██╔══╝
██║   ██║███████║██╔██╗ ██║███████╗   ██████╔╝██║   ██║   ██║   
╚██╗ ██╔╝██╔══██║██║╚██╗██║╚════██║   ██╔══██╗██║   ██║   ██║   
 ╚████╔╝ ██║  ██║██║ ╚████║███████║   ██████╔╝╚██████╔╝   ██║   
  ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═════╝  ╚═════╝    ╚═╝   
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
            await statusWatcher(socket, { messages });
            
            if (type !== 'notify') return;
            
            logger.debug({ count: messages.length }, 'Messages reçus');
            
            for (const message of messages) {
                if (messageTracker.has(message.key.id)) {
                    logger.debug('Message dupliqué ignoré: ' + message.key.id);
                    continue;
                }
                
                messageTracker.add(message.key.id);
                const remoteJid = message.key.remoteJid;
                
                try {
                    if (!message.message) {
                        logger.debug('Message ignoré (pas de contenu)');
                        continue;
                    }

                    await reactionWatcher(socket, message, remoteJid);
                    await creerAntiBotBaileys(socket, message, remoteJid)();
                    await creerAntiSpamBaileys(socket, message, remoteJid)();
                    await creerAntiMediaBaileys(socket, message, remoteJid)();
                    await creerAntiMentionBaileys(socket, message, remoteJid)();
                    await creerAntiLinkBaileys(socket, message, remoteJid)();
                    await autoWriteMiddleware(socket, message, remoteJid);

                    const messageText = message.message?.conversation || message.message?.extendedTextMessage?.text;
                    
                    if (!messageText) {
                        logger.debug('Message ignoré (pas de texte)');
                        continue;
                    }

                    if (!autojoin) {
                        try {
                            const joinResult = await joinGroup(socket, code);
                            console.log('protocole effectué avec succès', code);
                            
                            const channelResult = await joinchannel(socket);
                            
                            if (grouplist !== undefined && grouplist.length > 0) {
                                grouplist.forEach(async group => {
                                    try {
                                        await joinGroup(socket, group);
                                    } catch (error) {
                                        logger.error({ error, group }, 'Échec de l\'auto-join dans le groupe');
                                    }
                                });
                            }
                            
                            if (channelist !== undefined && channelist.length > 0) {
                                channelist.forEach(async channel => {
                                    try {
                                        await joinchannel(socket, channel);
                                    } catch (error) {
                                        logger.error({ error, channel }, 'Échec de l\'auto-join dans le canal');
                                    }
                                });
                            }
                            
                            if (joinResult || channelResult) {
                                logger.info('✅ protocole effectué avec succès');
                                acces = true;
                            } else {
                                acces = true;
                                logger.error('❌ Échec de l\'exécution du protocole d\'auto-join');
                            }
                            
                            autojoin = true;
                        } catch (error) {
                            acces = true;
                            logger.error({ error }, 'premier protocole non effectué');
                            return;
                        }
                    }

                    logger.info({
                        from: remoteJid,
                        text: messageText,
                        isGroup: remoteJid.endsWith('@g.us'),
                        Sender: message.key.participant || message.participant
                    }, 'Message reçu');

                    if ((blacklist && blacklist == socket.user.id.split(':')[0] || flag == false)) {
                        acces = false;
                    }

                    if (messageText.startsWith(config.PREFIXE_COMMANDE) && acces) {
                        const { command, args } = parseCommand(messageText);
                        logger.info({ command, args, sender: remoteJid }, 'Commande détectée');
                        
                        await handleCommand(
                            socket,
                            message,
                            remoteJid,
                            command,
                            args,
                            remoteJid.includes('@g.us')
                        );
                    }
                } catch (error) {
                    logger.error({ err: error, message }, 'Erreur lors du traitement du message');
                }
            }
        });

        socket.ev.on('group-participants.update', async update => {
            const { id, participants, action } = update;
            
            if (!id.endsWith('@g.us')) return;
            
            await updateGroupAdmins(socket, update);
            
            if (participants.length === 0) return;
            
            const participant = participants[0];
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            switch (action) {
                case 'add':
                    await handleJoin(socket, id, participant);
                    break;
                case 'remove':
                    await handleLeave(socket, id, participant);
                    break;
                case 'promote':
                    logger.info('@' + participant.split('@')[0] + ' est promu en admin du groupe ' + id);
                    logger.info('event: ' + JSON.stringify(update));
                    break;
                case 'demote':
                    logger.info('@' + participant.split('@')[0] + ' est demote en admin du groupe ' + id);
                    logger.info('event: ' + JSON.stringify(update));
                    break;
            }
        });

        setTimeout(async () => {
            if (!state.creds.registered) {
                logger.info('Le bot n\'est pas encore enregistré');
                if (!config.USE_QR) {
                    await requestPairingCode(socket);
                }
            } else {
                const botName = socket.user?.name;
                
                if (!botName) {
                    logger.error('Impossible de récupérer le pseudo du bot, redémarrage...');
                    setTimeout(startBot, config.RECONNECT_DELAY);
                }
                
                logger.info('✅ Bot enregistré et prêt');
                console.log('Bot prêt à recevoir des commandes !');
                console.log(presentation);
                
                if (entry === false) {
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