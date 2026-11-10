#!/usr/bin/env node
/**
 * craft-bridge launcher (MVP_PLAN §1 Gap 6).
 * Resolves the SolidCraft control port, starts CraftBridge on an OS-selected
 * loopback port, and writes a private per-run NEXUS environment handoff.
 *
 * Usage: node craft-bridge-server.mjs [--port 0] [--control-port N]
 *        [--runtime-file PATH] [--env-file PATH]
 *
 * Control port precedence: --control-port > CRAFT_CONTROL_PORT
 * > control/current.port > exactly one <port>.token in the control directory.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CraftBridge } from './craft-bridge.mjs';
import { tokenPathFor } from './craft-adapter.mjs';

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error('missing value for --' + name);
  return value;
}

function parsePort(raw, label, allowZero = false) {
  const port = Number(raw);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(port) || port < minimum || port > 65535) {
    throw new Error(label + ' must be an integer from ' + minimum + ' to 65535');
  }
  return port;
}

function controlDir() {
  return process.env.SOLIDCRAFT_CONTROL_DIR
    ?? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'SolidCraft', 'control');
}

function discoverControlPort(dir) {
  const cliPort = arg('control-port');
  const envPort = process.env.CRAFT_CONTROL_PORT;
  if (cliPort !== undefined) return { port: parsePort(cliPort, '--control-port'), via: 'arg' };
  if (envPort !== undefined) return { port: parsePort(envPort, 'CRAFT_CONTROL_PORT'), via: 'env' };

  try {
    const current = readFileSync(join(dir, 'current.port'), 'utf8').trim();
    const port = parsePort(current, 'control/current.port');
    return { port, via: 'current.port' };
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }

  let candidates = [];
  try {
    candidates = readdirSync(dir).filter((name) => /^\d+\.token$/.test(name));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
  if (candidates.length === 1) {
    return {
      port: parsePort(candidates[0].slice(0, -6), 'token filename'),
      via: 'token-scan',
    };
  }
  return { port: null, candidates };
}

function lockPathToCurrentUser(path, isDirectory = false) {
  if (process.platform === 'win32') {
    const identity = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sid = identity.match(/S-\d+(?:-\d+)+/i)?.[0];
    if (!sid) throw new Error('could not determine current Windows user SID');
    const grant = sid + ':' + (isDirectory ? '(OI)(CI)F' : 'F');
    execFileSync('icacls.exe', [path, '/inheritance:r', '/grant:r', grant], {
      stdio: 'ignore',
    });
    return;
  }
  chmodSync(path, isDirectory ? 0o700 : 0o600);
}

function createPrivateDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'nexus-craft-bridge-'));
  try {
    lockPathToCurrentUser(path, true);
    return path;
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
}

function writePrivateFile(path, value, createdFiles) {
  let fd;
  let created = false;
  try {
    fd = openSync(path, 'wx', 0o600);
    created = true;
    writeFileSync(fd, value, 'utf8');
    closeSync(fd);
    fd = undefined;
    lockPathToCurrentUser(path);
    createdFiles.push(path);
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already closed */ }
    }
    if (created) {
      try { rmSync(path, { force: true }); } catch { /* remove only our own partial file */ }
    }
    throw error;
  }
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function main() {
  // Validate path arguments before allocating the private temp directory, so a
  // malformed CLI invocation cannot leave an orphaned directory behind.
  const runtimePath = arg('runtime-file');
  const envPath = arg('env-file');
  const previousEnv = {
    CRAFT_BRIDGE_URL: process.env.CRAFT_BRIDGE_URL,
    CRAFT_BRIDGE_TOKEN: process.env.CRAFT_BRIDGE_TOKEN,
  };
  const privateDir = createPrivateDirectory();
  const tokenFile = join(privateDir, 'bridge.token');
  const runtimeFile = resolve(runtimePath ?? join(privateDir, 'runtime.json'));
  const envFile = resolve(envPath ?? join(privateDir, 'bridge.env'));
  const paths = new Set([tokenFile, runtimeFile, envFile]);
  if (paths.size !== 3) {
    rmSync(privateDir, { recursive: true, force: true });
    throw new Error('token, runtime, and env files must have distinct paths');
  }

  const createdFiles = [];
  let bridge = null;
  let stopping = false;

  async function cleanup(exitCode) {
    if (stopping) return;
    stopping = true;
    let finalCode = exitCode;
    try {
      if (bridge) await bridge.stop();
    } catch (error) {
      console.error('craft-bridge: shutdown failed:', error.message);
      finalCode = 1;
    } finally {
      for (const path of createdFiles) {
        try { rmSync(path, { force: true }); } catch { /* already removed */ }
      }
      try { rmSync(privateDir, { recursive: true, force: true }); } catch { /* best effort */ }
      restoreEnv('CRAFT_BRIDGE_URL', previousEnv.CRAFT_BRIDGE_URL);
      restoreEnv('CRAFT_BRIDGE_TOKEN', previousEnv.CRAFT_BRIDGE_TOKEN);
      process.exitCode = finalCode;
    }
  }

  const onSignal = () => { void cleanup(0); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  if (process.platform === 'win32') process.once('SIGBREAK', onSignal);

  try {
    const dir = controlDir();
    const found = discoverControlPort(dir);
    if (found.port == null) {
      const candidates = found.candidates?.length ? ' (candidates: ' + found.candidates.join(', ') + ')' : '';
      throw new Error('control port not found; set --control-port / CRAFT_CONTROL_PORT or start SolidCraft with control enabled' + candidates);
    }
    if (!existsSync(tokenPathFor(found.port, dir))) {
      throw new Error('control token file missing for port ' + found.port);
    }

    const bridgePort = parsePort(
      arg('port') ?? process.env.CRAFT_BRIDGE_PORT ?? '0',
      'bridge port',
      true,
    );
    const bearer = randomBytes(32).toString('base64url');
    writePrivateFile(tokenFile, bearer + '\n', createdFiles);
    process.env.CRAFT_BRIDGE_TOKEN = bearer;

    bridge = new CraftBridge({ controlPort: found.port, controlDir: dir });
    await bridge.start(bridgePort);
    if (stopping) return;
    const url = 'http://127.0.0.1:' + bridge.port;
    process.env.CRAFT_BRIDGE_URL = url;

    writePrivateFile(
      envFile,
      'CRAFT_BRIDGE_URL=' + url + '\nCRAFT_BRIDGE_TOKEN=' + bearer + '\n',
      createdFiles,
    );
    writePrivateFile(
      runtimeFile,
      JSON.stringify({
        url,
        port: bridge.port,
        controlPort: found.port,
        tokenFile,
        envFile,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }, null, 2) + '\n',
      createdFiles,
    );

    console.log('craft-bridge: listening on ' + url + ' (control port ' + found.port + ' via ' + found.via + ')');
    console.log('craft-bridge: server env file → ' + envFile);
    console.log('craft-bridge: runtime file → ' + runtimeFile);
  } catch (error) {
    console.error('craft-bridge: startup failed:', error.message);
    await cleanup(1);
    return;
  }
}

await main();

