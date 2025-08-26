// src/services/vpnApiService.js
const axios = require('axios');
const { writeLog } = require('../utils/logger');
const crypto = require('crypto');

function getApiClient(server) {
    return axios.create({
        baseURL: server.domain,
        headers: {
            'Authorization': `Bearer ${server.api_token}`,
            'Content-Type': 'application/json'
        }
    });
}

async function createAccount(server, protocol, username, password) {
    const apiClient = getApiClient(server);
    let endpoint = '';
    let payload = {};
    const masaAktif = 30;

    switch (protocol) {
        case 'ssh': endpoint = '/api/addssh'; payload = { username, password, masa: masaAktif }; break;
        case 'vmess': endpoint = '/api/add-vmess'; payload = { user: username, masaaktif: masaAktif }; break;
        case 'vless': endpoint = '/api/add-vless'; payload = { user: username, masaaktif: masaAktif }; break;
        case 'trojan': endpoint = '/api/add-trojan'; payload = { user: username, masaaktif: masaAktif }; break;
        case 'ss': endpoint = '/api/add-ss'; payload = { user: username, masaaktif: masaAktif }; break;
        case 's5': endpoint = '/api/add-s5'; payload = { username, password, masaaktif: masaAktif }; break;
        case 'noobzvpn': endpoint = '/api/add-noobz'; payload = { user: username, device: 3, bw: 100, masaaktif: masaAktif }; break;
        default: throw new Error(`Protokol "${protocol}" tidak didukung.`);
    }

    try {
        const response = await apiClient.post(endpoint, payload);
        if (response.data.status !== "true" && response.data.code !== 200) {
            throw new Error(response.data.message || 'Gagal membuat akun di server.');
        }

        writeLog(`[VpnApiService] Akun ${protocol} dibuat: ${username} di server ${server.name}`);
        const formattedDetails = formatAccountDetails(protocol, response.data, server.name);
        const trxId = crypto.randomBytes(8).toString('hex');
        return {
            details: formattedDetails,
            password: response.data.password || password,
            trx_id: `${protocol}-${trxId}`
        };
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.message;
        writeLog(`[VpnApiService] FATAL: Gagal createAccount ${username}: ${errorMsg}`);
        throw new Error(errorMsg);
    }
}

async function renewAccount(server, protocol, username) {
    const apiClient = getApiClient(server);
    let endpoint = '';
    const payload = protocol === 'noobzvpn' ? { username } : { username, days: 30 };

    switch (protocol) {
        case 'ssh': endpoint = '/api/renew-ssh'; break;
        case 'vmess': endpoint = '/api/renew-vmess'; break;
        case 'vless': endpoint = '/api/renew-vless'; break;
        case 'trojan': endpoint = '/api/renew-trojan'; break;
        case 'ss': endpoint = '/api/renew-ss'; break;
        case 's5': endpoint = '/api/renew-s5'; break;
        case 'noobzvpn': endpoint = '/api/renew-noobz'; break;
        default: throw new Error(`Protokol "${protocol}" tidak bisa diperpanjang.`);
    }

    try {
        const response = await apiClient.post(endpoint, payload);
         if (response.data.status === "false" || response.status !== 200) {
            throw new Error(response.data.message || 'Gagal memperpanjang akun di server.');
        }
        writeLog(`[VpnApiService] Akun ${protocol} diperpanjang: ${username} di server ${server.name}`);
        return response.data;
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.message;
        writeLog(`[VpnApiService] FATAL: Gagal renewAccount ${username}: ${errorMsg}`);
        throw new Error(errorMsg);
    }
}

/**
 * Memformat detail akun dari respons API menjadi string HTML yang rapi dan dinamis.
 * @param {string} protocol
 * @param {object} data - Objek respons dari API.
 * @param {string} serverName
 * @returns {string}
 */
function formatAccountDetails(protocol, data, serverName) {
    let details = `✅ <b>Akun Berhasil Dibuat</b>\n\n`;
    details += `<b>▪️ Remarks:</b> <code>${data.user || data.username}</code>\n`;
    details += `<b>▪️ Server:</b> ${serverName}\n`;
    details += `<b>▪️ Domain/IP:</b> <code>${data.domain || data.ip}</code>\n`;
    
    // Informasi Umum
    if (data.password) details += `<b>▪️ Password:</b> <code>${data.password}</code>\n`;
    if (data.uuid) details += `<b>▪️ UUID:</b> <code>${data.uuid}</code>\n`;
    if (data.cipher) details += `<b>▪️ Cipher:</b> <code>${data.cipher}</code>\n`;

    // Informasi Port
    if (data.ports) { // Untuk SSH
        details += `<b>▪️ Port SSH:</b> <code>${data.ports.ssh || '-'}</code>\n`;
        details += `<b>▪️ Port WS:</b> <code>${data.ports.ws_http || '-'} / ${data.ports.ws_tls || '-'} (SSL)</code>\n`;
        details += `<b>▪️ Port Socks5:</b> <code>${data.ports.socks5 || '-'}</code>\n`;
    } else { // Untuk protokol lain
        if (data.https) details += `<b>▪️ Port TLS:</b> <code>${data.https}</code>\n`;
        if (data.http) details += `<b>▪️ Port Non-TLS:</b> <code>${data.http}</code>\n`;
        if (data.grpc) details += `<b>▪️ Port GRPC:</b> <code>${data.grpc}</code>\n`;
    }
    
    // Informasi Jaringan & Path
    if (data.path) details += `<b>▪️ Path:</b> <code>${data.path}</code>\n`;
    if (data.service_name) details += `<b>▪️ Service Name:</b> <code>${data.service_name}</code>\n`;

    // Informasi Spesifik NoobzVPN
    if (protocol === 'noobzvpn') {
        details += `<b>▪️ Limit Device:</b> <code>${data.limit_device}</code>\n`;
        details += `<b>▪️ Limit Bandwidth:</b> <code>${data.limit_bandwidth}</code>\n`;
    }
    
    // Informasi SlowDNS (khusus SSH)
    if (data.slowdns) {
        details += `<b>▪️ Nameserver:</b> <code>${data.slowdns.nameserver}</code>\n`;
        details += `<b>▪️ Public Key:</b> <code>${data.slowdns.publik_key}</code>\n`;
    }

    // Tanggal Kedaluwarsa
    const expiryDate = data.expiration_date || data.expired_on || data.expires_on;
    if (expiryDate) details += `<b>▪️ Masa Aktif Hingga:</b> <code>${expiryDate.split(' ')[0]}</code>\n`;

    // Garis Pemisah
    details += `\n------------------------------------------\n\n`;

    // [PERBAIKAN UTAMA DI SINI] Menampilkan Konfigurasi & Link secara dinamis
    if (data.links && Object.keys(data.links).length > 0) {
        details += `<b>👇 Klik untuk menyalin konfigurasi 👇</b>\n\n`;
        for (const [key, value] of Object.entries(data.links)) {
            // Menampilkan setiap link yang ada di dalam objek 'links'
            details += `<b>${key.toUpperCase()}:</b>\n<code>${value}</code>\n\n`;
        }
    } else if (data.config) { // Fallback untuk SSH yang mungkin tidak punya objek 'links'
        details += `<b>👇 Konfigurasi SSH 👇</b>\n<code>${data.config}</code>\n\n`;
    }
    
    details += `Terima kasih telah membeli!`;
    return details;
}

module.exports = {
    createAccount,
    renewAccount
};
