import { readFileSync, writeFileSync, mkdirSync, unlinkSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BUN_PIN } from './bun-pin.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const dist = join(dir, 'dist');
const tmpJs = join(dist, '.app.min.js');
mkdirSync(dist, { recursive: true });

function bunVersion() {
  const r = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return (r.status === 0 ? String(r.stdout || '').trim() : '');
}

function requirePinnedBun() {
  const v = bunVersion();
  if (v !== BUN_PIN) {
    throw new Error(
      `freeze minify needs bun ${BUN_PIN} (got ${v || 'missing'}). CI and .bun-version pin this; do not RESTAMP with another bun.`,
    );
  }
}

function bundleJs() {
  requirePinnedBun();
  const bun = spawnSync('bun', ['build', '--minify', '--outfile', tmpJs, join(dir, 'app.mjs')], {
    encoding: 'utf8',
  });
  try {
    if (bun.status === 0) return readFileSync(tmpJs, 'utf8').trim();
  } finally {
    try {
      unlinkSync(tmpJs);
    } catch {
      /* no tmp */
    }
  }
  throw new Error((bun.stderr || bun.stdout || 'bun build --minify failed').trim());
}

function shortIdent(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/::(before|after)/g, ':$1')
    .replace(/\s+/g, ' ')
    // Keep space before `:` so `body:not(.on) :is(...)` stays a descendant (not `body:is`).
    .replace(/ ?([{};,>/]) ?/g, '$1')
    .replace(/: /g, ':')
    .replace(/@media \(/g, '@media(')
    .replace(/ and \(/g, ' and(')
    .replace(/ !important/g, '!important')
    .replace(/background:transparent/g, 'background:0')
    .replace(/transparent/g, '#0000')
    .replace(/outline:none/g, 'outline:0')
    .replace(/(?<![\d.])-?0+\.(?=\d)/g, (s) => (s.startsWith('-') ? '-.' : '.'))
    .trim();
}

function crushMarkup(html) {
  const attrs = (s) =>
    s.replace(/\s+type="button"/g, '').replace(/(\s[\w:-]+=)"([A-Za-z0-9._:-]+)"/g, '$1$2');
  const voidSlash = (s) => s.replace(/ \/>/g, '>').replace(/\/>/g, '>');
  // HTML void tags can drop `/`; SVG path/circle/rect cannot — unclosed <path> nests and only the first fill shows.
  const chunks = [];
  const re = /<svg\b[\s\S]*?<\/svg>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    chunks.push(voidSlash(attrs(html.slice(last, m.index))));
    chunks.push(m[0]);
    last = m.index + m[0].length;
  }
  chunks.push(voidSlash(attrs(html.slice(last))));
  return chunks.join('');
}

function crushHtml(html) {
  const chunks = [];
  const re = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    chunks.push(crushMarkup(html.slice(last, m.index)));
    chunks.push(m[0]);
    last = m.index + m[0].length;
  }
  chunks.push(crushMarkup(html.slice(last)));
  return chunks.join('');
}

function minifyCssVars(css) {
  const names = [...new Set([...css.matchAll(/--([a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
  const freq = Object.fromEntries(names.map((n) => [n, 0]));
  for (const m of css.matchAll(/--([a-zA-Z][\w-]*)/g)) freq[m[1]]++;
  names.sort((a, b) => freq[b] - freq[a] || b.length - a.length);
  const used = new Set(names);
  const map = new Map();
  let i = 0;
  for (const old of names) {
    let neu;
    do neu = shortIdent(i++);
    while (used.has(neu));
    used.add(neu);
    map.set(old, neu);
  }
  let out = css;
  for (const old of [...map.keys()].sort((a, b) => b.length - a.length)) {
    out = out.replaceAll(`--${old}`, `--${map.get(old)}`);
  }
  return out;
}

function isToken(src, name) {
  return new RegExp(`(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`).test(src);
}

function tokenRe(name) {
  return new RegExp(`(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`, 'g');
}

function mangleHyphenClasses(html) {
  const style = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!style) return html;
  // dist-only. Keep `copy` (execCommand) and `skill` (`$('tab-'+id)`).
  const names = [
    ...new Set([...style[1].matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((m) => m[1])),
  ].filter((n) => (n.includes('-') || n.length >= 4) && n !== 'copy' && n !== 'skill' && n !== 'host');
  const freq = Object.fromEntries(names.map((n) => [n, 0]));
  for (const n of names) freq[n] = html.match(tokenRe(n))?.length || 0;
  names.sort((a, b) => freq[b] - freq[a] || b.length - a.length);
  const used = new Set();
  for (const m of html.matchAll(/[.#](-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) used.add(m[1]);
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) used.add(m[1]);
  const map = new Map();
  let i = 0;
  for (const old of names) {
    if (!freq[old]) continue;
    let neu;
    do neu = `z${i++}`;
    while (used.has(neu) || isToken(html, neu));
    used.add(neu);
    map.set(old, neu);
  }
  let out = html;
  for (const old of [...map.keys()].sort((a, b) => b.length - a.length)) {
    out = out.replace(tokenRe(old), map.get(old));
  }
  return out;
}

const js = bundleJs();
const css = readFileSync(join(dir, 'wallet.css'), 'utf8');
const cssMin = minifyCssVars(minifyCss(css));
if (cssMin.includes('body:not(.on):is(')) {
  throw new Error('CSS minify ate the descendant space before :is (landing would leak wallet chrome)');
}
let html = readFileSync(join(dir, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="\.\/wallet\.css"\s*\/?>/, () => `<style>${cssMin}</style>`);
html = html.replace(/\s*<script type="module" src="\.\/app\.mjs"><\/script>/, () => `<script type="module">${js}</script>`);
html = html.replace(/>\s+</g, '><').trim();
html = mangleHyphenClasses(html);

const skill = readFileSync(join(dir, '..', 'SKILL.md'), 'utf8');
if (!skill.trimStart().startsWith('---') || !skill.includes('name: blacksmith-v1-wallet')) {
  throw new Error('SKILL.md must start with YAML name: blacksmith-v1-wallet');
}
const escaped = skill.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const withSkill = html.replace(/<pre id="skillMd"[^>]*><\/pre>/, (open) =>
  open.replace('></pre>', `>${escaped}</pre>`)
);
if (withSkill === html) throw new Error('skillMd pre missing; cannot inline SKILL.md');
html = withSkill;
html = crushHtml(html);
{
  const bundled = html.match(/<script type="?module"?>([\s\S]*)<\/script>/);
  if (!bundled) throw new Error('inlined module missing after crush');
  try {
    new Function(bundled[1]);
  } catch (e) {
    throw new Error(`inlined module parse: ${e.message}`);
  }
  if (html.includes('=0x+') || html.includes('r2=YOUR_EOA_ADDRESS')) {
    throw new Error('crushHtml ate quotes inside the inlined module');
  }
  if (!html.includes('r="2.6"') || html.includes('r=2.6/')) {
    throw new Error('crushHtml unquoted SVG r="2.6"/> (theme icons nest)');
  }
  const logo = html.match(/viewBox="0 0 345 345"[\s\S]*?<\/svg>/);
  if (!logo || (logo[0].match(/<path\b/g) || []).length !== 10 || (logo[0].match(/\/>/g) || []).length < 10) {
    throw new Error('crushHtml unclosed SVG paths (logo would nest inside the first fill)');
  }
}

if (html.charCodeAt(0) === 0xef) {
  throw new Error('HTML starts with 0xEF (BOM); CREATE would reject it (EIP-3541)');
}
const max = 24576;
const bytes = Buffer.byteLength(html);
const n = bytes === 0 ? 0 : Math.ceil(bytes / max);
if (n < 1 || n > 16) throw new Error(`page ${bytes} B splits into ${n} chunks (need 1–16 × ${max})`);
{
  const raw = Buffer.from(html);
  for (let i = 0; i < n; i++) {
    const part = raw.subarray(i * max, (i + 1) * max);
    if (part.length && part[0] === 0xef) throw new Error(`chunk ${i} starts with 0xEF (EIP-3541)`);
  }
}
if (html.includes('src="./app.mjs"') || !/<script type="?module"?>[^<]/.test(html)) {
  throw new Error('dist still loads app.mjs or module was not inlined (String.replace $&?)');
}
if (html.includes('wallet.css') || !/<style>[^<]/.test(html)) {
  throw new Error('dist still links wallet.css or CSS was not inlined');
}

const distHtml = join(dist, 'index.html');
let prev = '';
try {
  prev = readFileSync(distHtml, 'utf8');
} catch {
  /* first freeze */
}
if (html !== prev && process.env.RESTAMP !== '1') {
  throw new Error(
    `dist/index.html would change (${bytes} B). Committed freeze is the pin. Set RESTAMP=1 only to stamp a new one.`
  );
}

const parts = [];
for (let i = 0; i < n; i++) parts.push(Buffer.from(html).subarray(i * max, (i + 1) * max));
if (Buffer.concat(parts).compare(Buffer.from(html)) !== 0) throw new Error('chunk concat != html');

if (html !== prev) {
  writeFileSync(distHtml, html);
  copyFileSync(join(dir, '..', 'SKILL.md'), join(dist, 'SKILL.md'));
  const forge = spawnSync('forge', ['test', '--match-test', 'test_distHtmlRoundTrip', '-vv'], {
    cwd: join(dir, 'contracts'),
    encoding: 'utf8',
  });
  if (forge.error && forge.error.code === 'ENOENT') {
    throw new Error('forge required after RESTAMP to verify dist html() round-trip');
  }
  if (forge.status !== 0) {
    throw new Error((forge.stdout || '') + (forge.stderr || forge.error || ''));
  }
  console.log('wrote', distHtml, bytes, 'bytes', `(${n} chunk${n === 1 ? '' : 's'} ≤ ${max})`);
} else {
  console.log('freeze unchanged', bytes, 'bytes', `(${n} chunk${n === 1 ? '' : 's'} ≤ ${max})`);
}
