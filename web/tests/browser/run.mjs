import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export const groups = {
  sheets: ['sheets', 'sheet-lifecycle'],
  tokens: ['tokens', 'network'],
  scenes: ['scenes', 'auth'],
  interaction: ['chat-dice', 'ui', 'smoke', 'design-system', 'components-v03', 'initiative', 'catalog'],
};
export const suites = Object.values(groups).flat();
const args = process.argv.slice(2);
let selected = suites;
if (args.length) {
  if (args.length !== 2 || !['--suite', '--group'].includes(args[0])) {
    throw Error('Usage: node tests/browser/run.mjs [--suite NAME | --group NAME]');
  }
  selected = args[0] === '--group' ? groups[args[1]] : suites.includes(args[1]) ? [args[1]] : undefined;
  if (!selected) throw Error(`Unknown browser selection: ${args[1]}`);
}
const files = selected.map(name => fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url)));
const reporters = [];
if (process.env.BROWSER_JUNIT) {
  mkdirSync(dirname(process.env.BROWSER_JUNIT), {recursive: true});
  rmSync(process.env.BROWSER_JUNIT, {force: true});
  reporters.push('--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${process.env.BROWSER_JUNIT}`);
}
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...reporters, ...files], {stdio: 'inherit', env: process.env});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
