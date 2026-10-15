/**
 * Helpers for the seller cases that run a real web framework or runtime (Next.js, Astro, Cloudflare's
 * workerd via wrangler): on-demand provisioning of frameworks the workspace does not depend on, a copy of a
 * fixture app wired to this checkout's `radius-sdk`, and asynchronous subprocess handling.
 *
 * Everything here is async on purpose. The mock facilitator runs in the runner's process, so a blocking
 * `execFileSync` (a framework build that calls the facilitator) would starve it until the seller times out.
 */
import { spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** A framework could not be provisioned or started in this environment (offline, no npm, opted out). The case reports SKIP. */
export class Unavailable extends Error {}

/** Where provisioned frameworks live between runs. Delete it to force a fresh install. */
export const CACHE_DIR = process.env.SELL_EVAL_CACHE ?? join(tmpdir(), 'radius-sell-eval-cache');

const PROXY_VARS = /^(https?_proxy|all_proxy|no_proxy)$/i;

/** The caller's environment without proxies and wallet settings: loopback traffic must not leave the machine. */
export function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !PROXY_VARS.test(key) && !key.startsWith('RADIUS_')));
  return { ...env, ...extra };
}

/** Run a command to completion without blocking the event loop. Resolves with the exit code and the tail of its output. */
export function run(command, args, { cwd, env = cleanEnv(), timeoutMs = 300_000 } = {}) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      done({ code: -1, output: String(error), spawnError: error });
      return;
    }
    let output = '';
    const keep = (s) => { output = (output + s).slice(-6000); };
    child.stdout.setEncoding('utf8').on('data', keep);
    child.stderr.setEncoding('utf8').on('data', keep);
    child.once('error', (error) => done({ code: -1, output: `${output}\n${error.message}`, spawnError: error }));
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }, timeoutMs);
    child.once('close', (code, signal) => { clearTimeout(timer); done({ code: code ?? -1, signal, output }); });
  });
}

/** Start a long-running server in its own process group (wrangler leaves workerd behind otherwise) and wait until `ready()` is true. */
export async function startProcess(command, args, { cwd, env = cleanEnv(), ready, timeoutMs = 60_000, name = command }) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  const keep = (s) => { output = (output + s).slice(-6000); };
  child.stdout.setEncoding('utf8').on('data', keep);
  child.stderr.setEncoding('utf8').on('data', keep);
  let exited = false;
  child.once('exit', () => { exited = true; });
  child.once('error', (error) => { exited = true; output += `\n${error.message}`; });
  const stop = async () => {
    if (!exited) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } }
    for (let i = 0; i < 20 && !exited; i++) await sleep(50);
  };
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline && !exited;) {
    try { if (await ready()) return { stop, output: () => output }; } catch { /* not listening yet */ }
    await sleep(250);
  }
  await stop();
  throw new Error(`${name} was not ready within ${timeoutMs / 1000}s${exited ? ' (process exited)' : ''}: ${output.slice(-1200)}`);
}

/**
 * Install `dependencies` once into `CACHE_DIR/<key>` with `npm install`, and reuse them on later runs. Throws `Unavailable`
 * when that cannot happen (opted out, no npm, no registry), which is a SKIP, not a failure. Scripts are not run
 * (`--ignore-scripts`), and no lockfile is written.
 */
export async function provision(key, dependencies) {
  const dir = join(CACHE_DIR, key);
  const exists = () => access(join(dir, '.provisioned')).then(() => true, () => false);
  if (await exists()) return dir;
  if (process.env.SELL_SKIP_PROVISIONED === '1') throw new Unavailable('SELL_SKIP_PROVISIONED=1');
  // Install beside the final directory and rename it into place, so two runs at once cannot corrupt each other's install.
  await mkdir(CACHE_DIR, { recursive: true });
  const staging = await mkdtemp(join(CACHE_DIR, `${key}.installing-`));
  await writeFile(join(staging, 'package.json'), `${JSON.stringify({ name: `sell-eval-${key}`, private: true, type: 'module', dependencies }, null, 2)}\n`);
  // npm needs the proxy settings of the environment, unlike the servers started later.
  const result = await run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock', '--loglevel=error', '--fetch-retries=1', '--fetch-timeout=60000'],
    { cwd: staging, env: { ...process.env }, timeoutMs: 600_000 });
  if (result.code !== 0) {
    await rm(staging, { recursive: true, force: true });
    const why = result.spawnError ? `npm is not available (${result.spawnError.code ?? result.spawnError.message})` : `npm install exited ${result.code}: ${result.output.trim().split('\n').slice(-3).join(' | ')}`;
    throw new Unavailable(`could not install ${Object.entries(dependencies).map(([n, v]) => `${n}@${v}`).join(', ')}: ${why}`);
  }
  await writeFile(join(staging, '.provisioned'), `${new Date().toISOString()}\n`);
  await rename(staging, dir).catch(async () => { await rm(staging, { recursive: true, force: true }); });
  if (!(await exists())) throw new Unavailable(`could not move the install of ${key} into ${dir}`);
  return dir;
}

/**
 * A scratch copy of a fixture app inside the provisioned directory (so the framework resolves from its `node_modules`),
 * with this checkout's SDK linked as `radius-sdk`. `files` overrides or adds files, as `{ 'src/middleware.js': '<path to copy>' }`.
 * Returns `{ dir, remove }`.
 */
export async function prepareApp({ provisioned, fixture, sdkRoot, files = {} }) {
  const dir = await mkdtemp(join(provisioned, 'app-'));
  await cp(fixture, dir, { recursive: true });
  for (const [target, source] of Object.entries(files)) {
    await mkdir(join(dir, target, '..'), { recursive: true });
    await cp(source, join(dir, target));
  }
  await linkSdk(dir, sdkRoot);
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** Link `radius-sdk` into `dir/node_modules` (its own dependencies resolve from the SDK's real path). */
export async function linkSdk(dir, sdkRoot) {
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  await symlink(sdkRoot, join(dir, 'node_modules', 'radius-sdk'), 'dir');
}
