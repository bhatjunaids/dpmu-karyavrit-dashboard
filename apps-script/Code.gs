/**
 * DPMU karyavrit register: backend for the GitHub Pages dashboard.
 *
 * The Google Sheet this script is bound to holds one row per district per month.
 * You fill Month, District and the karyavrit's Drive link; this script has Claude
 * read each new karyavrit and writes the tracker fields and scores into the same row.
 *
 * Two ways karyavrits get read:
 *   - Daily Claude task (no key): a scheduled task in Claude reads new links and drops a
 *     JSON result per karyavrit into the _inbox folder next to this Sheet; this script
 *     imports them every hour (and when someone presses Refresh on the dashboard).
 *   - Claude API (optional): set ANTHROPIC_API_KEY in Project Settings > Script properties
 *     and new links are read directly within the hour. CLAUDE_MODEL is optional
 *     (default claude-sonnet-5-5).
 */

const TAB = 'Karyavrit';
const PTAB = 'Priorities';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const TIME_BUDGET_MS = 4.5 * 60 * 1000; // stay under Apps Script's 6-minute limit

const DIST = [["Agra","Agra"],["Aligarh","Aligarh"],["Ambedkar Nagar","Ayodhya"],["Amethi","Ayodhya"],["Amroha","Moradabad"],["Auraiya","Kanpur"],["Azamgarh","Azamgarh"],["Baghpat","Meerut"],["Bahraich","Devipatan"],["Ballia","Azamgarh"],["Balrampur","Devipatan"],["Banda","Chitrakoot"],["Barabanki","Ayodhya"],["Bareilly","Bareilly"],["Basti","Basti"],["Bhadohi","Mirzapur"],["Bijnor","Moradabad"],["Budaun","Bareilly"],["Bulandshahr","Meerut"],["Chandauli","Varanasi"],["Chitrakoot","Chitrakoot"],["Deoria","Gorakhpur"],["Etah","Aligarh"],["Etawah","Kanpur"],["Faizabad","Ayodhya"],["Farrukhabad","Kanpur"],["Fatehpur","Prayagraj"],["Firozabad","Agra"],["Gautam Buddha Nagar","Meerut"],["Ghaziabad","Meerut"],["Ghazipur","Varanasi"],["Gonda","Devipatan"],["Gorakhpur","Gorakhpur"],["Hamirpur","Chitrakoot"],["Hapur","Meerut"],["Hardoi","Lucknow"],["Hathras","Aligarh"],["Jalaun","Jhansi"],["Jaunpur","Varanasi"],["Jhansi","Jhansi"],["Kannauj","Kanpur"],["Kanpur Dehat","Kanpur"],["Kanpur Nagar","Kanpur"],["Kanshiram Nagar","Aligarh"],["Kaushambi","Prayagraj"],["Kheri","Lucknow"],["Kushinagar","Gorakhpur"],["Lalitpur","Jhansi"],["Lucknow","Lucknow"],["Maharajganj","Gorakhpur"],["Mahoba","Chitrakoot"],["Mainpuri","Agra"],["Mathura","Agra"],["Mau","Azamgarh"],["Meerut","Meerut"],["Mirzapur","Mirzapur"],["Moradabad","Moradabad"],["Muzaffarnagar","Saharanpur"],["Pilibhit","Bareilly"],["Pratapgarh","Prayagraj"],["Prayagraj","Prayagraj"],["Rae Bareli","Lucknow"],["Rampur","Moradabad"],["Saharanpur","Saharanpur"],["Sambhal","Moradabad"],["Sant Kabir Nagar","Basti"],["Shahjahanpur","Bareilly"],["Shamli","Saharanpur"],["Shrawasti","Devipatan"],["Siddharthnagar","Basti"],["Sitapur","Lucknow"],["Sonbhadra","Mirzapur"],["Sultanpur","Ayodhya"],["Unnao","Lucknow"],["Varanasi","Varanasi"]];
const MANDAL = Object.fromEntries(DIST);
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const YPN = ["Yes","Partial","No","Not recorded"], YN = ["Yes","No","Not recorded"];
const THEMES = ["Mentoring / supportive supervision","Classroom practices","Learning outcomes / assessment","Academic material / Kitab Vitran","Balvatika / ECCE","Teacher or student attendance","Training","Finance / Prabandh","Data / portals (NBMC, Prerna)","Vacancies / hiring","Sankul or block meetings","Other"];

/* Tracker columns F..BF. [code, label, options | 'num' | 'date' | 'text', AI instruction or null for PM-filled] */
const FIELDS = [
["F","Meeting held?",["Yes","No","Not recorded"],"Yes / No / Not recorded"],
["G","Meeting date","date","YYYY-MM-DD, empty if not stated"],
["H","Chaired by",["BSA","BEO","Nominee of chair","Other","Not recorded"],"BSA / BEO / Nominee of chair / Other / Not recorded"],
["I","Members expected (no.)","num","number of DPMU members if the MoM lists them (BSA + DCT + DCN + all SRGs), else null"],
["J","Members present (no.)","num","number of members recorded as present (exclude invitees), else null"],
["K","All SRGs present?",YPN,"Yes / Partial / No / Not recorded"],
["L","DCT and DCN present?",YPN,"Yes (both) / Partial (one) / No / Not recorded"],
["M","Attendance remarks (who was absent)","text","who was absent, one short sentence, else empty"],
["N","Agenda circulated before meeting?",YPN,"Yes / Partial / No / Not recorded"],
["O","Presentation / data report used?",YPN,"Yes / Partial / No / Not recorded"],
["P","Data pack shared before meeting?",YPN,"Yes / Partial / No / Not recorded"],
["Q","Action plan (5W-1H) created?",YPN,"Yes if a table with problem, cause, action, responsible person and deadline; Partial if incomplete; else No"],
["R","1. Previous decisions reviewed",YPN,"previous decisions reviewed (पिछली बैठक की प्रगति)"],
["S","2. Financial progress",YPN,"financial progress (वित्तीय प्रगति, Prabandh/PFMS/PM SHRI)"],
["T","3. Academic indicators (NBMC)",YPN,"academic indicators from NBMC (calendar, classroom transaction, Balvatika material, TLM, workbook, Talika, NIPUN Plus, attendance)"],
["U","4. Learning outcomes / SPOT data",YPN,"learning outcomes / SPOT data, saksham-madhyam-pragatisheel students (अधिगम परिणाम)"],
["V","5. Special initiatives (Toolkit, Reading, Catch-up)",YPN,"special initiatives: 10-Point Toolkit, Reading Campaign, catch-up competencies, IEC"],
["W","6. Review meetings (DTF, BSA–BEO, BEO–HM, Sankul)",YPN,"review meetings: DTF, BSA–BEO, BEO–HM, Sankul, DCF upload, SPO compliance"],
["X","7. Supportive supervision & visits",YPN,"supportive supervision and inspections, valid visits, zero-visit schools"],
["Y","8. RCA, best practice, district plan",YPN,"root-cause analysis, best practice, district action plan"],
["Z","NIPUN / learning data with block or school numbers?",YPN,"NIPUN / learning data discussed with specific block- or school-wise numbers?"],
["AA","Weak competencies / focus blocks named?",YPN,"weak competencies or focus blocks/schools named?"],
["AB","SRGs presented analysis?",YPN,"SRGs presented the analysis or field evidence?"],
["AC","Monthly priorities / key messages delivered?",YPN,"monthly priorities / key messages delivered? (priorities given below; Yes if most were delivered, Partial if some)"],
["AD","Bottom performers called out with follow-up?",YPN,"bottom performers (blocks, BEOs, ARPs, schools) called out by name with a follow-up?"],
["AE","Top performers appreciated?",YPN,"top performers appreciated by name?"],
["AF","Challenges discussed and solutions agreed?",YPN,"challenges discussed and solutions agreed?"],
["AG","Root cause identified (not just symptom)?",YPN,"root cause identified that is different from the symptom?"],
["AH","No. of actions / decisions","num","number of actions/decisions recorded"],
["AI","No. of actions with owner + deadline","num","number of those actions that have BOTH a responsible person and a deadline"],
["AJ","Previous month's actions closed (%)","num","previous month's actions closed, as a number 0-100 (only if the MoM states status of earlier decisions), else null"],
["AK","Escalation to DM/CDO/State?",YN,"Yes / No / Not recorded"],
["AL","Performers named (bottom / top)","text","who was called out and who was appreciated, one short sentence, else empty"],
["AM","Good practice noted","text","good practice noted, one short English sentence, else empty"],
["AN","Key decisions (short summary)","text","up to three key decisions, one short English sentence each, separated by semicolons"],
["AO","Theme 1",THEMES,"main issue discussed, exactly one of the theme list"],
["AP","Theme 2",THEMES,"second issue from the theme list, else empty"],
["AQ","Theme 3",THEMES,"third issue from the theme list, else empty"],
["AR","Filled by","text",null],
["AS","AI confidence",["High","Medium","Low"],"High (clear typed MoM, most fields found) / Medium / Low (poor scan, many fields missing)"],
["AT","AI notes: unclear / not recorded","text","what was unclear or not recorded, one sentence"],
["AU","PM presence in meeting",["In person","Phone call","Not attended"],null],
["AV","Pre-alignment with chair done?",["Yes","No"],null],
["AW","Action plan shared on WhatsApp group?",["Yes","No"],null],
["AX","MoM uploaded on portal?",["Yes","No","Not recorded"],null],
["AY","MoM upload date","date",null],
["AZ","DCN in post?",["Yes","No"],null],
["BA","Reviewer / PM name","text",null],
["BB","VSK / team call done?",["Yes","No"],null],
["BC","Call date","date",null],
["BD","MoM matches call?",["Yes","No","NA"],null],
["BE","PM overall rating (1–5)",["1","2","3","4","5"],null],
["BF","PM overall qualitative remarks","text",null]
];

const BASE = ["Month","District","Mandal","Karyavrit link","Status","Read on","File read"];
const SCORE_HEAD = ["Process /20","Agenda /50","Follow-through /30","Total /100","Band"];
const HEAD = BASE.concat(FIELDS.map(f => f[0] + " · " + f[1]), SCORE_HEAD);

/* ---------------- menu and setup ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Karyavrit')
    .addItem('Set up / repair sheet', 'setup')
    .addItem('Add 75 district rows for a month…', 'promptAddMonth')
    .addItem('Read new karyavrits now', 'syncNow')
    .addItem('Recalculate scores', 'rescoreAll')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB, 0);
  const have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  if (have.join('|') !== HEAD.join('|')) {
    if (sh.getLastRow() > 1 && have.length) throw new Error('The Karyavrit tab already has data with different columns. Rename that tab and run Set up again.');
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  }
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold').setWrap(true).setVerticalAlignment('top');
  sh.getRange(1, 1, 1, 4).setBackground('#fff2cc');                     // you fill these
  sh.getRange(1, 5, 1, HEAD.length - 4 - SCORE_HEAD.length).setBackground('#e8f0fe'); // script fills, editable
  sh.getRange(1, HEAD.length - SCORE_HEAD.length + 1, 1, SCORE_HEAD.length).setBackground('#d9d9d9');
  sh.getRange(1, BASE.length + FIELDS.findIndex(f => f[0] === 'AU') + 1, 1, 12).setBackground('#ffffff');
  // keep months, dates and numbers as plain text so Sheets doesn't reformat them
  sh.getRange(2, 1, sh.getMaxRows() - 1, HEAD.length).setNumberFormat('@');
  const months = monthList_();
  sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(months, true).setAllowInvalid(false).build());
  sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DIST.map(d => d[0]), true).setAllowInvalid(false).build());
  FIELDS.forEach((f, i) => {
    if (Array.isArray(f[2])) sh.getRange(2, BASE.length + i + 1, sh.getMaxRows() - 1, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(f[2], true).setAllowInvalid(true).build());
  });
  let p = ss.getSheetByName(PTAB);
  if (!p) {
    p = ss.insertSheet(PTAB);
    p.getRange(1, 1, 1, 3).setValues([["Month", "Priority area", "Key message districts should deliver"]]).setFontWeight('bold');
    p.getRange(2, 1, 999, 1).setNumberFormat('@');
  }
  folders_(); // creates _inbox and _processed next to this Sheet
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'syncJob')) {
    ScriptApp.newTrigger('syncJob').timeBased().everyHours(1).create();
  }
  SpreadsheetApp.getActive().toast('Sheet is ready. Use Karyavrit > Add 75 district rows for a month to start.', 'Karyavrit', 8);
}

function monthList_() {
  const out = []; for (let y = 2026; y <= 2030; y++) for (let m = 0; m < 12; m++) if (y > 2026 || m >= 3) out.push(MON[m] + '-' + y);
  return out;
}

function promptAddMonth() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Add a month', 'Month, written like Dec-2026:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const m = r.getResponseText().trim();
  if (monthList_().indexOf(m) < 0) { ui.alert('Write the month like Dec-2026.'); return; }
  ui.alert(addMonth(m) + ' rows added for ' + m + '.');
}

function addMonth(month) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  const rows = readRows_(sh);
  const have = new Set(rows.filter(r => r.month === month).map(r => r.district));
  const add = DIST.filter(d => !have.has(d[0])).map(d => {
    const row = new Array(HEAD.length).fill(''); row[0] = month; row[1] = d[0]; row[2] = d[1]; return row;
  });
  if (add.length) {
    const start = sh.getLastRow() + 1;
    const rng = sh.getRange(start, 1, add.length, HEAD.length);
    rng.setNumberFormat('@'); rng.setValues(add);
  }
  return add.length;
}

/* ---------------- web app ---------------- */

function doGet(e) {
  try { return json_(listAll_()); }
  catch (err) { return json_({ error: String(err && err.message || err) }); }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData && e.postData.contents || '{}'); } catch (x) {}
  try {
    if (body.action === 'sync') { const r = sync_(); return json_(Object.assign(listAll_(), { sync: r })); }
    return json_(listAll_());
  } catch (err) { return json_({ error: String(err && err.message || err) }); }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function listAll_() {
  const ss = SpreadsheetApp.getActive();
  const rows = readRows_(ss.getSheetByName(TAB)).filter(r => r.month && r.district);
  const pr = {};
  const p = ss.getSheetByName(PTAB);
  if (p && p.getLastRow() > 1) p.getRange(2, 1, p.getLastRow() - 1, 3).getDisplayValues().forEach(v => {
    const m = normMonth_(v[0]); if (m && (v[1] || v[2])) (pr[m] = pr[m] || []).push([v[1], v[2]].filter(String).join(': '));
  });
  return {
    records: rows.map(r => ({ month: r.month, district: r.district, link: r.link, status: r.status, readOn: r.readOn, f: r.f })),
    priorities: pr, updated: new Date().toISOString()
  };
}

/* ---------------- reading rows ---------------- */

function readRows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rng = sh.getRange(2, 1, n, HEAD.length);
  const vals = rng.getDisplayValues();
  const rich = sh.getRange(2, 4, n, 1).getRichTextValues();
  const forms = sh.getRange(2, 4, n, 1).getFormulas();
  return vals.map((v, i) => {
    const f = {};
    FIELDS.forEach((fd, j) => f[fd[0]] = String(v[BASE.length + j] || '').trim());
    let link = (rich[i][0] && rich[i][0].getLinkUrl()) || '';
    if (!link) { const m = String(forms[i][0] || '').match(/HYPERLINK\(\s*"([^"]+)"/i); if (m) link = m[1]; }
    if (!link) link = String(v[3] || '').trim();
    return { row: i + 2, month: normMonth_(v[0]), district: String(v[1] || '').trim(), link: link, status: v[4], readOn: v[5], fileRead: v[6], f: f };
  });
}

function normMonth_(s) {
  s = String(s || '').trim(); if (!s) return '';
  let m = s.match(/^([A-Za-z]{3})[a-z]*[-\s]+(\d{4})$/);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase() + '-' + m[2];
  const d = new Date(s); if (!isNaN(d)) return MON[d.getMonth()] + '-' + d.getFullYear();
  return s;
}

function fileId_(url) {
  url = String(url || '');
  let m = url.match(/\/d\/([A-Za-z0-9_-]{20,})/) || url.match(/[?&]id=([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{25,}$/.test(url)) return url;
  return '';
}

/* ---------------- reading karyavrits with Claude ---------------- */

function syncJob() { sync_(); }
function syncNow() {
  const r = sync_();
  SpreadsheetApp.getActive().toast(r.read + ' read, ' + r.errors + ' errors, ' + r.waiting + ' still waiting' +
    (r.mode === 'daily' ? ' for the daily Claude task.' : '.'), 'Karyavrit', 8);
}

const needsRead_ = r => r.month && r.district && fileId_(r.link) &&
  (!r.status || /^re-?read$/i.test(r.status) || (r.status === 'Read' && r.fileRead !== fileId_(r.link)));

function sync_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { read: 0, errors: 0, waiting: -1, busy: true };
  const t0 = Date.now(); let read = 0, errors = 0;
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
    // 1. results left in Drive by the daily Claude task (no API key needed)
    const imp = importInbox_(sh);
    read += imp.imported; errors += imp.bad;
    const todo = readRows_(sh).filter(needsRead_);
    // 2. direct reading through the Claude API, only if a key is set
    if (!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')) {
      return { read: read, errors: errors, waiting: todo.length, mode: 'daily' };
    }
    const prios = listAll_().priorities;
    for (const r of todo) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      const id = fileId_(r.link);
      try {
        const res = readOne_(id, r.district, r.month, (prios[r.month] || []).join('\n'));
        applyResult_(sh, r, res, res, id);
        read++;
      } catch (err) {
        sh.getRange(r.row, 5, 1, 3).setValues([['Error: ' + String(err && err.message || err).slice(0, 200), stamp_(), id]]);
        errors++;
      }
    }
    return { read: read, errors: errors, waiting: Math.max(0, todo.length - read - errors), mode: 'api' };
  } finally { lock.releaseLock(); }
}

/** Writes one reading (fields object + detected district/month) into row r. */
function applyResult_(sh, r, fields, meta, id) {
  const out = Object.assign({}, r.f);
  FIELDS.forEach(fd => { if (fd[3]) out[fd[0]] = clean_(fd, fields[fd[0]]); });
  out.AR = 'AI from MoM';
  const warn = [];
  const dd = String(meta.detected_district || '');
  if (dd && dd.toLowerCase().indexOf(r.district.toLowerCase().split(' ')[0]) < 0 && !(r.district === 'Kheri' && /kheri|lakhimpur/i.test(dd))) warn.push('MoM looks like ' + dd);
  const dm = String(meta.detected_month || '');
  if (dm && dm !== r.month) warn.push('meeting date reads as ' + dm);
  if (warn.length) out.AT = ('Check: ' + warn.join('; ') + '. ' + (out.AT || '')).slice(0, 500);
  writeRow_(sh, r.row, out, 'Read', id);
}

/* ---------------- inbox: results written to Drive by the daily Claude task ---------------- */

const INBOX = '_inbox', DONE = '_processed';

function folders_() {
  const parent = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents().next();
  const get = n => { const it = parent.getFoldersByName(n); return it.hasNext() ? it.next() : parent.createFolder(n); };
  return { inbox: get(INBOX), done: get(DONE) };
}

/** Each inbox file is JSON: {month, district, fileId, detected_district, detected_month, fields:{F:..,G:..,...}} */
function importInbox_(sh) {
  const fo = folders_(); let imported = 0, bad = 0;
  const it = fo.inbox.getFiles();
  while (it.hasNext()) {
    const file = it.next();
    try {
      const j = JSON.parse(file.getBlob().getDataAsString());
      const month = normMonth_(j.month), d = String(j.district || '').trim();
      if (!month || !MANDAL[d] || !j.fields) throw new Error('missing month, district or fields');
      let r = readRows_(sh).filter(x => x.month === month && x.district === d).pop();
      if (!r) {
        const row = new Array(HEAD.length).fill(''); row[0] = month; row[1] = d; row[2] = MANDAL[d];
        row[3] = j.fileId ? 'https://drive.google.com/file/d/' + j.fileId + '/view' : '';
        const rng = sh.getRange(sh.getLastRow() + 1, 1, 1, HEAD.length); rng.setNumberFormat('@'); rng.setValues([row]);
        r = readRows_(sh).filter(x => x.month === month && x.district === d).pop();
      }
      applyResult_(sh, r, j.fields, j, String(j.fileId || fileId_(r.link)));
      file.moveTo(fo.done); imported++;
    } catch (err) {
      file.setName('ERROR ' + file.getName()); file.moveTo(fo.done); bad++;
    }
  }
  return { imported: imported, bad: bad };
}

function stamp_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'); }

function writeRow_(sh, row, f, status, fileId) {
  const s = score(f);
  const vals = [status, stamp_(), fileId].concat(FIELDS.map(fd => f[fd[0]] == null ? '' : String(f[fd[0]])),
    [s.p, s.a, s.ft, s.t].map(x => x == null ? '' : String(x)), [s.band]);
  const rng = sh.getRange(row, 5, 1, vals.length);
  rng.setNumberFormat('@'); rng.setValues([vals]);
}

function clean_(fd, v) {
  if (Array.isArray(fd[2])) { v = String(v == null ? '' : v); return fd[2].indexOf(v) >= 0 ? v : (fd[2].indexOf('Not recorded') >= 0 ? 'Not recorded' : (fd[0] === 'AS' ? 'Low' : '')); }
  if (fd[2] === 'num') { const n = Number(v); return v === null || v === '' || isNaN(n) ? '' : String(n); }
  if (fd[2] === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  return String(v == null ? '' : v).replace(/\s+/g, ' ').slice(0, 600);
}

function readOne_(fileId, district, month, prio) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Script properties');
  const model = PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL') || DEFAULT_MODEL;
  const file = DriveApp.getFileById(fileId);
  const mime = file.getMimeType();
  let block;
  if (mime === MimeType.GOOGLE_DOCS) block = docBlock_(file.getAs(MimeType.PDF));
  else if (mime === MimeType.PDF) block = docBlock_(file.getBlob());
  else if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) block = { type: 'image', source: { type: 'base64', media_type: mime, data: Utilities.base64Encode(file.getBlob().getBytes()) } };
  else throw new Error('Save the karyavrit as PDF or an image (this file is ' + mime + ')');
  const body = {
    model: model, max_tokens: 4096,
    messages: [{ role: 'user', content: [block, { type: 'text', text: prompt_(district, month, prio) }] }]
  };
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(body)
  });
  const code = res.getResponseCode();
  let j; try { j = JSON.parse(res.getContentText()); } catch (x) { throw new Error('Claude API reply was not JSON (HTTP ' + code + ')'); }
  if (code !== 200) throw new Error('Claude API: ' + (j.error && j.error.message || ('HTTP ' + code)));
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const out = parseJson_(text);
  if (!out) throw new Error('Claude reply could not be read as JSON');
  return out;
}

function docBlock_(blob) {
  if (blob.getBytes().length > 30 * 1024 * 1024) throw new Error('PDF is over 30 MB');
  return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Utilities.base64Encode(blob.getBytes()) } };
}

function parseJson_(t) {
  t = String(t || '').trim();
  try { return JSON.parse(t); } catch (x) {}
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) try { return JSON.parse(m[1]); } catch (x) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch (x) {}
  return null;
}

function prompt_(district, month, prio) {
  const lines = FIELDS.filter(f => f[3]).map(f => '"' + f[0] + '": ' +
    (Array.isArray(f[2]) ? 'one of ' + f[2].map(x => '"' + x + '"').join(' | ') + ' — ' : f[2] === 'num' ? 'number or null — ' : 'string — ') + f[3]).join('\n');
  return 'You are reviewing the minutes (karyavrit / MoM) of a District Project Management Unit (DPMU) meeting under NIPUN Bharat Mission, Uttar Pradesh. The attached file is one MoM, probably in Hindi. The sheet says it is from district ' + district + ', month ' + month + '.\n\n' +
    'RULES\n- Use only what is written in the MoM. Do not guess. If something is not mentioned, use "Not recorded" for choice fields and null or "" for number, date and text fields.\n' +
    '- Yes = clearly discussed with specifics (data, names, numbers or decisions). Partial = mentioned briefly without specifics or decisions. No = the MoM covers the meeting but this item is absent.\n' +
    '- Text fields in short plain English.\n\n' +
    'THEME LIST: ' + THEMES.join(' | ') + '\n\n' +
    'MONTHLY PRIORITIES for field AC: ' + (prio ? '\n' + prio : 'none were provided; judge whether the chair delivered clear monthly key messages on FLN priorities.') + '\n\n' +
    'Reply with ONLY one JSON object with exactly these keys:\n' +
    '"detected_district": district named in the MoM letterhead or text, in English\n' +
    '"detected_month": the meeting date\'s month as Mon-YYYY, e.g. Aug-2026, or ""\n' + lines;
}

/* ---------------- scoring: Tracker!BM:BQ with the Scoring sheet's weights ---------------- */

const W = {fw:4,ch:4,att:3,N:2,AV:2,O:2,P:1,up:2,R:5,S:4,T:6,U:5,Z:5,V:5,W:4,X:6,AB:5,AC:5,Y:2,AG:4,AA:4,AD:3,AE:2,AF:2,Q:3,own:3,cl:4,AW:1,AK:1,AM:1};
const TH = {fn:75,dv:50,a1:.8,a2:.6,c1:.6,c2:.4};

function score(f) {
  const yp = v => v === 'Yes' ? 1 : v === 'Partial' ? .5 : 0;
  const num = v => v === '' || v == null || isNaN(+v) ? null : +v;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(f.G || '') ? +f.G.slice(8) : null;
  if (!f.F || f.F === 'Not recorded') return { band: 'Pending' };
  if (f.F !== 'Yes') return { p: 0, a: 0, ft: 0, t: 0, band: 'Not held' };
  const I = num(f.I), J = num(f.J), att = I && J != null ? J / I : null;
  const bk = netdays_(f.G, f.AY);
  const AH = num(f.AH), AI = num(f.AI), bl = AH && AI != null ? AI / AH : null;
  let p = day == null ? 0 : day <= 7 ? W.fw : day <= 15 ? W.fw / 2 : 0;
  p += f.H === 'BSA' ? W.ch : f.H === 'Nominee of chair' ? W.ch / 2 : 0;
  p += att == null ? 0 : att >= TH.a1 ? W.att : att >= TH.a2 ? W.att / 2 : 0;
  p += W.N * yp(f.N) + (f.AV === 'Yes' ? W.AV : 0) + W.O * yp(f.O) + W.P * yp(f.P);
  p += bk == null ? 0 : bk <= 3 ? W.up : bk <= 7 ? W.up / 2 : 0;
  let a = 0; ['R','S','T','U','Z','V','W','X','AB','AC'].forEach(k => a += W[k] * yp(f[k]));
  let t = 0; ['Y','AG','AA','AD','AE','AF','Q'].forEach(k => t += W[k] * yp(f[k]));
  t += bl == null ? 0 : bl >= .9 ? W.own : bl >= .5 ? W.own / 2 : 0;
  const aj = num(f.AJ); t += aj == null ? 0 : aj / 100 >= TH.c1 ? W.cl : aj / 100 >= TH.c2 ? W.cl / 2 : 0;
  t += (f.AW === 'Yes' ? W.AW : 0) + (f.AK === 'Yes' ? W.AK : 0) + (String(f.AM || '').trim() ? W.AM : 0);
  const tot = p + a + t;
  return { p: p, a: a, ft: t, t: tot, band: tot >= TH.fn ? 'Functional' : tot >= TH.dv ? 'Developing' : 'Needs support' };
}

function netdays_(a, b) {
  const re = /^\d{4}-\d{2}-\d{2}$/; if (!re.test(a || '') || !re.test(b || '')) return null;
  let d1 = new Date(a + 'T00:00:00Z'), d2 = new Date(b + 'T00:00:00Z'), s = 1;
  if (d2 < d1) { const x = d1; d1 = d2; d2 = x; s = -1; }
  let n = 0; for (let d = new Date(d1); d <= d2; d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w && w < 6) n++; }
  return s * n - 1;
}

/** Re-scores every row from its fields: run after editing fields by hand in the sheet. */
function rescoreAll() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
  const rows = readRows_(sh); if (!rows.length) return;
  const out = rows.map(r => { const s = score(r.f); return [s.p, s.a, s.ft, s.t].map(x => x == null ? '' : String(x)).concat([s.band]); });
  const rng = sh.getRange(2, HEAD.length - SCORE_HEAD.length + 1, out.length, SCORE_HEAD.length);
  rng.setNumberFormat('@'); rng.setValues(out);
}
