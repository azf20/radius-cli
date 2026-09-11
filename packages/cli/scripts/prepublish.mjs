// radius-cli is published with `radius-sdk: workspace:^` rewritten to the SDK's current version.
// Refuse to publish unless that exact version is already on npm, so an install can never fail
// (or resolve someone else's package) because the SDK went out second or not at all.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { name, version } = JSON.parse(readFileSync(new URL('../../sdk/package.json', import.meta.url), 'utf8'));
let published = '';
try {
  published = execFileSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  /* not found */
}
if (published !== version) {
  console.error(`radius-cli depends on ${name}@${version}, which is not on npm. Publish packages/sdk first (pnpm publish in packages/sdk).`);
  process.exit(1);
}
console.log(`${name}@${version} is published; ok to publish radius-cli.`);
