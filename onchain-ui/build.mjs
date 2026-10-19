import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BUN_PIN } from './bun-pin.mjs';
import { PAGE_BYTES, PAGE_CHUNKS, PAGE_KECCAK, VERSION_HOST } from './host-pin.mjs';
import { keccak256 } from '../mcp/eth-crypto.mjs';

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
      `freeze minify needs bun ${BUN_PIN} (got ${v || 'missing'}). CI and .bun-version pin this; do not build the freeze with another bun.`,
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
  const punct = '{};,>/';
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/::(before|after)/g, ':$1')
    .replace(/\s+/g, ' ')
    .replace(new RegExp(` ?([${punct}]) ?`, 'g'), '$1')
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

const HTML_VOID = 'area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr';

function dropVoidSlash(html) {
  return html.replace(new RegExp(`<(${HTML_VOID})\\b([^>]*)\\s*/>`, 'gi'), '<$1$2>');
}

function crushMarkup(html) {
  const attrs = (s) =>
    s.replace(/\s+type="button"/g, '').replace(/(\s[\w:-]+=)"([A-Za-z0-9._:-]+)"/g, '$1$2');
  const chunks = [];
  const re = /<svg\b[\s\S]*?<\/svg>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    chunks.push(dropVoidSlash(attrs(html.slice(last, m.index))));
    chunks.push(dropVoidSlash(m[0]));
    last = m.index + m[0].length;
  }
  chunks.push(dropVoidSlash(attrs(html.slice(last))));
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
    out = renameClassToken(out, old, map.get(old));
  }
  return out;
}

function renameClassToken(html, old, neu) {
  let out = html.replace(new RegExp(`\\.${old}(?![A-Za-z0-9_-])`, 'g'), `.${neu}`);
  out = out.replace(/\bclass\s*=\s*"([^"]*)"/g, (full) => full.replace(tokenRe(old), neu));
  out = out.replace(/\bclass\s*=\s*'([^']*)'/g, (full) => full.replace(tokenRe(old), neu));
  out = out.replaceAll(`"${old}"`, `"${neu}"`);
  out = out.replaceAll(`'${old}'`, `'${neu}'`);
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
{
  const icon = readFileSync(join(dir, 'favicon.svg'), 'utf8').replace(/\s+/g, ' ').trim();
  if ((icon.match(/<path\b/g) || []).length !== 10) throw new Error('favicon.svg must be the 10-path mark');
  const href = 'data:image/svg+xml,' + encodeURIComponent(icon);
  const next = html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${href}">`);
  if (next === html) throw new Error('icon link missing; cannot inline favicon');
  html = next;
}
html = html.replace(/\s*<script type="module" src="\.\/app\.mjs"><\/script>/, () => `<script type="module">${js}</script>`);
html = html.replace(/>\s+</g, '><').trim();
html = mangleHyphenClasses(html);
if (!html.includes('wait until AccountFactory is deployed')) {
  throw new Error('freeze renamed the missing-factory sentence');
}
{
  const status = html.match(/classList\.contains\("([^"]+)"\)/);
  if (!status || !html.includes(`#note.${status[1]}{`)) {
    throw new Error('status class in the script does not match the stylesheet');
  }
}

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
}
const parts = [];
for (let i = 0; i < n; i++) parts.push(Buffer.from(html).subarray(i * max, (i + 1) * max));
if (Buffer.concat(parts).compare(Buffer.from(html)) !== 0) throw new Error('chunk concat != html');

function predict(htmlPath) {
  const forge = spawnSync(
    'forge',
    ['script', 'script/Deploy.s.sol:Deploy', '--sig', 'predictFromDist()', '--offline', '-vv'],
    { cwd: join(dir, 'contracts'), encoding: 'utf8' },
  );
  const out = `${forge.stdout || ''}\n${forge.stderr || ''}`;
  if (forge.status !== 0) throw new Error(out || 'forge predictFromDist failed');
  const host = out.match(/host: address (0x[0-9a-fA-F]{40})/);
  const k = out.match(/pageKeccak: bytes32 (0x[0-9a-fA-F]{64})/);
  const chunks = out.match(/nChunks: uint256 (\d+)/);
  if (!host || !k || !chunks) throw new Error('forge predictFromDist returned no pin\n' + out);
  const keccak = keccak256(readFileSync(htmlPath)).toLowerCase();
  if (k[1].toLowerCase() !== keccak) throw new Error('forge keccak != file keccak');
  return { host: host[1], keccak, chunks: Number(chunks[1]), bytes: readFileSync(htmlPath).length };
}

function writeHostPin(pin) {
  writeFileSync(
    join(dir, 'host-pin.mjs'),
    `export const VERSION_HOST = '${pin.host}';\n` +
      `export const PAGE_KECCAK = '${pin.keccak}';\n` +
      `export const PAGE_BYTES = ${pin.bytes};\n` +
      `export const PAGE_CHUNKS = ${pin.chunks};\n\n` +
      `export function gatewayUrl(chain) {\n` +
      `  const label = chain === 8453 ? '8453' : '1';\n` +
      `  return \`https://\${VERSION_HOST}.\${label}.w3link.io/\`;\n` +
      `}\n`,
  );
}

function replacePin(text) {
  return text
    .replaceAll(VERSION_HOST, pinHost)
    .replaceAll(VERSION_HOST.toLowerCase(), pinHost.toLowerCase())
    .replaceAll(PAGE_KECCAK, pinKeccak)
    .replaceAll(PAGE_KECCAK.toLowerCase(), pinKeccak)
    .replaceAll(`**${PAGE_CHUNKS}** EIP-170 chunks`, `**${pinChunks}** EIP-170 chunks`)
    .replaceAll(`**${PAGE_BYTES}** B`, `**${pinBytes}** B`);
}

let pinHost = VERSION_HOST;
let pinKeccak = PAGE_KECCAK;
let pinChunks = PAGE_CHUNKS;
let pinBytes = PAGE_BYTES;

if (html !== prev) {
  writeFileSync(distHtml, html);
  try {
    const pin = predict(distHtml);
    pinHost = pin.host;
    pinKeccak = pin.keccak;
    pinChunks = pin.chunks;
    pinBytes = pin.bytes;
    writeHostPin(pin);
    const deployPath = join(dir, 'contracts/script/Deploy.s.sol');
    writeFileSync(
      deployPath,
      readFileSync(deployPath, 'utf8')
        .replace(/PUBLISHED_HOST = 0x[0-9a-fA-F]{40}/, `PUBLISHED_HOST = ${pin.host}`)
        .replace(/PUBLISHED_KECCAK = 0x[0-9a-fA-F]{64}/, `PUBLISHED_KECCAK = ${pin.keccak}`),
    );
    for (const rel of [
      '../README.md',
      '../AGENTS.md',
      '../.cursor/skills/verify-blacksmith/SKILL.md',
      '../.cursor/skills/verify-blacksmith/features/README.md',
      '../.cursor/skills/verify-blacksmith/features/pin.md',
    ]) {
      const p = join(dir, rel);
      writeFileSync(p, replacePin(readFileSync(p, 'utf8')));
    }
    console.log('wrote', distHtml, pin.bytes, 'bytes', pin.chunks, 'chunks', pin.keccak, pin.host);
  } catch (e) {
    if (prev) writeFileSync(distHtml, prev);
    throw e;
  }
} else {
  console.log('freeze unchanged', bytes, 'bytes', `(${n} chunk${n === 1 ? '' : 's'} ≤ ${max})`);
}
{
  const pin = spawnSync(process.execPath, [join(dir, 'dev/pin-check.mjs')], { encoding: 'utf8' });
  if (pin.status !== 0) throw new Error((pin.stdout || '') + (pin.stderr || pin.error || ''));
  const forge = spawnSync('forge', ['test', '--match-contract', 'VersionHostTest', '-q'], {
    cwd: join(dir, 'contracts'),
    encoding: 'utf8',
  });
  if (forge.status !== 0) throw new Error((forge.stdout || '') + (forge.stderr || forge.error || ''));
}
