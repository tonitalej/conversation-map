// Regenerates the checked-in example outputs with the built CLI.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'plugins/conversation-map/skills/conversation-map/scripts/conversation-map.mjs');
const dir = join(root, 'examples/launch-planning');

const out = execFileSync(
  process.execPath,
  [
    cli,
    'build',
    join(dir, 'transcript.md'),
    join(dir, 'analysis.json'),
    '--out-dir',
    join(dir, 'output'),
    '--name',
    'map',
  ],
  { encoding: 'utf8' },
);
process.stdout.write(out);
