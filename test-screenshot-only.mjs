// Minimal, non-destructive smoke test: spawn the built server, request one
// screenshot, confirm we get image data back. Deliberately avoids test.ts's
// click/type/keypress tests, which are unsafe to run against a live
// interactive desktop (stargazer) rather than a dedicated automation box.
import { spawn } from 'child_process';

const env = { ...process.env };
const server = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'pipe'], env });

let resolved = false;
const timeout = setTimeout(() => {
  if (!resolved) {
    console.error('FAILED: timed out waiting for VNC connection / screenshot');
    server.kill('SIGTERM');
    process.exit(1);
  }
}, 20000);

server.stderr.on('data', (data) => {
  process.stderr.write(`[server] ${data}`);
});

// Connections are made lazily per tool call, not at server startup - just
// give the process a moment to finish booting, then send the request.
setTimeout(() => {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'vnc_screenshot', arguments: {} }
  };
  server.stdin.write(JSON.stringify(request) + '\n');
}, 1000);

let buf = '';
server.stdout.on('data', (data) => {
  buf += data.toString();
  try {
    const response = JSON.parse(buf);
    if (response.id === 1) {
      resolved = true;
      clearTimeout(timeout);
      const content = response.result && response.result.content;
      const image = content && content.find((c) => c.type === 'image');
      if (image && image.data) {
        console.log(`PASSED: got screenshot, ${Buffer.from(image.data, 'base64').length} bytes`);
        server.kill('SIGTERM');
        process.exit(0);
      } else {
        console.error('FAILED: no image data in response', JSON.stringify(response));
        server.kill('SIGTERM');
        process.exit(1);
      }
    }
  } catch (e) {
    // partial data, keep buffering
  }
});

server.on('error', (err) => {
  console.error('FAILED: server process error', err);
  process.exit(1);
});
