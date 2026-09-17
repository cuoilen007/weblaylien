// Replace the deployed Apps Script only AFTER configuring Turnstile on the website.
// Secret keys belong in Script Properties, never in this file or frontend code.
const HEADERS = ['Mã yêu cầu', 'Thời gian', 'Tên khách', 'Điện thoại', 'Gói dịch vụ', 'Thông báo email'];
const LIMITS = {hour: 20, day: 60, phoneDay: 2, phoneCooldownMs: 10 * 60 * 1000};

function setup() {
  const {sheetId} = leadConfig_();
  const book = SpreadsheetApp.openById(sheetId);
  let sheet = book.getSheetByName('Khách đăng ký');
  if (!sheet) sheet = book.insertSheet('Khách đăng ký');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  MailApp.getRemainingDailyQuota();
}

function leadConfig_() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = String(props.getProperty('SHEET_ID') || '').trim();
  const notifyEmail = String(props.getProperty('NOTIFY_EMAIL') || '').trim();
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(sheetId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail))
    throw new Error('CONFIG');
  return {sheetId, notifyEmail};
}

function validateLead_(p) {
  const lead = {
    id: String(p.requestId || ''), name: String(p.name || '').trim(),
    phone: String(p.phone || '').trim(), plan: String(p.plan || '').trim()
  };
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(lead.id) || !lead.name || lead.name.length > 100 ||
      /[\x00-\x1f\x7f]/.test(lead.name) || !/^[+\d ().-]{8,25}$/.test(lead.phone) ||
      !['Web 1 trang', 'Web giới thiệu', 'Web catalogue', 'Chưa chắc, cần tư vấn'].includes(lead.plan) ||
      p.website || !/^0\d{9}$/.test(normalizePhone_(lead.phone))) throw new Error('INVALID');
  return lead;
}

function normalizePhone_(phone) {
  return String(phone).replace(/^'/, '').replace(/\D/g, '').replace(/^84(?=\d{9}$)/, '0');
}

function verifyCaptcha_(p) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('TURNSTILE_SECRET_KEY');
  const hosts = String(props.getProperty('TURNSTILE_HOSTNAMES') || '')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const token = String(p['cf-turnstile-response'] || '');
  if (!secret || !hosts.length) throw new Error('CONFIG');
  if (!token || token.length > 2048) throw new Error('CAPTCHA');
  // No IP limit: Apps Script does not supply a trustworthy visitor IP here.
  const response = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post', payload: {secret: secret, response: token}, muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('CAPTCHA');
  const result = JSON.parse(response.getContentText());
  if (result.success !== true || result.action !== 'lead' ||
      !hosts.includes(String(result.hostname || '').toLowerCase())) throw new Error('CAPTCHA');
}

function enforceLimits_(rows, phone, now) {
  let hour = 0, day = 0, phoneDay = 0;
  rows.forEach(row => {
    const time = row[1] instanceof Date ? row[1].getTime() : NaN;
    const age = now - time;
    if (!Number.isFinite(age) || age < 0 || age >= 86400000) return;
    day++;
    if (age < 3600000) hour++;
    if (normalizePhone_(row[3]) === phone) {
      phoneDay++;
      if (age < LIMITS.phoneCooldownMs) throw new Error('RATE_LIMIT');
    }
  });
  if (hour >= LIMITS.hour || day >= LIMITS.day || phoneDay >= LIMITS.phoneDay)
    throw new Error('RATE_LIMIT');
}

function safeCell_(value) {
  return /^[=+@-]/.test(value) ? "'" + value : value;
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const id = String(p.requestId || '').slice(0, 80);
  let ok = false, code = 'UNAVAILABLE';
  const lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || e.postData.length > 12000) throw new Error('INVALID');
    const lead = validateLead_(p);
    const {sheetId, notifyEmail} = leadConfig_();
    // Required even for retries: request IDs are public identifiers, not passwords.
    verifyCaptcha_(p);
    if (!lock.tryLock(5000)) throw new Error('BUSY');
    const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('Khách đăng ký');
    if (!sheet) throw new Error('CONFIG');
    const rowCount = Math.max(0, sheet.getLastRow() - 1);
    const rows = rowCount ? sheet.getRange(2, 1, rowCount, 6).getValues() : [];
    const existing = rows.findIndex(row => String(row[0]) === lead.id);
    let rowIndex;
    if (existing >= 0) {
      const stored = rows[existing];
      if (String(stored[2]).replace(/^'/, '') !== lead.name ||
          normalizePhone_(stored[3]) !== normalizePhone_(lead.phone) || stored[4] !== lead.plan)
        throw new Error('INVALID');
      rowIndex = existing + 2;
    } else {
      enforceLimits_(rows, normalizePhone_(lead.phone), Date.now());
      sheet.appendRow([lead.id, new Date(), safeCell_(lead.name), "'" + lead.phone, lead.plan, 'Chờ gửi']);
      rowIndex = sheet.getLastRow();
      SpreadsheetApp.flush();
    }
    // At most one automatic mail attempt per saved request. Preserve the lead
    // even if email is unavailable; do not cause retries to create duplicate mail.
    if (sheet.getRange(rowIndex, 6).getValue() === 'Chờ gửi') {
      if (MailApp.getRemainingDailyQuota() > 0) {
        sheet.getRange(rowIndex, 6).setValue('Đang gửi — không gửi lại tự động');
        SpreadsheetApp.flush();
        try {
          MailApp.sendEmail({to: notifyEmail, subject: '[Web Hỏa Tốc] Khách đăng ký mới',
            body: 'Tên: ' + lead.name + '\nĐiện thoại: ' + lead.phone + '\nGói: ' + lead.plan +
              '\nMã: ' + lead.id + '\n\nXem Sheet: https://docs.google.com/spreadsheets/d/' + sheetId + '/edit'});
          sheet.getRange(rowIndex, 6).setValue('Đã gửi');
        } catch (_) {
          sheet.getRange(rowIndex, 6).setValue('Cần kiểm tra email — không gửi lại tự động');
        }
      } else sheet.getRange(rowIndex, 6).setValue('Hết hạn mức email — khách đã được lưu');
    }
    ok = true;
    code = 'SAVED';
  } catch (error) {
    const allowed = ['INVALID', 'CAPTCHA', 'RATE_LIMIT', 'BUSY', 'CONFIG'];
    code = allowed.includes(error.message) ? error.message : 'UNAVAILABLE';
    console.error('Lead rejected: ' + code); // No token, secret or customer data in logs.
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
  const payload = JSON.stringify({type: 'laylien-lead-result', requestId: id, ok: ok, code: code})
    .replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput('<script>window.top.postMessage(' + payload + ', "*");</script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
