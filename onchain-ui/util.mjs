export const EMPTY_WALLET = 'Your connected wallet needs a little ETH for gas.';
export const LS_RPC = 'v1w-rpc-';
export const LS_TOK = 'v1w-tok-';
export const LS_HIST = 'v1w-hist-';
export const LS_THEME = 'v1w-theme';

export const $ = (id) => document.getElementById(id);
export const eq = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
export const hex = (n) => '0x' + BigInt(n).toString(16);
export const word = (h) => BigInt(h && h !== '0x' ? h : '0x0');

export const fmtAmt = (n, d = 18, sym = '', maxFrac = 6) => {
  const ds = Number(d);
  if (!ds) return sym ? `${n} ${sym}` : String(n);
  const s = n.toString().padStart(ds + 1, '0');
  const whole = s.slice(0, -ds).replace(/^0+(?=\d)/, '') || '0';
  const frac = s.slice(-ds).replace(/0+$/, '');
  const num = frac ? `${whole}.${frac.slice(0, maxFrac)}` : whole;
  return sym ? `${num} ${sym}` : num;
};
export const fmtEth = (n) => fmtAmt(n, 18, 'ETH');

export function fmtWhen(ts) {
  const n = Number(ts);
  if (!n) return '';
  const s = Date.now() / 1000 - n;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 21) return `${Math.floor(s / 86400)}d ago`;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

export const short = (a) => (a && a.length === 42 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '-');
export const clip = (a) => (a && a.length === 42 ? `${a.slice(0, 7)}…${a.slice(-5)}` : a || '-');

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener noreferrer" target="_blank">$1</a>');
}

/** Subset used by this wallet's SKILL.md: frontmatter, #/##, lists, p, `code`, **bold**, http(s) links. */
export function renderMd(src) {
  const t = String(src || '').replace(/\r\n/g, '\n');
  const out = [];
  let body = t;
  const fm = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    out.push('<dl class="fm">');
    for (const line of fm[1].split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      let v = line.slice(i + 1).trim();
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
      out.push(`<dt>${esc(line.slice(0, i).trim())}</dt><dd>${inlineMd(v)}</dd>`);
    }
    out.push('</dl>');
    body = t.slice(fm[0].length);
  }
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
      i += 1;
      continue;
    }
    if (/^[-*] /.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].slice(2))}</li>`);
        i += 1;
      }
      out.push('</ul>');
      continue;
    }
    if (/^\d+\. /.test(line)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        out.push(`<li>${inlineMd(lines[i].replace(/^\d+\. /, ''))}</li>`);
        i += 1;
      }
      out.push('</ol>');
      continue;
    }
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !/^[-*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inlineMd(buf.join(' '))}</p>`);
  }
  return out.join('');
}

const SKILL_EOA = 'YOUR_EOA_ADDRESS';
const SKILL_AA = 'YOUR_SMART_ACCOUNT_ADDRESS';

/** Fill in-page SKILL.md placeholders. Labels say where each address came from. */
export function fillSkill(src, { eoa = '', aa = '', deployed = false } = {}) {
  let t = String(src || '');
  t = t.replaceAll(SKILL_EOA, eoa ? `${eoa} (connected account)` : SKILL_EOA);
  if (aa && deployed) t = t.replaceAll(SKILL_AA, `${aa} (derived from connected)`);
  else if (aa) t = t.replaceAll(SKILL_AA, `${aa} (derived from connected; no account on this network)`);
  else if (eoa) t = t.replaceAll(SKILL_AA, 'not found (derived from connected)');
  return t;
}
