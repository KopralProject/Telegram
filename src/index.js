require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Cloudflare = require('./cloudflare');
const Utils = require('./utils');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLOUDFLARE_EMAIL = process.env.CLOUDFLARE_EMAIL;
const CLOUDFLARE_API_KEY = process.env.CLOUDFLARE_API_KEY;
const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID ? process.env.ALLOWED_USER_ID.split(',').map(id => parseInt(id.trim())) : [];

const bot = new Telegraf(BOT_TOKEN);
const cf = new Cloudflare(CLOUDFLARE_EMAIL, CLOUDFLARE_API_KEY);

// Middleware untuk otorisasi
bot.use(async (ctx, next) => {
    if (ALLOWED_USER_ID.length > 0 && !ALLOWED_USER_ID.includes(ctx.from.id)) {
        console.warn(`Unauthorized access attempt from user ID: ${ctx.from.id}`);
        await ctx.reply('Anda tidak diizinkan untuk menggunakan bot ini.');
        return;
    }
    await next();
});

// State management (sederhana untuk contoh ini, bisa diperbaiki dengan database)
const userState = {}; // { userId: { step: 'waitingForDomain', data: {} } }

bot.start(async (ctx) => {
    await ctx.reply('Selamat datang di Cloudflare DNS Bot! Gunakan /menu untuk melihat opsi.');
});

bot.command('menu', async (ctx) => {
    await ctx.reply('Pilih opsi:', Markup.inlineKeyboard([
        [Markup.button.callback('Daftar Domain', 'list_zones')],
        [Markup.button.callback('Daftar Wildcard Records', 'list_wildcard_records')],
        [Markup.button.callback('Tambah Record Wildcard', 'add_wildcard_record')],
        [Markup.button.callback('Hapus Record Wildcard', 'delete_wildcard_record')],
        [Markup.button.callback('Update Record Wildcard', 'update_wildcard_record')]
    ]));
});

// --- Callback Query Handlers ---

bot.action('list_zones', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const zones = await cf.getZones();
        if (zones.length === 0) {
            return ctx.reply('Tidak ada domain yang ditemukan di akun Cloudflare Anda.');
        }

        let message = '<b>Daftar Domain Anda:</b>\n\n';
        zones.forEach(zone => {
            message += `• <code>${zone.name}</code> (ID: <code>${zone.id}</code>)\n`;
        });
        await ctx.replyWithHTML(message);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan: ${error.message}`);
    }
});

bot.action('list_wildcard_records', async (ctx) => {
    await ctx.answerCbQuery();
    userState[ctx.from.id] = { step: 'waitingForZoneForList' };
    await ctx.reply('Masukkan nama domain (misal: `example.com`) untuk menampilkan record wildcard:');
});

bot.action('add_wildcard_record', async (ctx) => {
    await ctx.answerCbQuery();
    userState[ctx.from.id] = { step: 'waitingForZoneForAdd' };
    await ctx.reply('Masukkan nama domain (misal: `example.com`) untuk menambahkan record wildcard:');
});

bot.action('delete_wildcard_record', async (ctx) => {
    await ctx.answerCbQuery();
    userState[ctx.from.id] = { step: 'waitingForZoneForDelete' };
    await ctx.reply('Masukkan nama domain (misal: `example.com`) untuk menghapus record wildcard:');
});

bot.action('update_wildcard_record', async (ctx) => {
    await ctx.answerCbQuery();
    userState[ctx.from.id] = { step: 'waitingForZoneForUpdate' };
    await ctx.reply('Masukkan nama domain (misal: `example.com`) untuk memperbarui record wildcard:');
});

// --- Message Handlers (State-based) ---

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    if (!userState[userId]) {
        // Jika tidak ada state, abaikan atau berikan pesan default
        return ctx.reply('Silakan gunakan /menu untuk memulai.');
    }

    const { step, data } = userState[userId];

    switch (step) {
        case 'waitingForZoneForList':
            await handleListWildcardRecords(ctx, text);
            break;
        case 'waitingForZoneForAdd':
            userState[userId] = { step: 'waitingForWildcardSubdomain', data: { domain: text } };
            await ctx.reply('Masukkan subdomain wildcard (misal: `*.dev` atau `*.staging`):');
            break;
        case 'waitingForWildcardSubdomain':
            userState[userId] = { ...userState[userId], step: 'waitingForRecordType', data: { ...data, wildcardSubdomain: text } };
            await ctx.reply('Pilih tipe record:', Markup.inlineKeyboard([
                [Markup.button.callback('A', 'add_type_A')],
                [Markup.button.callback('CNAME', 'add_type_CNAME')]
            ]));
            break;
        case 'waitingForContentA':
            await handleAddRecordA(ctx, text);
            break;
        case 'waitingForContentCNAME':
            await handleAddRecordCNAME(ctx, text);
            break;
        case 'waitingForZoneForDelete':
            await handleDeleteWildcardRecords(ctx, text);
            break;
        case 'waitingForRecordIdToDelete':
            await handleDeleteConfirmation(ctx, text);
            break;
        case 'waitingForZoneForUpdate':
            await handleUpdateWildcardRecords(ctx, text);
            break;
        case 'waitingForRecordIdToUpdate':
            userState[userId] = { ...userState[userId], step: 'waitingForUpdateAction', data: { ...data, recordId: text } };
            await ctx.reply('Pilih apa yang ingin diupdate:', Markup.inlineKeyboard([
                [Markup.button.callback('Update Konten', 'update_content')],
                [Markup.button.callback('Ubah Proxy', 'toggle_proxy')]
            ]));
            break;
        case 'waitingForNewContentA':
            await handleUpdateRecordA(ctx, text);
            break;
        case 'waitingForNewContentCNAME':
            await handleUpdateRecordCNAME(ctx, text);
            break;
        default:
            await ctx.reply('Perintah tidak dikenali. Gunakan /menu.');
            break;
    }
});

// --- Helper Functions for Handlers ---

async function getZoneId(ctx, domainName) {
    const zones = await cf.getZones();
    const targetZone = zones.find(zone => zone.name === domainName);
    if (!targetZone) {
        await ctx.reply(`Domain \`${domainName}\` tidak ditemukan di akun Cloudflare Anda. Pastikan nama domain sudah benar dan ditambahkan ke Cloudflare.`);
        delete userState[ctx.from.id];
        return null;
    }
    return targetZone.id;
}

async function handleListWildcardRecords(ctx, domainName) {
    const userId = ctx.from.id;
    try {
        const zoneId = await getZoneId(ctx, domainName);
        if (!zoneId) return;

        const wildcardRecords = await cf.getDNSRecords(zoneId, null, `*.${Utils.getParentDomain(domainName)}`); // Get all types with wildcard
        const filteredWildcardRecords = wildcardRecords.filter(record => record.name.startsWith('*.'));

        if (filteredWildcardRecords.length === 0) {
            await ctx.reply(`Tidak ada record wildcard untuk domain \`${domainName}\`.`);
            return;
        }

        let message = `<b>Record Wildcard untuk \`${domainName}\`:</b>\n\n`;
        filteredWildcardRecords.forEach(record => {
            message += `• ID: <code>${record.id}</code>\n  Nama: <code>${record.name}</code>\n  Tipe: <code>${record.type}</code>\n  Konten: <code>${record.content}</code>\n  Proxy: <code>${record.proxied ? '✅' : '❌'}</code>\n\n`;
        });
        await ctx.replyWithHTML(message);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat mengambil record: ${error.message}`);
    } finally {
        delete userState[userId];
    }
}

bot.action('add_type_A', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    userState[userId].step = 'waitingForContentA';
    userState[userId].data.type = 'A';
    await ctx.reply('Masukkan IP address (misal: `192.168.1.1`):');
});

bot.action('add_type_CNAME', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    userState[userId].step = 'waitingForContentCNAME';
    userState[userId].data.type = 'CNAME';
    await ctx.reply('Masukkan host tujuan (misal: `example.com` atau `your-app.herokuapp.com`):');
});

async function handleAddRecordA(ctx, content) {
    const userId = ctx.from.id;
    const { domain, wildcardSubdomain, type } = userState[userId].data;

    if (!Utils.isValidIPv4(content)) {
        await ctx.reply('IP Address tidak valid. Harap masukkan IP yang benar.');
        return;
    }

    try {
        const zoneId = await getZoneId(ctx, domain);
        if (!zoneId) return;

        const fullWildcardName = `${wildcardSubdomain}.${Utils.getParentDomain(domain)}`;
        // Check if a record with the same name and type already exists
        const existingRecords = await cf.getDNSRecords(zoneId, type, fullWildcardName);
        if (existingRecords && existingRecords.length > 0) {
            await ctx.reply(`Record wildcard \`${fullWildcardName}\` (tipe ${type}) sudah ada.`);
            delete userState[userId];
            return;
        }

        userState[userId].data.content = content;
        await ctx.reply('Aktifkan proxy (CDN Cloudflare)?', Markup.inlineKeyboard([
            [Markup.button.callback('Ya', 'add_proxy_yes')],
            [Markup.button.callback('Tidak', 'add_proxy_no')]
        ]));
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan: ${error.message}`);
        delete userState[userId];
    }
}

async function handleAddRecordCNAME(ctx, content) {
    const userId = ctx.from.id;
    const { domain, wildcardSubdomain, type } = userState[userId].data;

    if (!Utils.isValidDomain(content) && !content.includes('.')) { // Simple check for CNAME target
        await ctx.reply('Host tujuan tidak valid. Harap masukkan domain atau subdomain yang benar.');
        return;
    }

    try {
        const zoneId = await getZoneId(ctx, domain);
        if (!zoneId) return;

        const fullWildcardName = `${wildcardSubdomain}.${Utils.getParentDomain(domain)}`;
        // Check if a record with the same name and type already exists
        const existingRecords = await cf.getDNSRecords(zoneId, type, fullWildcardName);
        if (existingRecords && existingRecords.length > 0) {
            await ctx.reply(`Record wildcard \`${fullWildcardName}\` (tipe ${type}) sudah ada.`);
            delete userState[userId];
            return;
        }

        userState[userId].data.content = content;
        await ctx.reply('Aktifkan proxy (CDN Cloudflare)?', Markup.inlineKeyboard([
            [Markup.button.callback('Ya', 'add_proxy_yes')],
            [Markup.button.callback('Tidak', 'add_proxy_no')]
        ]));
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan: ${error.message}`);
        delete userState[userId];
    }
}

bot.action('add_proxy_yes', async (ctx) => {
    await ctx.answerCbQuery();
    await finalizeAddRecord(ctx, true);
});

bot.action('add_proxy_no', async (ctx) => {
    await ctx.answerCbQuery();
    await finalizeAddRecord(ctx, false);
});

async function finalizeAddRecord(ctx, proxied) {
    const userId = ctx.from.id;
    const { domain, wildcardSubdomain, type, content } = userState[userId].data;

    try {
        const zoneId = await getZoneId(ctx, domain);
        if (!zoneId) return;

        const fullWildcardName = `${wildcardSubdomain}.${Utils.getParentDomain(domain)}`;

        await cf.createDNSRecord(zoneId, type, fullWildcardName, content, proxied);
        await ctx.replyWithHTML(`Record wildcard berhasil ditambahkan:\n\nNama: <code>${fullWildcardName}</code>\nTipe: <code>${type}</code>\nKonten: <code>${content}</code>\nProxy: <code>${proxied ? '✅' : '❌'}</code>`);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat menambahkan record: ${error.message}`);
    } finally {
        delete userState[userId];
    }
}

async function handleDeleteWildcardRecords(ctx, domainName) {
    const userId = ctx.from.id;
    try {
        const zoneId = await getZoneId(ctx, domainName);
        if (!zoneId) return;

        const wildcardRecords = await cf.getDNSRecords(zoneId, null, `*.${Utils.getParentDomain(domainName)}`);
        const filteredWildcardRecords = wildcardRecords.filter(record => record.name.startsWith('*.'));

        if (filteredWildcardRecords.length === 0) {
            await ctx.reply(`Tidak ada record wildcard untuk domain \`${domainName}\` yang bisa dihapus.`);
            delete userState[userId];
            return;
        }

        let message = `<b>Pilih Record Wildcard untuk Dihapus (masukkan ID):</b>\n\n`;
        const buttons = [];
        filteredWildcardRecords.forEach(record => {
            message += `• ID: <code>${record.id}</code>\n  Nama: <code>${record.name}</code>\n  Tipe: <code>${record.type}</code>\n  Konten: <code>${record.content}</code>\n  Proxy: <code>${record.proxied ? '✅' : '❌'}</code>\n\n`;
            buttons.push([Markup.button.callback(`Hapus ${record.name}`, `delete_record_id_${record.id}`)]);
        });
        userState[userId] = { step: 'waitingForRecordIdToDelete', data: { domain: domainName, zoneId: zoneId, records: filteredWildcardRecords } };
        await ctx.replyWithHTML(message);
        // You might want to provide the IDs in a more user-friendly way, e.g., a list or selectable buttons
        // For simplicity, we ask for ID input here.
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat mengambil record: ${error.message}`);
        delete userState[userId];
    }
}

async function handleDeleteConfirmation(ctx, recordId) {
    const userId = ctx.from.id;
    const { zoneId, records } = userState[userId].data;
    const recordToDelete = records.find(r => r.id === recordId);

    if (!recordToDelete) {
        await ctx.reply('ID record tidak valid. Harap masukkan ID yang benar dari daftar.');
        return;
    }

    try {
        await cf.deleteDNSRecord(zoneId, recordId);
        await ctx.replyWithHTML(`Record wildcard <code>${recordToDelete.name}</code> (ID: <code>${recordId}</code>) berhasil dihapus.`);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat menghapus record: ${error.message}`);
    } finally {
        delete userState[userId];
    }
}

async function handleUpdateWildcardRecords(ctx, domainName) {
    const userId = ctx.from.id;
    try {
        const zoneId = await getZoneId(ctx, domainName);
        if (!zoneId) return;

        const wildcardRecords = await cf.getDNSRecords(zoneId, null, `*.${Utils.getParentDomain(domainName)}`);
        const filteredWildcardRecords = wildcardRecords.filter(record => record.name.startsWith('*.'));

        if (filteredWildcardRecords.length === 0) {
            await ctx.reply(`Tidak ada record wildcard untuk domain \`${domainName}\` yang bisa diperbarui.`);
            delete userState[userId];
            return;
        }

        let message = `<b>Pilih Record Wildcard untuk Diperbarui (masukkan ID):</b>\n\n`;
        filteredWildcardRecords.forEach(record => {
            message += `• ID: <code>${record.id}</code>\n  Nama: <code>${record.name}</code>\n  Tipe: <code>${record.type}</code>\n  Konten: <code>${record.content}</code>\n  Proxy: <code>${record.proxied ? '✅' : '❌'}</code>\n\n`;
        });
        userState[userId] = { step: 'waitingForRecordIdToUpdate', data: { domain: domainName, zoneId: zoneId, records: filteredWildcardRecords } };
        await ctx.replyWithHTML(message);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat mengambil record: ${error.message}`);
        delete userState[userId];
    }
}

bot.action('update_content', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const { recordId, records } = userState[userId].data;
    const recordToUpdate = records.find(r => r.id === recordId);

    if (!recordToUpdate) {
        await ctx.reply('Record tidak ditemukan.');
        delete userState[userId];
        return;
    }

    userState[userId].data.recordToUpdate = recordToUpdate; // Store the record for later use
    if (recordToUpdate.type === 'A') {
        userState[userId].step = 'waitingForNewContentA';
        await ctx.reply(`Masukkan IP baru untuk record \`${recordToUpdate.name}\` (saat ini: \`${recordToUpdate.content}\`):`);
    } else if (recordToUpdate.type === 'CNAME') {
        userState[userId].step = 'waitingForNewContentCNAME';
        await ctx.reply(`Masukkan host tujuan baru untuk record \`${recordToUpdate.name}\` (saat ini: \`${recordToUpdate.content}\`):`);
    } else {
        await ctx.reply('Tipe record tidak didukung untuk update konten.');
        delete userState[userId];
    }
});

bot.action('toggle_proxy', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const { recordId, records, zoneId } = userState[userId].data;
    const recordToUpdate = records.find(r => r.id === recordId);

    if (!recordToUpdate) {
        await ctx.reply('Record tidak ditemukan.');
        delete userState[userId];
        return;
    }

    try {
        const newProxiedStatus = !recordToUpdate.proxied;
        await cf.updateDNSRecord(zoneId, recordId, recordToUpdate.type, recordToUpdate.name, recordToUpdate.content, newProxiedStatus, recordToUpdate.ttl);
        await ctx.replyWithHTML(`Status proxy untuk record <code>${recordToUpdate.name}</code> berhasil diubah menjadi: <code>${newProxiedStatus ? '✅ Aktif' : '❌ Nonaktif'}</code>`);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat mengubah status proxy: ${error.message}`);
    } finally {
        delete userState[userId];
    }
});

async function handleUpdateRecordA(ctx, newContent) {
    const userId = ctx.from.id;
    const { zoneId, recordToUpdate } = userState[userId].data;

    if (!Utils.isValidIPv4(newContent)) {
        await ctx.reply('IP Address baru tidak valid. Harap masukkan IP yang benar.');
        return;
    }

    try {
        await cf.updateDNSRecord(zoneId, recordToUpdate.id, recordToUpdate.type, recordToUpdate.name, newContent, recordToUpdate.proxied, recordToUpdate.ttl);
        await ctx.replyWithHTML(`Record wildcard <code>${recordToUpdate.name}</code> berhasil diperbarui ke IP: <code>${newContent}</code>.`);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat memperbarui record: ${error.message}`);
    } finally {
        delete userState[userId];
    }
}

async function handleUpdateRecordCNAME(ctx, newContent) {
    const userId = ctx.from.id;
    const { zoneId, recordToUpdate } = userState[userId].data;

    if (!Utils.isValidDomain(newContent) && !newContent.includes('.')) {
        await ctx.reply('Host tujuan baru tidak valid. Harap masukkan domain atau subdomain yang benar.');
        return;
    }

    try {
        await cf.updateDNSRecord(zoneId, recordToUpdate.id, recordToUpdate.type, recordToUpdate.name, newContent, recordToUpdate.proxied, recordToUpdate.ttl);
        await ctx.replyWithHTML(`Record wildcard <code>${recordToUpdate.name}</code> berhasil diperbarui ke host: <code>${newContent}</code>.`);
    } catch (error) {
        await ctx.reply(`Terjadi kesalahan saat memperbarui record: ${error.message}`);
    } finally {
        delete userState[userId];
    }
}

// Menjalankan bot
bot.launch()
    .then(() => console.log('Bot Telegram berjalan...'))
    .catch(err => console.error('Gagal menjalankan bot:', err));

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
