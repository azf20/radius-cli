import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

const docsRoot = join(import.meta.dirname, '..');
const repoRoot = join(docsRoot, '..', '..');
const plugin = JSON.parse(readFileSync(join(repoRoot, 'plugins/radius/.claude-plugin/plugin.json'), 'utf8'));
const repository = 'https://github.com/radiustechsystems/tools';

execFileSync(process.execPath, ['--import', 'tsx', join(import.meta.dirname, 'generate-skills-md.ts')]);

function frontmatter(markdown: string) {
  return parse(markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]);
}

for (const name of ['radius-dev', 'dripping-faucet', 'x402', 'sell-api']) {
  test(`${name}: published description and links survive flattening`, () => {
    const source = join(repoRoot, 'plugins/radius/skills', name, 'SKILL.md');
    const output = readFileSync(join(docsRoot, 'public/skills', `${name}.md`), 'utf8');
    const metadata = frontmatter(output);
    const description = frontmatter(readFileSync(source, 'utf8')).description.replace(/\s+/g, ' ').trim();
    assert.equal(metadata.description.trim(), description);
    assert.ok(description.length > 20 && description.length <= 1024);
    assert.equal(metadata.name, name);
    assert.equal(metadata.metadata.version, plugin.version);
    assert.equal(metadata.metadata.repository, repository);
    assert.ok(output.includes(`](${repository}/blob/main/plugins/radius/skills/${name}/SKILL.md)`));

    for (const [, target] of output.matchAll(/\]\(([^\s)]+)\)/g)) {
      assert.match(target, /^(?:#|\/|[a-z][a-z\d+.-]*:)/i, `relative link left in ${name}: ${target}`);
      const prefix = `${repository}/blob/main/`;
      if (target.startsWith(prefix)) {
        assert.ok(existsSync(join(repoRoot, target.slice(prefix.length).split('#')[0])), target);
      }
    }
  });
}

test('flat references use local anchors; scripts and other skills keep source links', () => {
  const read = (name: string) => readFileSync(join(docsRoot, 'public/skills', `${name}.md`), 'utf8');
  assert.ok(read('dripping-faucet').includes('[references/faucet-api.md](#'));
  assert.ok(
    read('radius-dev').includes(
      `[scripts/radius-wallet-bootstrap.mjs](${repository}/blob/main/plugins/radius/skills/radius-dev/scripts/radius-wallet-bootstrap.mjs)`,
    ),
  );
  assert.ok(
    read('x402').includes(
      `[micropayments.md](${repository}/blob/main/plugins/radius/skills/radius-dev/references/micropayments.md)`,
    ),
  );
});
