import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function read(name) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

const sandbox = { URL };
runInNewContext(read('../shared.js'), sandbox, { filename: 'shared.js' });
const { YTTools } = sandbox;

const ID = 'jNQXAC9IVRw';

test('cleanTitle keeps a real title and drops blank or huge text', () => {
  assert.equal(YTTools.cleanTitle('  Me \n at   the zoo  '), 'Me at the zoo');
  assert.equal(YTTools.cleanTitle('复制'), '复制');
  assert.equal(YTTools.cleanTitle('a\u200bb'), 'ab');
  assert.equal(YTTools.cleanTitle('   '), '');
  assert.equal(YTTools.cleanTitle('x'.repeat(301)), '');
  assert.equal(YTTools.cleanTitle(null), '');
});

test('sanitizeFilename stays inside one file name', () => {
  assert.equal(YTTools.sanitizeFilename('../etc/passwd', 'png'), 'etc passwd.png');
  assert.equal(YTTools.sanitizeFilename('con', 'webm'), 'youtube-video.webm');
  assert.equal(YTTools.sanitizeFilename('a\u0000b\r\n', 'png'), 'ab.png');
  assert.equal(YTTools.sanitizeFilename('....', 'png'), 'youtube-video.png');
  assert.equal(YTTools.sanitizeFilename('你好', 'webm'), '你好.webm');
  assert.equal(YTTools.sanitizeFilename('video', 'exe'), '');
  assert.equal(YTTools.sanitizeFilename('video', 'png.exe'), '');
  const longName = YTTools.sanitizeFilename('a'.repeat(200), 'png');
  assert.ok(longName.endsWith('.png'));
  assert.ok(longName.length <= 84);
  assert.equal(longName.includes('/'), false);
  assert.equal(longName.includes('\\'), false);
});

test('videoIdFromUrl only accepts YouTube https links', () => {
  assert.equal(YTTools.videoIdFromUrl('https://www.youtube.com/watch?v=' + ID), ID);
  assert.equal(YTTools.videoIdFromUrl('/watch?v=' + ID, 'https://www.youtube.com/feed'), ID);
  assert.equal(YTTools.videoIdFromUrl('https://youtu.be/' + ID), ID);
  assert.equal(YTTools.videoIdFromUrl('https://www.youtube.com/shorts/' + ID), ID);
  assert.equal(YTTools.videoIdFromUrl('https://evil.example/watch?v=' + ID), '');
  assert.equal(YTTools.videoIdFromUrl('http://www.youtube.com/watch?v=' + ID), '');
  assert.equal(YTTools.videoIdFromUrl('javascript:alert(1)'), '');
  assert.equal(YTTools.videoIdFromUrl('https://www.youtube.com/watch?v=short'), '');
  assert.equal(YTTools.videoIdFromUrl('https://user:pass@www.youtube.com/watch?v=' + ID), '');
});

test('extension manifest stays narrow', () => {
  const manifest = JSON.parse(readFileSync(root + 'manifest.json', 'utf8'));
  assert.deepEqual(manifest.permissions, ['clipboardWrite', 'nativeMessaging']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(typeof manifest.key, 'string');
  assert.ok(manifest.key.length > 100);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.youtube.com/*']);
  assert.equal(manifest.content_scripts[0].all_frames, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.content_security_policy.extension_pages.includes('unsafe-eval'), false);
  assert.equal(manifest.content_security_policy.extension_pages.includes('unsafe-inline'), false);
  assert.deepEqual(manifest.content_scripts[0].js, ['shared.js', 'content.js']);
});

test('extension source does not load or execute remote code', () => {
  const source = (read('../content.js') + '\n' + read('../shared.js') + '\n' + read('../manifest.json'))
    .replaceAll('http://www.w3.org/2000/svg', '');
  const banned = [
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /innerHTML/,
    /outerHTML/,
    /insertAdjacentHTML/,
    /document\.write/,
    /window\.postMessage\s*\(/,
    /javascript:/,
    /http:\/\//,
    /<all_urls>/,
    /webRequest/,
    /unsafe-eval/,
    /signatureCipher/,
    /clipboardRead/
  ];
  for (const pattern of banned) {
    assert.equal(pattern.test(source), false, pattern);
  }
  assert.match(read('../content.js'), /yt-lockup-view-model/);
  const content = read('../content.js');
  assert.equal(/MediaRecorder|captureStream|showSaveFilePicker/.test(content), false);
  assert.equal(/addEventListener\(\s*['"]message['"]/.test(content), false);
});

test('background only forwards a video id to the local host', () => {
  const source = read('../background.js');
  assert.match(source, /var HOST = 'com\.youtubetitles\.downloader'/);
  assert.match(source, /connectNative\(HOST\)/);
  assert.match(source, /importScripts\('shared\.js'\)/);
  assert.equal(/\beval\s*\(/.test(source), false);
  assert.equal(/innerHTML/.test(source), false);
  assert.equal(/http:\/\//.test(source), false);
  assert.equal(/<all_urls>/.test(source), false);
  assert.equal(/cookies/i.test(source), false);
  assert.equal(/signatureCipher/.test(source), false);
});

test('download host does not shell out or read browser cookies', () => {
  const source = read('../host/download_host.py');
  assert.equal(/shell\s*=\s*True/.test(source), false);
  assert.equal(/os\.system\(/.test(source), false);
  assert.equal(/cookies-from-browser/.test(source), false);
  assert.equal(/subprocess/.test(source), false);
  assert.match(source, /noplaylist/);
  assert.match(source, /watch\?v=/);
});
