import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/local/bin/google-chrome',
];

export function chromeBin() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const p of [MAC, ...LINUX]) {
    if (existsSync(p)) return p;
  }
  return MAC;
}

/** Shared headless flags. `--no-sandbox` is required on many Linux CI/agent images. */
export function chromeArgs(extra = []) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--no-proxy-server',
    '--use-mock-keychain',
    '--password-store=basic',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstModeV2',
    '--remote-allow-origins=*',
    ...extra,
  ];
}

const live = new Set();

function removeProfile(profile) {
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  } catch (e) {
    console.error('could not remove Chrome profile', profile, e.code || e.message);
  }
}

process.on('exit', () => {
  for (const c of live) {
    try {
      c.child.kill('SIGKILL');
    } catch {
    }
    removeProfile(c.profile);
  }
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => process.exit(130));

/**
 * Headless Chrome with a throwaway profile. `await close()` lets Chrome quit, then removes the
 * profile. If the harness exits first (fail, throw, Ctrl-C), Chrome is killed and the profile removed.
 */
export function launchChrome(prefix, extra = [], stdio = 'ignore') {
  const profile = mkdtempSync(join(tmpdir(), prefix));
  const child = spawn(chromeBin(), chromeArgs([`--user-data-dir=${profile}`, ...extra]), { stdio });
  const exited = new Promise((r) => child.once('exit', r));
  const c = {
    child,
    profile,
    async close() {
      if (!live.delete(c)) return;
      child.kill('SIGTERM');
      const t = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(t);
      removeProfile(profile);
    },
  };
  live.add(c);
  return c;
}
