#!/usr/bin/env node
/**
 * Consolidated test runner for CloudStream 3 Desktop.
 *
 * Runs test suites using Node's native type stripping (`--experimental-strip-types`).
 * Supports running all tests, single tests, or multiple selected tests by alias,
 * file path, or pattern match.
 *
 * Usage:
 *   bun run test                    # run all test suites
 *   bun run test ipc                # run single suite by alias
 *   bun run test ipc backup format  # run multiple suites
 *   bun run test torrent            # run all suites matching "torrent"
 *   bun run test --fast             # run all suites skipping slow integration tests
 *   bun run test --list             # list all available suites and aliases
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Resolve directory roots
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

// Slow tests that spawn external processes (ffmpeg transcoding, mpv player)
const SLOW_TESTS = new Set([
  'electron/media/pipeline.test.mts',
  'electron/media/mpvEngine.test.mts',
]);

// Known preset aliases mapped from the legacy package.json scripts
const PRESET_ALIASES = {
  ipc: ['electron/ipcSurface.test.mts'],
  address: ['electron/cs3/extensionAddress.test.mts'],
  backup: ['electron/cs3/backupService.test.mts'],
  recovery: ['electron/cs3/providerRecovery.test.mts'],
  media: [
    'electron/media/decisionEngine.test.mts',
    'electron/cs3/webViewMatch.test.mts',
  ],
  pipeline: ['electron/media/pipeline.test.mts'],
  lease: ['electron/media/sourceLease.test.mts'],
  telemetry: ['electron/media/playbackTelemetry.test.mts'],
  container: ['electron/media/containerInspection.test.mts'],
  native: ['electron/media/mpvEngine.test.mts'],
  cache: ['electron/sourceCache.test.mts'],
  links: ['electron/cs3/providerLinks.test.mts'],
  webview: ['electron/cs3/webViewMatch.test.mts'],
  'source-scope': ['electron/cs3/sourceScope.test.mts'],
  'torrent-metadata': ['electron/torrent/torrentMetadata.test.mts'],
  'torrent-contents': ['electron/torrent/torrentContents.test.mts'],
  swarm: ['electron/torrent/swarmHealth.test.mts'],
  format: ['src/utils/format.test.mts'],
  home: ['electron/cs3/homeProviders.test.mts'],
  export: ['src/utils/sourceExport.test.mts'],
  'subtitle-style': ['src/utils/subtitleStyle.test.mts'],
  proxy: ['electron/mediaProxy.test.mts'],
  subtitles: ['electron/subtitles/convert.test.mts'],
  log: ['electron/logging/logger.test.mts'],
  'sidecar-log': ['electron/cs3/sidecarStderr.test.mts'],
  'played-source': ['electron/cs3/playedSource.test.mts'],
  'download-identity': ['src/utils/downloadIdentity.test.mts'],
  issues: ['electron/cs3/extensionIssues.test.mts'],
  history: ['src/utils/historyGrouping.test.mts'],
  'history-export': ['src/utils/historyExport.test.mts'],
  registry: ['electron/cs3/providerRegistry.test.mts'],
  'direct-sources': ['electron/torrent/indexers/directSources.test.mts'],
  ytdlp: ['electron/ytdlpSources.test.mts'],
  repositories: ['electron/officialRepositories.test.mts'],
  ott: ['electron/cs3/ottPlatforms.test.mts'],
  resume: ['electron/download/resumePlan.test.mts'],
  'resume-window': ['electron/download/resumeWindow.test.mts'],
  reachability: ['src/componentReachability.test.mts'],
  'settings-level': ['src/components/settings/settingsLevel.test.mts'],
  'dead-rows': ['src/utils/deadRows.test.mts'],
  'playback-recovery': ['src/components/player/playbackRecovery.test.mts'],
  'indexer-budget': ['electron/torrent/indexerBudget.test.mts'],
  'bot-challenge': ['electron/torrent/botChallenge.test.mts'],
  'source-profiles': ['electron/cs3/sourceProfiles.test.mts'],
  'failure-taxonomy': ['electron/cs3/failureTaxonomy.test.mts'],
  'provider-health': ['src/components/search/providerHealth.test.mts'],
  'host-deadline': ['electron/cs3/hostDeadline.test.mts'],
  'native-providers': ['electron/cs3/nativeProviders.test.mts'],
  discovery: ['electron/sharedDiscovery.test.mts'],
  'shared-discovery': ['electron/sharedDiscovery.test.mts'],
  updater: ['electron/cs3/extensionUpdater.test.mts'],
};

// Colors for terminal output
const useColor = !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);
const c = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  green: useColor ? '\x1b[32m' : '',
  red: useColor ? '\x1b[31m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  gray: useColor ? '\x1b[90m' : '',
};

/**
 * Recursively discover all test files in project.
 */
function discoverTests(dir) {
  const IGNORE_DIRS = new Set([
    'node_modules',
    'dist',
    'dist-electron',
    'release',
    'media-runtime',
    'logs',
    '.git',
  ]);

  const results = [];
  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          scan(path.join(currentDir, entry.name));
        }
      } else if (
        entry.name.endsWith('.test.mts') ||
        entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.test.js') ||
        entry.name.endsWith('.test.mjs')
      ) {
        const full = path.join(currentDir, entry.name);
        const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
        results.push(rel);
      }
    }
  }

  scan(dir);
  results.sort();
  return results;
}

/**
 * Convert camelCase or PascalCase to kebab-case.
 */
function toKebabCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Build mapping of alias -> test file(s).
 */
function buildAliasIndex(allFiles) {
  const index = new Map();

  // 1. Add preset aliases
  for (const [alias, files] of Object.entries(PRESET_ALIASES)) {
    index.set(alias.toLowerCase(), files);
  }

  // 2. Add automatic aliases based on file names
  for (const file of allFiles) {
    const baseWithExt = path.basename(file);
    const baseName = baseWithExt.replace(/\.test\.(mts|ts|js|mjs)$/, '');
    const kebab = toKebabCase(baseName);
    const lower = baseName.toLowerCase();

    if (!index.has(kebab)) index.set(kebab, [file]);
    if (!index.has(lower)) index.set(lower, [file]);
    if (!index.has(baseName)) index.set(baseName, [file]);
    if (!index.has(file)) index.set(file, [file]);
  }

  return index;
}

/**
 * Find primary alias for a file (for list display).
 */
function findPrimaryAlias(file) {
  for (const [alias, files] of Object.entries(PRESET_ALIASES)) {
    if (files.length === 1 && files[0] === file) {
      return alias;
    }
  }
  const baseWithExt = path.basename(file);
  const baseName = baseWithExt.replace(/\.test\.(mts|ts|js|mjs)$/, '');
  return toKebabCase(baseName);
}

/**
 * Match user query against available tests and aliases.
 */
function resolveQuery(query, allFiles, aliasIndex) {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const qNormalized = q.replace(/\\/g, '/').toLowerCase();

  // 1. Exact alias match
  if (aliasIndex.has(qLower)) {
    return aliasIndex.get(qLower);
  }

  // 2. Exact file path match
  for (const f of allFiles) {
    if (f.toLowerCase() === qNormalized) return [f];
  }

  // 3. Basename match
  const matchedByBasename = allFiles.filter((f) => {
    const base = path.basename(f).replace(/\.test\.(mts|ts|js|mjs)$/, '');
    return (
      base.toLowerCase() === qLower ||
      toKebabCase(base) === qLower ||
      path.basename(f).toLowerCase() === qLower
    );
  });
  if (matchedByBasename.length > 0) {
    return matchedByBasename;
  }

  // 4. Wildcard / Substring match
  const matchedBySubstr = allFiles.filter((f) => {
    const fLower = f.toLowerCase();
    if (q.includes('*')) {
      const regex = new RegExp(
        '^' + q.split('*').map((s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('.*') + '$',
        'i'
      );
      return regex.test(f) || regex.test(path.basename(f));
    }
    return fLower.includes(qNormalized) || path.basename(fLower).includes(qLower);
  });

  return matchedBySubstr;
}

/**
 * Parse CLI flags and filter arguments.
 */
function parseArgs(argv) {
  const options = {
    all: false,
    list: false,
    bail: false,
    verbose: false,
    quiet: false,
    fast: false,
    slowOnly: false,
    help: false,
    filters: [],
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all' || arg === '-a') {
      options.all = true;
    } else if (arg === '--list' || arg === '-l') {
      options.list = true;
    } else if (arg === '--bail' || arg === '-b') {
      options.bail = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--fast') {
      options.fast = true;
    } else if (arg === '--slow' || arg === '--slow-only') {
      options.slowOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--filter=') || arg.startsWith('-f=')) {
      options.filters.push(arg.split('=')[1]);
    } else if (arg === '--filter' || arg === '-f') {
      if (i + 1 < args.length) options.filters.push(args[++i]);
    } else if (arg.startsWith('--select=') || arg.startsWith('-s=')) {
      options.filters.push(...arg.split('=')[1].split(','));
    } else if (arg === '--select' || arg === '-s') {
      if (i + 1 < args.length) options.filters.push(...args[++i].split(','));
    } else if (arg.startsWith('--match=') || arg.startsWith('-m=')) {
      options.filters.push(arg.split('=')[1]);
    } else if (arg === '--match' || arg === '-m') {
      if (i + 1 < args.length) options.filters.push(args[++i]);
    } else if (arg.startsWith('-')) {
      console.warn(`${c.yellow}Unknown option: ${arg}${c.reset}`);
    } else {
      // Positional filter (supports comma-separated values like `ipc,backup`)
      if (arg.includes(',')) {
        options.filters.push(...arg.split(','));
      } else {
        options.filters.push(arg);
      }
    }
  }

  return options;
}

/**
 * Print help documentation.
 */
function printHelp(allFiles) {
  console.log(`
${c.bold}CloudStream 3 Desktop — Test Runner${c.reset}

${c.cyan}Usage:${c.reset}
  bun run test [options] [filters...]
  bun run test:electron [options] [filters...]
  node scripts/test-runner.mjs [options] [filters...]

${c.cyan}Modes:${c.reset}
  ${c.bold}All tests:${c.reset}
    bun run test                          Run all ${allFiles.length} test suites

  ${c.bold}Single test:${c.reset}
    bun run test ipc                      Run suite by alias
    bun run test format                   Run suite by name
    bun run test electron/ipcSurface.test.mts   Run suite by path

  ${c.bold}Multiple selected tests:${c.reset}
    bun run test ipc backup recovery      Run multiple suites by space-separated aliases
    bun run test ipc,backup,format        Run multiple suites by comma-separated aliases
    bun run test --select=ipc,backup      Run multiple suites with --select

  ${c.bold}Pattern / Group matching:${c.reset}
    bun run test torrent                  Run all suites with "torrent" in path/name
    bun run test media                    Run decisionEngine and webViewMatch
    bun run test src/utils                Run all utility suites

  ${c.bold}Fast execution (skips ffmpeg/mpv integration tests):${c.reset}
    bun run test --fast                   Run 40 unit suites in ~5 seconds

${c.cyan}Options:${c.reset}
  -l, --list             List all discovered test suites and aliases
  -a, --all              Run all test suites
  -b, --bail             Exit immediately on first test failure
  -v, --verbose          Stream full stdout/stderr of each suite as it runs
  -q, --quiet            Quiet mode; only print failures and summary
  -f, --filter <pattern> Filter test suites by pattern
  -s, --select <items>   Comma-separated list of test suites
      --fast             Skip slow integration tests (pipeline, native mpvEngine)
      --slow             Run only slow integration tests
  -h, --help             Show this help guide
`);
}

/**
 * Print list of all discovered test suites and primary aliases.
 */
function printList(allFiles) {
  console.log(`\n${c.bold}Available Test Suites (${allFiles.length} total):${c.reset}\n`);
  console.log(`  ${c.dim}${'Alias'.padEnd(22)} ${'Type'.padEnd(8)} Path${c.reset}`);
  console.log(`  ${''.padEnd(70, '-')}`);

  for (const file of allFiles) {
    const alias = findPrimaryAlias(file);
    const isSlow = SLOW_TESTS.has(file);
    const slowTag = isSlow ? `${c.yellow}slow${c.reset}` : `${c.dim}fast${c.reset}`;
    console.log(`  ${c.cyan}${alias.padEnd(22)}${c.reset} ${slowTag.padEnd(8)} ${file}`);
  }

  console.log(`\n${c.dim}Run any suite with: bun run test <alias>${c.reset}\n`);
}

/**
 * Run a single test file as a child process.
 */
function runTestFile(file, streamOutput) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const args = ['--experimental-strip-types', file];

    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: streamOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (!streamOutput) {
      if (child.stdout) {
        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
      }
      if (child.stderr) {
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
      }
    }

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      resolve({
        file,
        code: code ?? 1,
        duration,
        stdout,
        stderr,
      });
    });

    child.on('error', (err) => {
      const duration = Date.now() - startTime;
      resolve({
        file,
        code: 1,
        duration,
        stdout,
        stderr: (stderr ? stderr + '\n' : '') + err.message,
      });
    });
  });
}

/**
 * Main execution.
 */
async function main() {
  const allFiles = discoverTests(projectRoot);
  const aliasIndex = buildAliasIndex(allFiles);
  const options = parseArgs(process.argv);

  if (options.help) {
    printHelp(allFiles);
    return;
  }

  if (options.list) {
    printList(allFiles);
    return;
  }

  // Determine which files to run
  let selectedFiles = [];

  if (options.filters.length > 0) {
    const matchedSet = new Set();
    const notFound = [];

    for (const filter of options.filters) {
      const matches = resolveQuery(filter, allFiles, aliasIndex);
      if (matches.length === 0) {
        notFound.push(filter);
      } else {
        for (const m of matches) matchedSet.add(m);
      }
    }

    if (notFound.length > 0) {
      console.error(
        `\n${c.red}Error: No test suites matched: ${notFound.map((f) => `"${f}"`).join(', ')}${c.reset}`
      );
      console.error(`${c.dim}Run "bun run test --list" to view all available test suites.${c.reset}\n`);
      process.exit(1);
    }

    selectedFiles = Array.from(matchedSet);
  } else {
    // Run all discovered tests
    selectedFiles = [...allFiles];
  }

  // Filter fast/slow if flags provided
  if (options.fast) {
    selectedFiles = selectedFiles.filter((f) => !SLOW_TESTS.has(f));
  } else if (options.slowOnly) {
    selectedFiles = selectedFiles.filter((f) => SLOW_TESTS.has(f));
  }

  if (selectedFiles.length === 0) {
    console.log(`${c.yellow}No test files selected to run.${c.reset}`);
    return;
  }

  const isSingle = selectedFiles.length === 1;
  const shouldStream = (isSingle && !options.quiet) || options.verbose;

  if (!options.quiet) {
    console.log(
      `\n${c.bold}Running ${selectedFiles.length} of ${allFiles.length} test suite(s)...${c.reset}\n`
    );
  }

  const overallStart = Date.now();
  let passedCount = 0;
  let failedCount = 0;
  const failedSuites = [];

  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    const indexStr = `[${i + 1}/${selectedFiles.length}]`;

    if (shouldStream) {
      console.log(`${c.bold}${c.cyan}RUN ${indexStr} ${file}${c.reset}`);
    }

    const res = await runTestFile(file, shouldStream);

    if (res.code === 0) {
      passedCount++;
      if (!options.quiet) {
        const timeStr = `${res.duration}ms`;
        console.log(
          `  ${c.green}✓ PASS${c.reset} ${c.dim}${indexStr}${c.reset} ${file} ${c.gray}(${timeStr})${c.reset}`
        );
      }
    } else {
      failedCount++;
      failedSuites.push(file);
      const timeStr = `${res.duration}ms`;
      console.error(
        `  ${c.red}✕ FAIL${c.reset} ${c.dim}${indexStr}${c.reset} ${c.bold}${file}${c.reset} ${c.gray}(${timeStr})${c.reset}`
      );

      if (!shouldStream) {
        if (res.stdout.trim()) {
          console.error(`\n${c.dim}--- stdout ---${c.reset}\n${res.stdout.trim()}`);
        }
        if (res.stderr.trim()) {
          console.error(`\n${c.red}--- stderr ---${c.reset}\n${res.stderr.trim()}`);
        }
        console.error('');
      }

      if (options.bail) {
        console.error(`\n${c.yellow}Bailing after first failure.${c.reset}\n`);
        break;
      }
    }
  }

  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(2);
  const totalRan = passedCount + failedCount;

  console.log(`\n${''.padEnd(65, '-')}`);
  if (failedCount === 0) {
    console.log(
      `${c.bold}${c.green}Test Suites: ${passedCount} passed, ${totalRan} total${c.reset}`
    );
  } else {
    console.log(
      `${c.bold}${c.red}Test Suites: ${failedCount} failed${c.reset}, ${c.green}${passedCount} passed${c.reset}, ${totalRan} total`
    );
    console.log(`\n${c.bold}Failed suites:${c.reset}`);
    for (const f of failedSuites) {
      console.log(`  ${c.red}✕${c.reset} ${f}`);
    }
  }
  console.log(`${c.dim}Duration:    ${totalDuration}s${c.reset}`);
  console.log(`${''.padEnd(65, '-')}\n`);

  process.exit(failedCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`Unexpected test runner error: ${err.message}`);
  process.exit(1);
});
