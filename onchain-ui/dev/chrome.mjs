import { existsSync } from 'node:fs';

const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

/** Headless Chrome/Chromium for fork smoke. Mac path first, then Linux, then PATH. */
export function chromeBin() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const p of [MAC, ...LINUX]) {
    if (existsSync(p)) return p;
  }
  return MAC;
}
