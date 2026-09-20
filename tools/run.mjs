#!/usr/bin/env node
/**
 * run.mjs — Unified CLI for Canteen screenshot capture + PowerPoint generation.
 *
 * Usage:
 *   node run.mjs capture  [options]   — take screenshots only
 *   node run.mjs build    [options]   — build PPTX from existing screenshots
 *   node run.mjs all      [options]   — capture then build (default when no command)
 *
 * Options (all optional):
 *   --url      http://localhost:8080     Base URL of the running Canteen Manager
 *   --user     admin                     Login username
 *   --pass     admin12345               Login password
 *   --out      ./screenshots             Screenshot output directory
 *   --pptx     ./CANTEEN-DEMO.pptx      Output PowerPoint file
 *   --width    1440                      Viewport width
 *   --height   900                       Viewport height
 *   --title    "Phần mềm..."            Presentation title override
 *
 * Examples:
 *   node run.mjs all --url http://10.0.0.5:8080 --pass MySecret
 *   node run.mjs capture --url http://localhost:8080
 *   node run.mjs build --out ./screenshots --pptx ./slides.pptx
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Parse command ────────────────────────────────────────────────────────────
const rawArgs  = process.argv.slice(2);
const COMMANDS = ['capture', 'build', 'all'];

let command  = 'all';
let restArgs = rawArgs;

if (rawArgs.length > 0 && COMMANDS.includes(rawArgs[0])) {
  command  = rawArgs[0];
  restArgs = rawArgs.slice(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getArg(flag, def) {
  const idx = restArgs.indexOf(flag);
  return idx !== -1 && restArgs[idx + 1] ? restArgs[idx + 1] : def;
}

const SCREENSHOTS_DIR = getArg('--out',   './screenshots');
const PPTX_FILE       = getArg('--pptx',  './CANTEEN-DEMO.pptx');

/**
 * Run a Node.js script synchronously, inheriting stdio.
 * Exits the process with the child exit code on failure.
 *
 * @param {string} script  path to .mjs file
 * @param {string[]} args  arguments to forward
 */
function run(script, args) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Running: node ${path.basename(script)} ${args.join(' ')}`);
  console.log(`${'─'.repeat(60)}\n`);

  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    cwd: __dirname,
    env: { ...process.env },
  });

  if (result.status !== 0) {
    console.error(`\n✗ Script failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
const captureScript = path.join(__dirname, 'capture.mjs');
const buildScript   = path.join(__dirname, 'build-pptx.mjs');

// Forward all original flags to the sub-scripts
const captureArgs = [...restArgs];
const buildArgs   = ['--screenshots', SCREENSHOTS_DIR, '--out', PPTX_FILE, ...restArgs];

switch (command) {
  case 'capture':
    run(captureScript, captureArgs);
    break;

  case 'build':
    run(buildScript, buildArgs);
    break;

  case 'all':
  default:
    run(captureScript, captureArgs);
    run(buildScript,   buildArgs);
    break;
}

console.log('\n✔ All done.\n');
