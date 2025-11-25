// src/utils/helpers.js
module.exports = {
  formatRupiah: (number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(number || 0);
  },
  backButton: (text = '⬅️ Kembali', callback_data = 'back_menu') => {
    return { text, callback_data };
  },
  prettyLine: () => '------------------------------------------',
  censorUsername: (username) => {
    if (!username || username.length < 3) return '***';
    const start = username.slice(0, 2);
    const end = username.slice(-1);
    const censored = '*'.repeat(Math.max(3, username.length - 3));
    return `${start}${censored}${end}`;
  },
  censorBalance: (amount) => {
      const formatted = module.exports.formatRupiah(amount);
      return formatted.replace(/\d/g, (match, offset) => (offset < 4 ? match : '*'));
  },
  escapeMarkdown: (text) => {
    if (!text) return '';
    return text.toString().replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
};
