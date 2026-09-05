import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const commands = [['server/index.mjs'], ['node_modules/vite/bin/vite.js']];
const processes = commands.map(args => spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env }));
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; for (const child of processes) child.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const child of processes) child.on('exit', code => { stop(); process.exitCode = code || 0; });
