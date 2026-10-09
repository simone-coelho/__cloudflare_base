// node --test scripts/demo-kit/lib/cli.test.mjs
// The kit's command lines as a demo's own scripts call them: the demo's config first and the caller's flags
// after it, unchanged and in order; an environment variable stands for a flag only when the caller did not
// pass that flag; and a module runs its command line only when node was started with it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isEntry, wrappedArgv } from './cli.mjs';
import { argOf, configArg } from './config.mjs';
import { tokenFromArgs } from '../../lib/tool-token.mjs';

test('wrappedArgv puts the config first and passes every caller flag through, in order', () => {
  const argv = ['--base', 'https://edge-platform-vantage.expedge.workers.dev', '--token', 'opaque-value', '--regions', 'here'];
  const wrapped = wrappedArgv('/repo/scripts/demo-kit/configs/vantage.json', argv, { env: {} });
  assert.deepEqual(wrapped, ['--config', '/repo/scripts/demo-kit/configs/vantage.json', ...argv]);
  assert.equal(configArg(wrapped, ['--config', '--base', '--token', '--regions']), '/repo/scripts/demo-kit/configs/vantage.json');
  assert.equal(argOf(wrapped, '--base'), argv[1], 'the kit reads the caller\'s --base');
  assert.equal(argOf(wrapped, '--regions'), 'here');
  assert.equal(tokenFromArgs(wrapped), 'opaque-value', 'and the caller\'s --token, exactly as the Vantage scripts read it');
  assert.deepEqual(wrappedArgv('c.json', [], { env: {} }), ['--config', 'c.json']);
  assert.deepEqual(wrappedArgv('c.json', ['--files-only'], { env: {} }), ['--config', 'c.json', '--files-only']);
});

test('an environment variable stands for a flag only when the caller did not pass that flag', () => {
  const envFlags = { VANTAGE_DEVICE_CACHE: '--cache' };
  const env = { VANTAGE_DEVICE_CACHE: '/tmp/vantage-device-cache' };
  assert.deepEqual(wrappedArgv('c.json', ['--only', 'pixel-11'], { env, envFlags }), ['--config', 'c.json', '--cache', '/tmp/vantage-device-cache', '--only', 'pixel-11']);
  assert.deepEqual(wrappedArgv('c.json', ['--cache', 'mine'], { env, envFlags }), ['--config', 'c.json', '--cache', 'mine'], 'the flag wins over the variable');
  assert.deepEqual(wrappedArgv('c.json', [], { env: {}, envFlags }), ['--config', 'c.json']);
  assert.deepEqual(wrappedArgv('c.json', [], { env: { VANTAGE_DEVICE_CACHE: '' }, envFlags }), ['--config', 'c.json'], 'an empty variable implies nothing');
});

test('isEntry is true only for the script node was started with', () => {
  const me = import.meta.url;
  assert.equal(isEntry(me, ['node', fileURLToPath(me)]), true);
  assert.equal(isEntry(me, ['node', fileURLToPath(new URL('./cli.mjs', me))]), false, 'an imported module does not run its command line');
  assert.equal(isEntry(me, ['node']), false);
});
