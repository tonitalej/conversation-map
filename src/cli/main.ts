import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VIEWER_SCRIPT, VIEWER_STYLE } from 'virtual:viewer-assets';
import { run } from './run.ts';

process.exitCode = run(process.argv.slice(2), {
  readText: (path) => readFileSync(path, 'utf8'),
  writeText: (path, content) => writeFileSync(path, content, 'utf8'),
  ensureDir: (path) => mkdirSync(path, { recursive: true }),
  join,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  assets: () => ({ script: VIEWER_SCRIPT, style: VIEWER_STYLE }),
});
