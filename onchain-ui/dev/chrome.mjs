import { existsSync } from 'node:fs';

const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/local/bin/google-chrome',
];

/** Headless Chrome/Chromium for fork smoke. CHROME env wins, then Mac, then Linux. */
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
