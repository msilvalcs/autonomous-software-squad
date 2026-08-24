import { writeFile } from 'node:fs/promises';
await writeFile('build-output.txt', 'built\n');
