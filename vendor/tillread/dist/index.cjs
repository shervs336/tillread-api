"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  decode: () => decode,
  detect: () => detect,
  detectDateFormat: () => detectDateFormat,
  detectDecimal: () => detectDecimal,
  detectDelimiter: () => detectDelimiter,
  formatMinor: () => formatMinor,
  parse: () => parse,
  parseAmount: () => parseAmount,
  parseDate: () => parseDate,
  stringify: () => stringify,
  toCSV: () => toCSV,
  tokenize: () => tokenize
});
module.exports = __toCommonJS(index_exports);

// src/amount.ts
var NOISE = /[\p{Sc}\s   ']|\b[A-Z]{3}\b/gu;
var PLAIN = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/;
var MINUS = /[−‒–]/g;
function parseAmount(raw, decimal = ".", minorUnits = 2) {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s) return null;
  if (decimal === "." && minorUnits === 2) {
    const f = PLAIN.exec(s);
    if (f) {
      const n2 = Number(f[2]) * 100 + (f[3] ? Number(f[3].padEnd(2, "0")) : 0);
      return f[1] && n2 !== 0 ? -n2 : n2;
    }
  }
  s = s.replace(MINUS, "-");
  let negative = false;
  const suffix = s.match(/\s*(cr|dr)\.?$/i);
  if (suffix) {
    negative = suffix[1].toLowerCase() === "dr";
    s = s.slice(0, suffix.index);
  }
  s = s.replace(NOISE, "");
  if (/^\(.*\)$/.test(s)) {
    negative = !negative;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(NOISE, "");
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const m = s.match(/^(\d*)(?:\.(\d+))?$/);
  if (!m || !m[1] && !m[2]) return null;
  const digits = (m[1] || "0") + (m[2] ?? "").slice(0, minorUnits).padEnd(minorUnits, "0");
  if (digits.replace(/^0+/, "").length > 15) return null;
  let n = Number(digits);
  const frac = m[2] ?? "";
  if (frac.length > minorUnits && frac.charCodeAt(minorUnits) >= 53) n += 1;
  return negative && n !== 0 ? -n : n;
}
function detectDecimal(values) {
  let comma = 0;
  let dot = 0;
  for (const v of values) {
    const s = v.replace(NOISE, "").replace(/[()+-]|CR|DR/gi, "");
    if (/,\d{1,2}$/.test(s) || /\.\d{3},\d+$/.test(s)) comma++;
    else if (/\.\d{1,2}$/.test(s) || /,\d{3}\.\d+$/.test(s)) dot++;
  }
  return comma > dot ? { decimal: ",", votes: comma - dot } : { decimal: ".", votes: dot - comma };
}
function formatMinor(amount, minorUnits = 2) {
  const sign = amount < 0 ? "-" : "";
  const digits = String(Math.abs(amount)).padStart(minorUnits + 1, "0");
  return minorUnits === 0 ? sign + digits : `${sign}${digits.slice(0, -minorUnits)}.${digits.slice(-minorUnits)}`;
}

// src/date.ts
var MONTHS = {
  jan: 1,
  ene: 1,
  janv: 1,
  feb: 2,
  fev: 2,
  fevr: 2,
  mar: 3,
  mrz: 3,
  mrt: 3,
  maa: 3,
  mars: 3,
  apr: 4,
  avr: 4,
  abr: 4,
  may: 5,
  mai: 5,
  mei: 5,
  jun: 6,
  juin: 6,
  jul: 7,
  juil: 7,
  aug: 8,
  ago: 8,
  aou: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  okt: 10,
  nov: 11,
  dec: 12,
  dez: 12,
  dic: 12
};
var monthOf = (word) => {
  const w = word.normalize("NFD").replace(/[̀-ͯ.]/g, "").toLowerCase();
  if (w.length < 3) return void 0;
  return MONTHS[w.slice(0, 4)] ?? MONTHS[w.slice(0, 3)];
};
var fullYear = (y, digits) => digits === 2 ? y < 70 ? 2e3 + y : 1900 + y : y;
var iso = (y, m, d) => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
var YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/;
var COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
var NUMERIC = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:$|[T\s,])/;
var DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th)?[\s.-]+([\p{L}.]{3,})[\s.,-]+(\d{4}|\d{2})(?:$|[T\s,])/u;
var MONTH_DAY = /^([\p{L}.]{3,})[\s.-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s.-]+(\d{4}|\d{2})(?:$|[T\s,])/u;
function dateShape(raw) {
  const s = raw.trim();
  if (YMD.test(s) || COMPACT.test(s)) return "ymd";
  if (NUMERIC.test(s)) return "numeric";
  const a = s.match(DAY_MONTH);
  if (a && monthOf(a[2])) return "named";
  const b = s.match(MONTH_DAY);
  if (b && monthOf(b[1])) return "named";
  return null;
}
function parseDate(raw, format = "YMD") {
  const s = raw?.trim();
  if (!s) return null;
  let m = s.match(YMD) ?? s.match(COMPACT);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(NUMERIC);
  if (m) {
    const y = fullYear(+m[3], m[3].length);
    if (format === "MDY") return iso(y, +m[1], +m[2]);
    if (format === "DMY") return iso(y, +m[2], +m[1]);
    return null;
  }
  m = s.match(DAY_MONTH);
  if (m) {
    const month = monthOf(m[2]);
    if (month) return iso(fullYear(+m[3], m[3].length), month, +m[1]);
  }
  m = s.match(MONTH_DAY);
  if (m) {
    const month = monthOf(m[1]);
    if (month) return iso(fullYear(+m[3], m[3].length), month, +m[2]);
  }
  return null;
}
function detectDateFormat(values, hint = "MDY") {
  let dayFirst = 0;
  let monthFirst = 0;
  let numeric = 0;
  for (const v of values) {
    const m = v.trim().match(NUMERIC);
    if (!m) continue;
    numeric++;
    const a = +m[1];
    const b = +m[2];
    if (a > 12 && a <= 31 && b <= 12) dayFirst++;
    else if (b > 12 && b <= 31 && a <= 12) monthFirst++;
  }
  if (numeric === 0) return { format: "YMD", basis: "unambiguous", certainty: 1 };
  if (dayFirst !== monthFirst) {
    const format = dayFirst > monthFirst ? "DMY" : "MDY";
    const certainty = Math.max(dayFirst, monthFirst) / (dayFirst + monthFirst);
    return { format, basis: "votes", certainty };
  }
  const read = (f) => values.map((v) => parseDate(v, f)).filter((d) => d != null);
  const dmy = read("DMY");
  const mdy = read("MDY");
  const sortedness = (ds) => {
    if (ds.length < 3) return 0;
    let up = 0;
    let down = 0;
    for (let i = 1; i < ds.length; i++) {
      if (ds[i] >= ds[i - 1]) up++;
      if (ds[i] <= ds[i - 1]) down++;
    }
    return Math.max(up, down) / (ds.length - 1);
  };
  const sd = sortedness(dmy);
  const sm = sortedness(mdy);
  if (Math.abs(sd - sm) > 0.05) return { format: sd > sm ? "DMY" : "MDY", basis: "order", certainty: 0.9 };
  const span = (ds) => {
    if (ds.length < 2) return Infinity;
    const sorted = [...ds].sort();
    return Date.parse(sorted[sorted.length - 1]) - Date.parse(sorted[0]);
  };
  const pd = span(dmy);
  const pm = span(mdy);
  if (pd !== pm && Math.max(pd, pm) > 1.5 * Math.min(pd, pm)) {
    const ratio = Math.max(pd, pm) / Math.max(1, Math.min(pd, pm));
    return { format: pd < pm ? "DMY" : "MDY", basis: "span", certainty: ratio > 10 ? 0.9 : 0.7 };
  }
  return { format: hint, basis: "hint", certainty: 0.5 };
}

// src/decode.ts
function decode(input) {
  if (typeof input === "string") return input.charCodeAt(0) === 65279 ? input.slice(1) : input;
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return utf8(bytes.subarray(3));
  if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  if (bytes.length >= 4 && bytes[0] !== 0 && bytes[1] === 0 && bytes[2] !== 0 && bytes[3] === 0) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] !== 0 && bytes[2] === 0 && bytes[3] !== 0) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
var utf8 = (b) => new TextDecoder("utf-8").decode(b);

// src/csv.ts
var DELIMITERS = [",", ";", "	", "|"];
function tokenize(text, delimiter = ",") {
  const rows = [];
  const n = text.length;
  const D = delimiter.charCodeAt(0);
  let cells = [];
  let line = 1;
  let rowLine = 1;
  let i = 0;
  const stop = (k) => {
    while (k < n) {
      const c = text.charCodeAt(k);
      if (c === D || c === 10 || c === 13) break;
      k++;
    }
    return k;
  };
  for (; ; ) {
    let j = i;
    while (j < n && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9 && D !== 9)) j++;
    let end;
    if (j < n && text.charCodeAt(j) === 34) {
      let value = "";
      let from = j + 1;
      let k = from;
      for (; ; ) {
        const q = text.indexOf('"', k);
        if (q === -1) {
          value += text.slice(from);
          k = n;
          break;
        }
        if (text.charCodeAt(q + 1) === 34) {
          value += text.slice(from, q + 1);
          k = from = q + 2;
          continue;
        }
        value += text.slice(from, q);
        k = q + 1;
        break;
      }
      for (let p = 0; p < value.length; p++) {
        const c = value.charCodeAt(p);
        if (c === 10 || c === 13 && value.charCodeAt(p + 1) !== 10) line++;
      }
      cells.push(value);
      end = stop(k);
    } else {
      end = stop(i);
      cells.push(text.slice(i, end).trim());
    }
    if (end < n && text.charCodeAt(end) === D) {
      i = end + 1;
      continue;
    }
    if (cells.some((c) => c !== "")) rows.push({ cells, line: rowLine });
    if (end >= n) break;
    cells = [];
    i = end + 1;
    if (text.charCodeAt(end) === 13 && text.charCodeAt(i) === 10) i++;
    line++;
    rowLine = line;
  }
  return rows;
}
function detectDelimiter(text) {
  const sample = text.slice(0, 16 * 1024);
  let best = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = tokenize(sample, d).slice(0, 60);
    const counts = /* @__PURE__ */ new Map();
    for (const r of rows) if (r.cells.length > 1) counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1);
    let width = 0;
    let n = 0;
    for (const [w, c] of counts) if (c > n || c === n && w > width) [width, n] = [w, c];
    const score = n * 100 + width;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}
function stringify(rows, delimiter = ",") {
  const needs = new RegExp(`["\\r\\n${delimiter === "	" ? "\\t" : escape(delimiter)}]|^\\s|\\s$`);
  return rows.map((r) => r.map((c) => needs.test(c) || c === "" && r.length === 1 ? `"${c.replace(/"/g, '""')}"` : c).join(delimiter)).join("\r\n");
}
var escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// src/detect.ts
var HEADERS = {
  date: [
    /^(transaction |trans\.? |booking |txn )?date$|^datum$|^fecha$|^date (de l')?op(eration|\.)?$|^dateop$|^buchungstag$|^buchungsdatum$/,
    /^(completed|started|posted|posting|booked) date$|^date posted$|^fecha (de )?operaci[oó]n$/,
    /date|datum|fecha|buchung|tag$/
  ],
  amount: [
    /^(amount|betrag|importe|montant|bedrag|value|sum|net amount)( \(\w{3}\))?$/,
    /^amount|amount$|betrag|importe|montant|bedrag/
  ],
  debit: [/^(debit|debits|withdrawals?|money out|paid out|out|spent|charges?|soll|ausgang|cargo|d[eé]bit|uitgaven?|af)( amount)?( \(\w{3}\))?$/, /debit|withdraw|money out|paid out/],
  credit: [/^(credit|credits|deposits?|money in|paid in|in|received|haben|eingang|abono|cr[eé]dit|inkomsten|bij)( amount)?( \(\w{3}\))?$/, /credit|deposit|money in|paid in/],
  direction: [/^(type|direction|cr\/dr|dr\/cr|debit\/credit|credit\/debit|af bij|af\/bij|soll\/haben|d\/c|c\/d|sens)$/, /type|direction/],
  balance: [/^(running )?(balance|bal\.?|saldo|solde|kontostand)|balance$|running bal/],
  currency: [/^(currency|ccy|cur|w[aä]e?hrung|moneda|devise|valuta)$/],
  category: [/^(category|kategorie|categor[ií]a|cat[eé]gorie|categorie)$/, /category/],
  reference: [/^(reference|ref\.?|check( or slip)? ?#?|cheque( number)?|check number|transaction id|id|referenz|r[eé]f[eé]rence|kenmerk)$/, /reference|transaction id/],
  description: [
    /^(description|details|transaction description|payee|merchant|narrative|name|beschreibung|concepto|libell[eé]|label|omschrijving|naam \/ omschrijving|particulars|transaction details|partner name|beguenstigter\/zahlungspflichtiger|empf[aä]nger|payee name)$/,
    /description|payee|merchant|narrative|details|omschrijving|libell|concepto|beschreib|naam|name|memo/
  ],
  memo: [/^(memo|notes?|mededelingen|payment reference|verwendungszweck|comment|remarks|reference text)$/, /memo|note|mededeling/]
};
var DIRECTIONS = {
  dr: true,
  debit: true,
  d: true,
  out: true,
  af: true,
  withdrawal: true,
  soll: true,
  "money out": true,
  debito: true,
  "d\xE9bit": true,
  cr: false,
  credit: false,
  c: false,
  in: false,
  bij: false,
  deposit: false,
  haben: false,
  "money in": false,
  credito: false,
  "cr\xE9dit": false
};
var directionOf = (v) => DIRECTIONS[v.trim().toLowerCase()];
var INCOME_WORDS = /\b(payment|thank you|autopay|refund|salary|payroll|deposit|interest paid|cashback|reversal|return|gehalt|lohn|salaire|virement re[cç]u|nómina)\b/i;
var norm = (h) => h.trim().toLowerCase().replace(/\s+/g, " ");
function columnStats(rows, c, header, decimal) {
  let filled = 0, dates = 0, amounts = 0, len = 0, neg = 0, dir = 0, cur = 0, words = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const r of rows) {
    const v = r.cells[c] ?? "";
    if (!v) continue;
    filled++;
    len += v.length;
    seen.add(v);
    if (dateShape(v)) dates++;
    const a = /\d/.test(v) && !/[a-z]{4,}/i.test(v) ? parseAmount(v, decimal) : null;
    if (a != null && !dateShape(v)) {
      amounts++;
      if (a < 0) neg++;
    }
    if (directionOf(v) !== void 0) dir++;
    if (/^[A-Z]{3}$/.test(v)) cur++;
    if (/[\p{L}]{3,}/u.test(v)) words++;
  }
  const f = filled || 1;
  return {
    header,
    dateRate: dates / f,
    amountRate: amounts / f,
    fill: filled / (rows.length || 1),
    avgLen: len / f,
    distinct: seen.size / f,
    negRate: neg / f,
    directionRate: dir / f,
    currencyRate: cur / f,
    wordRate: words / f
  };
}
function headerScore(field, header) {
  const pats = HEADERS[field];
  for (let i = 0; i < pats.length; i++) if (pats[i].test(header)) return 3 - Math.min(i, 2);
  return 0;
}
function findHeaderRow(rows, width) {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].cells;
    if (cells.length < Math.max(2, width - 2)) continue;
    const isData = cells.some((c) => dateShape(c)) && cells.some((c) => /\d/.test(c) && parseAmount(c, ".") != null && !dateShape(c));
    if (isData) {
      for (let h = i - 1; h >= 0 && h >= i - 3; h--) {
        const hc = rows[h].cells.filter(Boolean);
        if (hc.length >= 2 && hc.every((c) => !dateShape(c) && parseAmount(c, ".") == null)) return h;
      }
      return null;
    }
  }
  for (let i = 0; i < limit; i++) {
    const hs = rows[i].cells.map(norm);
    if (rows[i].cells.length >= width && hs.some((h) => headerScore("date", h) > 0)) return i;
  }
  return null;
}
function detect(input, options = {}) {
  return analyze(decode(input), options).detection;
}
function analyze(text, options = {}) {
  const notes = [];
  const warnings = [];
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows = tokenize(text, delimiter);
  notes.push(`Delimiter: ${delimiter === "	" ? "tab" : `"${delimiter}"`}.`);
  const widths = /* @__PURE__ */ new Map();
  for (const r of rows.slice(0, 200)) widths.set(r.cells.length, (widths.get(r.cells.length) ?? 0) + 1);
  let width = 0;
  let wc = 0;
  for (const [w, c] of widths) if (w > 1 && (c > wc || c === wc && w > width)) [width, wc] = [w, c];
  const headerRow = options.headerRow !== void 0 ? options.headerRow : findHeaderRow(rows, width);
  const dataStart = headerRow == null ? 0 : headerRow + 1;
  const headerCells = headerRow == null ? [] : rows[headerRow].cells;
  const ncols = Math.max(width, headerCells.length);
  const headers = Array.from({ length: ncols }, (_, i) => headerCells[i]?.trim() || `Column ${i + 1}`);
  if (headerRow == null) notes.push("No header row; columns were identified from their contents.");
  else if (headerRow > 0) notes.push(`Skipped ${headerRow} line${headerRow === 1 ? "" : "s"} before the header.`);
  const sample = rows.slice(dataStart, dataStart + 400).filter((r) => r.cells.length >= Math.max(2, width - 2));
  let decimal;
  if (options.decimal) decimal = options.decimal;
  else {
    const values = sample.flatMap((r) => r.cells.filter((c) => /\d/.test(c) && !dateShape(c) && c.length < 24));
    decimal = detectDecimal(values).decimal;
    notes.push(`Decimal separator: "${decimal}".`);
  }
  const stats = headers.map((h, c) => columnStats(sample, c, headerRow == null ? "" : norm(h), decimal));
  const columns = pickColumns(stats, options.columns ?? {}, sample, decimal);
  const dateValues = sample.map((r) => r.cells[columns.date] ?? "");
  let dateFormat;
  let dateCertainty = 1;
  if (options.dateFormat) dateFormat = options.dateFormat;
  else {
    const g = detectDateFormat(dateValues, decimal === "," ? "DMY" : "MDY");
    dateFormat = g.format;
    dateCertainty = g.certainty;
    const label = { YMD: "year first", DMY: "day first", MDY: "month first" }[g.format];
    const why = {
      unambiguous: "",
      votes: " (some days are above 12)",
      order: " (the only reading that keeps rows in date order)",
      span: " (the reading that covers the shorter period)",
      hint: ""
    }[g.basis];
    notes.push(`Dates: ${label}${why}.`);
    if (g.basis === "hint") {
      warnings.push(`Every date could be read day-first or month-first; assumed ${label}. Pass dateFormat to be sure.`);
    }
  }
  const dates = dateValues.map((v) => parseDate(v, dateFormat));
  const amountOf = (r, c) => c == null ? null : parseAmount(r.cells[c], decimal);
  let sign;
  let signCertainty = 1;
  let order = "unknown";
  const balanceCheck = (signed) => {
    if (columns.balance == null) return null;
    const pairs = sample.map((r) => ({ a: signed(r), b: amountOf(r, columns.balance) }));
    let asc = 0;
    let desc = 0;
    let ascInv = 0;
    let descInv = 0;
    let n = 0;
    for (let i = 1; i < pairs.length; i++) {
      const p = pairs[i - 1];
      const q = pairs[i];
      if (p.a == null || q.a == null || p.b == null || q.b == null) continue;
      n++;
      if (q.b - p.b === q.a) asc++;
      if (q.b - p.b === -q.a) ascInv++;
      if (p.b - q.b === p.a) desc++;
      if (p.b - q.b === -p.a) descInv++;
    }
    if (n < 2) return null;
    const best = Math.max(asc, desc, ascInv, descInv);
    if (best / n < 0.6) return null;
    return {
      inverted: best === ascInv || best === descInv ? best > Math.max(asc, desc) : false,
      order: best === asc || best === ascInv ? "ascending" : "descending",
      rate: best / n
    };
  };
  if (options.sign) sign = options.sign;
  else if (columns.debit != null && columns.credit != null) {
    sign = "split";
    notes.push(`Money out from "${headers[columns.debit]}", money in from "${headers[columns.credit]}".`);
  } else if (columns.amount != null && columns.direction != null) {
    sign = "direction";
    notes.push(`Direction from "${headers[columns.direction]}".`);
  } else {
    const raw = (r) => amountOf(r, columns.amount);
    const bal = balanceCheck(raw);
    if (bal) {
      sign = bal.inverted ? "inverted" : "signed";
      order = bal.order;
      notes.push(`Signs checked against the running balance (${Math.round(bal.rate * 100)}% of rows match).`);
    } else {
      let incomeNeg = 0;
      let incomePos = 0;
      let neg = 0;
      let n = 0;
      sample.forEach((r) => {
        const a = raw(r);
        if (a == null || a === 0) return;
        n++;
        if (a < 0) neg++;
        const text2 = `${r.cells[columns.description] ?? ""} ${columns.memo != null ? r.cells[columns.memo] ?? "" : ""}`;
        if (INCOME_WORDS.test(text2)) {
          if (a < 0) incomeNeg++;
          else incomePos++;
        }
      });
      if (incomeNeg + incomePos >= 1 && incomeNeg !== incomePos && neg > 0 && neg < n) {
        sign = incomeNeg > incomePos ? "inverted" : "signed";
        signCertainty = 0.85;
        notes.push(
          sign === "inverted" ? "Payments and refunds are negative here, so positive amounts are money out (typical for card statements)." : "Amounts are signed: negative is money out."
        );
      } else if (n > 0 && neg === 0) {
        sign = "inverted";
        signCertainty = 0.55;
        warnings.push(`Every amount is positive, so they were read as money out. Pass sign: "signed" if they're income.`);
      } else {
        sign = "signed";
        signCertainty = neg > 0 ? 0.85 : 0.5;
        notes.push("Amounts are signed: negative is money out.");
      }
    }
  }
  if (order === "unknown") {
    const ds = dates.filter((d) => d != null);
    let up = 0;
    let down = 0;
    for (let i = 1; i < ds.length; i++) {
      if (ds[i] > ds[i - 1]) up++;
      else if (ds[i] < ds[i - 1]) down++;
    }
    if (up + down > 0 && (up === 0 || down === 0 || Math.max(up, down) / (up + down) > 0.9)) {
      order = up >= down ? "ascending" : "descending";
    }
  }
  const dateRate = Math.min(1, dates.filter(Boolean).length / (dates.length || 1) / 0.9);
  const columnCertainty = columns.description === columns.date ? 0.3 : 1;
  const confidence = Math.round(Math.min(1, dateRate * dateCertainty * signCertainty * columnCertainty) * 100) / 100;
  if (sample.length === 0) warnings.push("No data rows found.");
  return {
    detection: { delimiter, headerRow, headers, columns, dateFormat, decimal, sign, order, confidence, notes, warnings },
    rows,
    dataStart
  };
}
function pickColumns(stats, forced, sample, decimal) {
  const used = new Set(Object.values(forced).filter((v) => typeof v === "number"));
  const take = (field, score, min = 0.5) => {
    if (field in forced) return forced[field];
    let best;
    let bestScore = min;
    stats.forEach((s, c) => {
      if (used.has(c)) return;
      const v = score(s, c);
      if (v > bestScore) [best, bestScore] = [c, v];
    });
    if (best != null) used.add(best);
    return best;
  };
  const h = (field) => (s) => headerScore(field, s.header);
  const date = take("date", (s) => s.dateRate > 0.6 ? s.dateRate * 2 + h("date")(s) : 0) ?? 0;
  used.add(date);
  stats.forEach((s, c) => {
    if (s.dateRate > 0.8 && s.amountRate < 0.5) used.add(c);
  });
  const balance = take("balance", (s) => s.amountRate > 0.6 ? h("balance")(s) : 0);
  const currency = take("currency", (s) => s.currencyRate > 0.8 ? 1 + h("currency")(s) : h("currency")(s) && s.currencyRate > 0.3 ? 1 : 0);
  let amount = take("amount", (s) => s.amountRate > 0.6 && !/local|original|fee|foreign/.test(s.header) ? h("amount")(s) : 0);
  let debit;
  let credit;
  if (amount == null) {
    debit = take("debit", (s) => s.amountRate > 0.6 || s.fill < 0.9 ? h("debit")(s) : 0);
    credit = take("credit", (s) => s.amountRate > 0.6 || s.fill < 0.9 ? h("credit")(s) : 0);
    if (debit == null !== (credit == null)) {
      amount = debit ?? credit;
      debit = credit = void 0;
    }
  }
  if (amount == null && debit == null) {
    const numeric = stats.map((s, c) => ({ s, c })).filter(({ s, c }) => !used.has(c) && s.amountRate > 0.9 && s.wordRate < 0.1);
    const sparse = numeric.filter(({ s }) => s.fill < 0.9);
    if (sparse.length >= 2 && complementary(sample, sparse[0].c, sparse[1].c)) {
      [debit, credit] = [sparse[0].c, sparse[1].c];
      used.add(debit);
      used.add(credit);
    } else if (numeric.length >= 1) {
      const full = numeric.filter(({ s }) => s.fill >= 0.9).map(({ c }) => c);
      amount = full[0] ?? numeric[0].c;
      if (full.length >= 2 && forced.balance === void 0) {
        const [a, b] = pickAmountAndBalance(sample, full[0], full[1], decimal);
        amount = a;
        if (balance == null) {
          used.add(b);
          forced = { ...forced, balance: b };
        }
      }
      used.add(amount);
    }
  }
  const balanceCol = balance ?? forced.balance;
  const direction = amount != null ? take("direction", (s) => s.directionRate > 0.8 ? 1 + h("direction")(s) : 0) : void 0;
  const category = take("category", (s) => s.wordRate > 0.3 ? h("category")(s) : 0);
  const description = take("description", (s) => s.wordRate > 0.2 && s.amountRate < 0.5 ? h("description")(s) * 2 + Math.min(s.avgLen, 40) / 40 + s.distinct : 0) ?? take("description", (s) => s.wordRate > 0.3 ? Math.min(s.avgLen, 60) / 30 + s.distinct : 0, 0) ?? date;
  const memo = take("memo", (s) => s.wordRate > 0.2 && s.fill > 0.2 ? h("memo")(s) : 0);
  const reference = take("reference", (s) => s.fill > 0.2 ? h("reference")(s) : 0);
  const out = { date, description };
  const add = (k, v) => {
    if (v != null) out[k] = v;
  };
  add("memo", memo);
  add("amount", amount);
  add("debit", debit);
  add("credit", credit);
  add("direction", direction);
  add("balance", balanceCol);
  add("currency", currency);
  add("category", category);
  add("reference", reference);
  return { ...out, ...stripUndefined(forced) };
}
function complementary(rows, a, b) {
  let both = 0;
  let either = 0;
  for (const r of rows) {
    const x = !!r.cells[a];
    const y = !!r.cells[b];
    if (x && y) both++;
    if (x || y) either++;
  }
  return either > 0 && both / either < 0.05;
}
function pickAmountAndBalance(rows, c1, c2, decimal) {
  const fits = (amount, balance) => {
    let hits = 0;
    for (let i = 1; i < rows.length; i++) {
      const a0 = parseAmount(rows[i - 1].cells[amount], decimal);
      const a1 = parseAmount(rows[i].cells[amount], decimal);
      const b0 = parseAmount(rows[i - 1].cells[balance], decimal);
      const b1 = parseAmount(rows[i].cells[balance], decimal);
      if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
      const d = b1 - b0;
      if (Math.abs(d) === Math.abs(a1) || Math.abs(d) === Math.abs(a0)) hits++;
    }
    return hits;
  };
  return fits(c2, c1) > fits(c1, c2) ? [c2, c1] : [c1, c2];
}
var stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0));

// src/parse.ts
function parse(input, options = {}) {
  const text = decode(input);
  const { detection, rows, dataStart } = analyze(text, options);
  const { columns: col, decimal, dateFormat, sign } = detection;
  const minor = options.minorUnits ?? 2;
  const max = options.maxRows ?? 1e5;
  const transactions = [];
  const skipped = [];
  const cell = (cells, c) => c == null ? "" : (cells[c] ?? "").trim();
  const money = (cells, c) => c == null ? null : parseAmount(cells[c], decimal, minor);
  for (let i = dataStart; i < rows.length && transactions.length < max; i++) {
    const { cells, line } = rows[i];
    const rawDate = cell(cells, col.date);
    const date = parseDate(rawDate, dateFormat);
    if (!date) {
      const hasMoney = [col.amount, col.debit, col.credit].some((c) => money(cells, c) != null);
      if (hasMoney) {
        skipped.push({ line, reason: "date", message: rawDate ? `Unreadable date "${clip(rawDate)}"` : "No date", raw: cells });
      }
      continue;
    }
    let amount;
    if (sign === "split") {
      const out = money(cells, col.debit);
      const inn = money(cells, col.credit);
      amount = out == null && inn == null ? null : Math.abs(inn ?? 0) - Math.abs(out ?? 0);
    } else {
      const a = money(cells, col.amount);
      if (a == null) amount = null;
      else if (sign === "inverted") amount = -a;
      else if (sign === "direction") {
        const isOut = directionOf(cell(cells, col.direction));
        amount = isOut === void 0 ? a : isOut ? -Math.abs(a) : Math.abs(a);
      } else amount = a;
    }
    if (amount == null) {
      skipped.push({ line, reason: "amount", message: "No amount", raw: cells });
      continue;
    }
    if (amount === 0) {
      skipped.push({ line, reason: "zero", message: "Amount is zero", raw: cells });
      continue;
    }
    amount = amount === 0 ? 0 : amount;
    const t = {
      date,
      amount,
      description: clean(cell(cells, col.description)) || clean(cell(cells, col.memo)) || "(no description)",
      line,
      raw: cells
    };
    const memo = clean(cell(cells, col.memo));
    if (memo && memo !== t.description) t.memo = memo;
    const balance = money(cells, col.balance);
    if (balance != null) t.balance = balance;
    const currency = cell(cells, col.currency).toUpperCase();
    if (/^[A-Z]{3}$/.test(currency)) t.currency = currency;
    const category = clean(cell(cells, col.category));
    if (category) t.category = category;
    const reference = clean(cell(cells, col.reference));
    if (reference) t.reference = reference;
    transactions.push(t);
  }
  return { transactions, skipped, detection };
}
var clean = (s) => s.replace(/\s+/g, " ").trim();
var clip = (s) => s.length > 24 ? `${s.slice(0, 24)}\u2026` : s;

// src/export.ts
function toCSV(transactions, options = {}) {
  const minor = options.minorUnits ?? 2;
  const has = (k) => transactions.some((t) => t[k] != null);
  const extra = ["memo", "category", "currency", "balance", "reference"].filter(has);
  const header = ["Date", "Description", "Amount", ...extra.map((k) => k[0].toUpperCase() + k.slice(1))];
  const rows = transactions.map((t) => [
    t.date,
    safe(t.description),
    formatMinor(t.amount, minor),
    ...extra.map((k) => {
      const v = t[k];
      if (v == null) return "";
      return k === "balance" ? formatMinor(v, minor) : safe(String(v));
    })
  ]);
  return stringify([header, ...rows], options.delimiter ?? ",");
}
var safe = (s) => /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
