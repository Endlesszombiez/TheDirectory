import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  uploadFile,
  downloadFile,
  deleteFile,
  listFiles,
  FilesError,
} from '../src/lib/files';

test('streamed limits clean partial uploads and linked folders cannot escape file storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'directory-files-security-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  const settings = {
    pinHash: '',
    maxFileMB: 1,
    allowedExtensions: '.txt',
    autoUpload: false,
    showFileList: true,
  };
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(800000));
        controller.enqueue(new Uint8Array(800000));
        controller.close();
      },
    });
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    await assert.rejects(
      uploadFile(request, 'too-large.txt', settings),
      (error) => error instanceof FilesError && error.status === 413,
    );
    assert.deepEqual(await readdir(join(directory, 'file-staging')), []);
    assert.equal((await listFiles()).totalFiles, 0);
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'private.txt'), 'private');
    await symlink(
      outside,
      join(directory, 'files', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    assert.equal((await listFiles()).entries.length, 0);
    await assert.rejects(downloadFile('linked/private.txt'), FilesError);
    await assert.rejects(deleteFile('linked'), FilesError);
    await assert.rejects(
      uploadFile(
        new Request('http://localhost/upload', {
          method: 'POST',
          body: 'overwrite',
        }),
        'linked/private.txt',
        settings,
      ),
      FilesError,
    );
    assert.equal(
      await readFile(join(outside, 'private.txt'), 'utf8'),
      'private',
    );
    assert.deepEqual(await readdir(join(directory, 'file-staging')), []);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
