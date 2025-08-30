// src/services/vpnApiService.js
const axios = require('axios');
const { writeLog } = require('../utils/logger');
const crypto = require('crypto');

function getApiClient(server) {
    try {
        new URL(server.domain);
    } catch (error) {
        throw new Error(`URL Server tidak valid: ${server.domain}`);
    }
    return axios.create({
        baseURL: server.domain,
        headers: {
            'Authorization': `Bearer ${server.api_token}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000 // Timeout 1 menit
    });
}

async function createAccount(server, protocol, username, password, duration) {
    const apiClient = getApiClient(server);
    let endpoint = '';
    let payload = {};
    const masaAktif = duration; 

    switch (protocol) {
        case 'ssh':
            endpoint = '/api/addssh';
            payload = { username, password, masa: masaAktif };
            break;
        case 'vmess':
            endpoint = '/api/add-vmess';
            payload = { user: username, masaaktif: masaAktif };
            break;
        case 'vless':
            endpoint = '/api/add-vless';
            payload = { user: username, masaaktif: masaAktif };
            break;
        case 'trojan':
            endpoint = '/api/add-trojan';
            payload = { user: username, masaaktif: masaAktif };
            break;
        case 'ss':
            endpoint = '/api/add-ss';
            payload = { user: username, masaaktif: masaAktif };
            break;
        case 's5':
            endpoint = '/api/add-s5';
            payload = { username, password, masaaktif: masaAktif };
            break;
        case 'noobzvpn':
            endpoint = '/api/add-noobz';
            payload = { user: username, device: 3, bw: 100, masaaktif: masaAktif };
            break;
        default:
            throw new Error(`Protokol "${protocol}" tidak didukung.`);
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
        writeLog(`[VpnApiService] FATAL: Gagal createAccount ${username} (${protocol}): ${errorMsg}`);
        throw new Error(errorMsg);
    }
}

async function renewAccount(server, protocol, username) {
    const apiClient = getApiClient(server);
    let endpoint = '';
    // Sesuaikan payload berdasarkan dokumentasi API
    const payload = (protocol === 'noobzvpn') ? { username } : { username, days: 30 };

    switch (protocol) {
        case 'ssh': endpoint = '/api/renew-ssh'; break;
        case 'vmess': endpoint = '/api/renew-vmess'; break;
        case 'vless': endpoint = '/api/renew-vless'; break;
        case 'trojan': endpoint = '/api/renew-trojan'; break;
        case 'ss': endpoint = '/api/renew-ss'; break;
        case 's5': endpoint = '/api/renew-s5'; break;
        case 'noobzvpn': endpoint = '/api/renew-noobz'; break;
        default:
            throw new Error(`Protokol "${protocol}" tidak bisa diperpanjang.`);
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

async function deleteAccount(server, protocol, username) {
    const apiClient = getApiClient(server);
    let endpoint = '';
    // NOTE: Endpoint delete tidak ada di dokumentasi API.md.
    // Kode ini mengasumsikan pola endpoint seperti '/api/delssh', dll.
    // Sesuaikan jika endpoint sebenarnya berbeda.
    const payload = { username }; 

    switch (protocol) {
        case 'ssh': endpoint = '/api/delssh'; break;
        case 'vmess': endpoint = '/api/del-vmess'; break;
        case 'vless': endpoint = '/api/del-vless'; break;
        case 'trojan': endpoint = '/api/del-trojan'; break;
        case 'ss': endpoint = '/api/del-ss'; break;
        case 's5': endpoint = '/api/del-s5'; break;
        case 'noobzvpn': endpoint = '/api/del-noobz'; break;
        default:
            throw new Error(`Protokol "${protocol}" tidak bisa dihapus.`);
    }

    try {
        const response = await apiClient.post(endpoint, payload);
        if (response.data.status === "false" || response.status !== 200) {
            // Beberapa API mungkin tidak memberikan status 'true', cek pesan sukses
            if (!response.data.message || !response.data.message.toLowerCase().includes('success')) {
               throw new Error(response.data.message || `Gagal menghapus akun ${username} di server.`);
            }
        }
        writeLog(`[VpnApiService] Akun ${protocol} dihapus: ${username} di server ${server.name}`);
        return response.data;
    } catch (error) {
        const errorMsg = error.response?.data?.message || error.message;
        writeLog(`[VpnApiService] FATAL: Gagal deleteAccount ${username}: ${errorMsg}`);
        throw new Error(errorMsg);
    }
}


function formatAccountDetails(protocol, data, serverName) {
    let details = `✅ <b>Akun Berhasil Dibuat</b>\n\n`;
    details += `<b>▪️ Remarks:</b> <code>${data.user || data.username}</code>\n`;
    details += `<b>▪️ Server:</b> ${serverName}\n`;
    if (data.domain) details += `<b>▪️ Domain/IP:</b> <code>${data.domain || data.ip}</code>\n`;
    
    // Informasi Kredensial
    if (data.password) details += `<b>▪️ Password:</b> <code>${data.password}</code>\n`;
    if (data.uuid) details += `<b>▪️ UUID:</b> <code>${data.uuid}</code>\n`;
    if (data.cipher) details += `<b>▪️ Cipher:</b> <code>${data.cipher}</code>\n`;

    // Informasi Port
    if (data.ports) { // Untuk SSH
        if(data.ports.ssh) details += `<b>▪️ Port SSH:</b> <code>${data.ports.ssh}</code>\n`;
        if(data.ports.ws_tls) details += `<b>▪️ Port WS TLS:</b> <code>${data.ports.ws_tls}</code>\n`;
        if(data.ports.ws_http) details += `<b>▪️ Port WS Non-TLS:</b> <code>${data.ports.ws_http}</code>\n`;
        if(data.ports.socks5) details += `<b>▪️ Port Socks5:</b> <code>${data.ports.socks5}</code>\n`;
    } else { // Untuk protokol lain
        if (data.https) details += `<b>▪️ Port TLS:</b> <code>${data.https}</code>\n`;
        if (data.http) details += `<b>▪️ Port Non-TLS:</b> <code>${data.http}</code>\n`;
        if (data.tls_port) details += `<b>▪️ Port TLS:</b> <code>${data.tls_port}</code>\n`;
        if (data.ntls_port) details += `<b>▪️ Port Non-TLS:</b> <code>${data.ntls_port}</code>\n`; // ntls_port tunggal
        if (data.ntls_ports) details += `<b>▪️ Port Non-TLS:</b> <code>${data.ntls_ports}</code>\n`; // ntls_ports jamak
        if (data.grpc) details += `<b>▪️ Port GRPC:</b> <code>${data.grpc}</code>\n`;
    }
    
    // Informasi Lanjutan
    if (data.path) details += `<b>▪️ Path:</b> <code>${data.path}</code>\n`;
    if (data.service_name) details += `<b>▪️ Service Name:</b> <code>${data.service_name}</code>\n`;

    // Khusus NoobzVPN
    if (protocol === 'noobzvpn') {
        if (data.limit_device) details += `<b>▪️ Limit Device:</b> <code>${data.limit_device}</code>\n`;
        if (data.limit_bandwidth) details += `<b>▪️ Limit Bandwidth:</b> <code>${data.limit_bandwidth}</code>\n`;
    }
    
    // Khusus SSH (SlowDNS)
    if (data.slowdns) {
        if(data.slowdns.nameserver) details += `<b>▪️ Nameserver:</b> <code>${data.slowdns.nameserver}</code>\n`;
        if(data.slowdns.publik_key) details += `<b>▪️ Public Key:</b> <code>${data.slowdns.publik_key}</code>\n`;
    }

    // Tanggal Kedaluwarsa
    const expiryDate = data.expiration_date || data.expired_on || data.expires_on;
    if (expiryDate) details += `<b>▪️ Masa Aktif Hingga:</b> <code>${expiryDate.split(' ')[0]}</code>\n`;

    details += `\n------------------------------------------\n\n`;

    // Tampilkan link/konfigurasi jika ada
    if (data.links && Object.keys(data.links).length > 0) {
        details += `<b>👇 Klik untuk menyalin konfigurasi 👇</b>\n\n`;
        for (const [key, value] of Object.entries(data.links)) {
            // Mengubah kunci menjadi lebih deskriptif jika perlu
            let linkName = key.toUpperCase();
            if (key === 'ntls') linkName = 'NON-TLS';
            details += `<b>${linkName}:</b>\n<code>${value}</code>\n\n`;
        }
    } else if (data.config) { // Untuk SSH
        details += `<b>👇 Konfigurasi SSH 👇</b>\n<code>${data.config}</code>\n\n`;
    }
    
    details += `Terima kasih telah membeli!`;
    return details;
}

module.exports = {
    createAccount,
    renewAccount,
    deleteAccount
};
