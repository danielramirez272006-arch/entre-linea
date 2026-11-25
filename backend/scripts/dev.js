import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const backendProc = spawn(npmCmd, ['run', 'dev', '--workspace=backend'], { stdio: 'inherit' });
const frontendProc = spawn(npmCmd, ['run', 'dev', '--workspace=frontend'], { stdio: 'inherit' });

function stopAll() {
  if (!backendProc.killed) backendProc.kill();
  if (!frontendProc.killed) frontendProc.kill();
}

process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

backendProc.on('exit', (code) => {
  if (code && code !== 0) {
    stopAll();
    process.exit(code);
  }
});
frontendProc.on('exit', (code) => {
  if (code && code !== 0) {
    stopAll();
    process.exit(code);
  }
});
