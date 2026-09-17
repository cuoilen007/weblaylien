const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/Code.gs', 'utf8');
let rows, captcha, secret, hosts, mails, quota;
const sheet = {
  getLastRow: () => rows.length + 1,
  getRange: (start, column, count) => ({
    getValues: () => rows.slice(start - 2, start - 2 + count),
    getValue: () => rows[start - 2][column - 1],
    setValue: value => { rows[start - 2][column - 1] = value; }
  }),
  appendRow: row => rows.push(row)
};
const context = vm.createContext({Date, console: {error() {}},
  LockService: {getScriptLock: () => ({tryLock: () => true, hasLock: () => true, releaseLock() {}})},
  PropertiesService: {getScriptProperties: () => ({getProperty: key =>
    ({TURNSTILE_SECRET_KEY:secret,TURNSTILE_HOSTNAMES:hosts,SHEET_ID:'mock-spreadsheet-id-123456789',NOTIFY_EMAIL:'owner@example.com'})[key]})},
  UrlFetchApp: {fetch: () => ({getResponseCode: () => 200, getContentText: () => JSON.stringify(captcha)})},
  SpreadsheetApp: {openById: () => ({getSheetByName: () => sheet}), flush() {}},
  MailApp: {getRemainingDailyQuota: () => quota, sendEmail: () => { mails++; }},
  HtmlService: {XFrameOptionsMode: {ALLOWALL: 1}, createHtmlOutput: html => ({
    setXFrameOptionsMode: () => JSON.parse(html.match(/postMessage\((.*), "\*"/)[1])
  })}
});
vm.runInContext(source, context);
const valid = {requestId: '12345678-1234-4234-8234-123456789000', name: 'Khách thử',
  phone: '0901234567', plan: 'Web 1 trang', 'cf-turnstile-response': 'test-token'};
const post = p => context.doPost({parameter: p, postData: {length: 500}});
function reset() {
  rows = []; mails = 0; quota = 100; secret = 'mock-secret'; hosts = 'webhoatoc.click';
  captcha = {success: true, hostname: 'webhoatoc.click', action: 'lead'};
}
reset();
assert.equal(post({...valid, 'cf-turnstile-response': ''}).code, 'CAPTCHA');
assert.equal(rows.length, 0);
secret = ''; assert.equal(post(valid).code, 'CONFIG');
reset(); captcha.success = false;
assert.equal(post(valid).code, 'CAPTCHA'); assert.equal(mails, 0);
reset(); captcha.hostname = 'attacker.example';
assert.equal(post(valid).code, 'CAPTCHA');
reset(); captcha.action = 'other'; assert.equal(post(valid).code, 'CAPTCHA');
reset(); assert.equal(post({...valid, website: 'bot'}).code, 'INVALID');
assert.equal(post({...valid, phone: '12345678'}).code, 'INVALID');
assert.equal(post({...valid, name: 'Name\nInjected'}).code, 'INVALID');
assert.equal(rows.length, 0);
reset(); assert.equal(post(valid).ok, true); assert.equal(rows.length, 1); assert.equal(mails, 1);
assert.equal(post(valid).ok, true); assert.equal(rows.length, 1); assert.equal(mails, 1);
assert.equal(post({...valid, name: 'Tampered'}).code, 'INVALID');
assert.equal(post({...valid, requestId: valid.requestId + 'x'}).code, 'RATE_LIMIT');
assert.equal(rows.length, 1);
reset(); quota = 0; assert.equal(post(valid).ok, true);
assert.equal(rows.length, 1); assert.equal(mails, 0); assert.match(rows[0][5], /Hết hạn mức/);
const now = Date.now();
for (const name of ['Nguyễn Minh Anh','Đỗ Thị Mỹ','Nguyễn'.normalize('NFD'),'Anna Maria'])
  assert.ok(context.validateLead_({...valid,name}));
for (const name of ['Nguyễn 123','Tên@','Anh-Bình','O\'Brien','😃','Tên\nKhách'])
  assert.throws(()=>context.validateLead_({...valid,name}),/INVALID/);
for (const phone of ['0901234567','0351234567','0581234567','0791234567','0881234567',
  '+84 901 234 567','84901234567','02412345678','02812345678','+84 24 1234 5678'])
  assert.ok(context.validateLead_({...valid,phone}));
for (const phone of ['0123456789','0612345678','1234567890','090123456','09012345678',
  '+1 9012345678','09+01234567','090abc1234567','0241234567'])
  assert.throws(()=>context.validateLead_({...valid,phone}),/INVALID/);
assert.throws(() => context.enforceLimits_(Array.from({length: 20}, (_, i) =>
  ['id' + i, new Date(now - 1000), '', '0912345678']), '0901234567', now), /RATE_LIMIT/);
assert.throws(() => context.enforceLimits_(Array.from({length: 60}, (_, i) =>
  ['id' + i, new Date(now - 7200000), '', '0912345678']), '0901234567', now), /RATE_LIMIT/);
assert.throws(() => context.enforceLimits_([
  ['id1', new Date(now - 7200000), '', '+84901234567'],
  ['id2', new Date(now - 3600000), '', '0901234567']
], '0901234567', now), /RATE_LIMIT/);
assert.equal(context.normalizePhone_('+84 901 234 567'), '0901234567');
assert.equal(context.safeCell_('=IMPORTXML("evil")'), "'=IMPORTXML(\"evil\")");
console.log('PASS: CAPTCHA/config/hostname/action, validation, deduplication, limits, email quota, formula escaping');
