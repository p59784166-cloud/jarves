import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jerver-files-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.MAX_UPLOAD_BYTES = '5';

test('file save/read/delete', async () => {
  const F = await import('../../backend/services/fileService.mjs');
  const rec = F.saveUploadedFile({ originalName: 'a.txt', buffer: Buffer.from('hello'), mime: 'text/plain' });
  assert.ok(rec.id);
  const content = F.readFileContent(rec.id);
  assert.equal(content.content, 'hello');
  assert.equal(F.deleteFile(rec.id), true);
});

test('file validation traversal name', async () => {
  const F = await import('../../backend/services/fileService.mjs');
  assert.throws(() => F.validateFileMeta('../x', 10, 'text/plain'), /invalido/i);
});

test('file size limit', async () => {
  process.env.MAX_UPLOAD_BYTES = '5';
  const F = await import('../../backend/services/fileService.mjs');
  assert.throws(() => F.validateFileMeta('a.txt', 10, 'text/plain'), /excede/i);
});

test('network file is streamed to storage and respects the configured upload limit', async () => {
  const F = await import('../../backend/services/fileService.mjs');
  const rec = await F.saveUploadedFileStream({
    originalName: 'download.bin',
    stream: Readable.from([Buffer.from([0, 1, 2, 255, 254])]),
    mime: 'application/octet-stream',
  });
  assert.equal(rec.size, 5);
  assert.deepEqual(F.readFileBuffer(rec.id).buffer, Buffer.from([0, 1, 2, 255, 254]));
  const exported = F.createFileReadStream(rec.id);
  let exportedBytes = Buffer.alloc(0);
  for await (const chunk of exported.stream) exportedBytes = Buffer.concat([exportedBytes, chunk]);
  assert.deepEqual(exportedBytes, Buffer.from([0, 1, 2, 255, 254]));
  await assert.rejects(F.saveUploadedFileStream({
    originalName: 'too-large.bin', stream: Readable.from([Buffer.from('123456')]), mime: 'application/octet-stream',
  }), error => error.status === 413);
  assert.equal(F.listFileRecords().some(file => file.name === 'too-large.bin'), false);
});

test('network downloader only accepts public IP addresses', async () => {
  const { isPublicAddress } = await import('../../backend/services/networkDownloadService.mjs');
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPublicAddress(address), false, `${address} must be blocked`);
  }
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicAddress('::ffff:127.0.0.1'), false);
});
