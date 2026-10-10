#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { extractFile } = require('@electron/asar');

async function main() {
  const asar = resolve(process.argv[2] || '');
  const exeIndex = process.argv.indexOf('--exe');
  assert(exeIndex > 0 && process.argv[exeIndex + 1], 'Usage: verify-startup.cjs <app.asar> --exe <packaged executable>');
  const exe = resolve(process.argv[exeIndex + 1]);
  await fs.access(asar);
  await fs.access(exe);
  const expectedAsar = process.platform === 'darwin'
    ? resolve(exe, '..', '..', 'Resources', 'app.asar')
    : resolve(exe, '..', 'resources', 'app.asar');
  assert.equal(await fs.realpath(asar), await fs.realpath(expectedAsar), 'The archive must belong to the selected packaged executable');
  const metadata = JSON.parse(extractFile(asar, 'package.json').toString());
  const profile = await fs.mkdtemp(join(tmpdir(), 'md-duck-startup-'));
  const root = join(profile, 'library', '文章 启动');
  const source = join(root, 'intro.md');
  const report = join(profile, 'startup-check.json');
  const checks = [];
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(source, '# Startup check\n\nA local article restored after startup.');
    await fs.writeFile(join(root, 'intro.zh.md'), '# 启动检查\n\n启动后恢复的本地文章。');
    await fs.writeFile(join(profile, 'settings.json'), JSON.stringify({
      root, openPath: source, scroll: {}, openRouterKey: null,
      prefs: { fontSize: 18, mode: 'bilingual', sidebar: true, sidebarTab: 'files', voice: 'af_heart', speed: 1, model: 'openai/gpt-4.1-mini', ui: 'en' }
    }));
    // A fresh process and then the same persisted profile, without activation or debugging flags.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await fs.rm(report, { force: true });
      const env = { ...process.env, MD_DUCK_PROFILE_DIR: profile, MD_DUCK_STARTUP_CHECK_REPORT: report };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.NODE_OPTIONS;
      const child = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let exit, spawnError;
      child.once('error', error => { spawnError = error; });
      const ended = new Promise(resolve => child.once('exit', (code, signal) => { exit = { code, signal }; resolve(); }));
      // This profile contains no user data. Drain streams so a diagnostic cannot block startup.
      child.stdout.on('data', () => {});
      child.stderr.on('data', () => {});
      try {
        const deadline = Date.now() + 45000;
        let result;
        while (Date.now() < deadline) {
          if (spawnError) throw spawnError;
          if (exit) throw new Error(`Application exited before startup completed: ${JSON.stringify(exit)}`);
          result = await fs.readFile(report, 'utf8').then(JSON.parse).catch(() => null);
          if (result && ['window-visible', 'renderer-loaded', 'initialized', 'state-served', 'document-restored'].every(key => Number.isFinite(result.markers[key]))) break;
          await delay(100);
        }
        assert(result && Number.isFinite(result.markers['document-restored']), 'Timed out waiting for the packaged reader to restore an article');
        assert.equal(result.version, metadata.version, 'The running app must match the selected archive version');
        assert(result.markers['window-visible'] < result.markers.initialized, 'The window must appear before profile/library initialization completes');
        assert(result.markers['window-visible'] < 5000, 'The native window took over 5 seconds to appear');
        const settings = JSON.parse(await fs.readFile(join(profile, 'settings.json'), 'utf8'));
        assert.equal(settings.root, root);
        assert.equal(settings.openPath, source);
        assert.equal(settings.prefs.mode, 'bilingual');
        assert.equal(await fs.readFile(source, 'utf8'), '# Startup check\n\nA local article restored after startup.');
        checks.push({ attempt, ...result });
      } finally {
        if (!exit && child.pid) {
          child.kill('SIGTERM');
          await Promise.race([ended, delay(5000)]);
          if (!exit) { child.kill('SIGKILL'); await ended; }
        }
      }
    }
    console.log(JSON.stringify({ package: asar, executable: exe, checks, isolatedProfile: true, scope: 'Real packaged window startup, renderer load and article restoration; no manual Windows usability or audio playback acceptance.' }, null, 2));
  } finally { await fs.rm(profile, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
