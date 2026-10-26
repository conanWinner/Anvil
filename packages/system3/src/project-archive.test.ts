import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { extractProjectArchive, validateProjectArchive } from './project-archive';

function archive(
  members: Array<{
    name: string;
    type: number;
    content?: string;
    prefix?: string;
    magic?: 'ustar' | 'gnu' | 'unsupported';
  }>
): Uint8Array {
  const blocks: Buffer[] = [];
  for (const { name, type, content = '', prefix = '', magic = 'ustar' } of members) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000600\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(32, 148, 156);
    header[156] = type;
    header.write(
      magic === 'gnu' ? 'ustar ' : magic === 'unsupported' ? 'other\0' : 'ustar\0',
      257,
      6,
      'ascii'
    );
    header.write(magic === 'gnu' ? ' \0' : '00', 263, 2, 'ascii');
    header.write(prefix, 345, 155, 'utf8');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    const body = Buffer.from(content);
    const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
    body.copy(padded);
    blocks.push(header, padded);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

test('project archive validates paths, links, bounds, duplicates and overwrite safety', async () => {
  expect(() =>
    validateProjectArchive(archive([{ name: 'root/../escape', type: 48, content: 'x' }]))
  ).toThrow('unsafe or duplicate path');
  expect(() => validateProjectArchive(archive([{ name: 'root/link', type: 50 }]))).toThrow(
    'link or unsupported'
  );
  expect(() =>
    validateProjectArchive(archive([{ name: 'file', prefix: '../outside', type: 48 }]))
  ).toThrow('unsafe or duplicate path');
  expect(() =>
    validateProjectArchive(archive([{ name: 'root/file', magic: 'unsupported', type: 48 }]))
  ).toThrow('unsupported header format');
  expect(
    validateProjectArchive(archive([{ name: 'λ.txt', prefix: 'root/資料', type: 48 }]))[0]?.path
  ).toBe('資料/λ.txt');
  expect(
    validateProjectArchive(
      archive([{ name: 'root/file', prefix: '../escape', magic: 'gnu', type: 48 }])
    )[0]?.path
  ).toBe('file');
  expect(() =>
    validateProjectArchive(
      archive([
        { name: 'root/file', type: 48, content: 'a' },
        { name: 'root/file', type: 48, content: 'b' },
      ])
    )
  ).toThrow('unsafe or duplicate path');
  expect(() => validateProjectArchive(new Uint8Array(64 * 1024 * 1024 + 1))).toThrow(
    'compressed-size limit'
  );
  expect(() => validateProjectArchive(gzipSync(Buffer.alloc(128 * 1024 * 1024 + 512)))).toThrow(
    'expanded-size limit'
  );
  const tooLarge = archive([{ name: 'root/file', type: 48 }]);
  const tar = gunzipSync(tooLarge);
  tar.write('40000000100\0', 124, 12, 'ascii');
  tar.fill(32, 148, 156);
  tar.write(
    `${tar
      .subarray(0, 512)
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, '0')}\0 `,
    148,
    8,
    'ascii'
  );
  expect(() => validateProjectArchive(gzipSync(tar))).toThrow('file-size limit');
  const manyEntries = archive(
    Array.from({ length: 4097 }, (_, index) => ({ name: `root/file-${index}`, type: 48 }))
  );
  expect(() => validateProjectArchive(manyEntries)).toThrow('entry-count limit');
  const root = await mkdtemp(join(tmpdir(), 'system3-archive-'));
  try {
    const destination = join(root, 'project');
    await extractProjectArchive(
      archive([{ name: 'root/reports/result.json', type: 48, content: '{"ok":true}' }]),
      destination,
      new AbortController().signal
    );
    expect(await readFile(join(destination, 'reports/result.json'), 'utf8')).toBe('{"ok":true}');
    await expect(
      extractProjectArchive(
        archive([{ name: 'root/overwrite', type: 48, content: 'bad' }]),
        destination,
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(await readFile(join(destination, 'reports/result.json'), 'utf8')).toBe('{"ok":true}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('GNU tar archive extracts and runs from a fresh package directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'system3-reproduction-'));
  try {
    const source = join(root, 'generated_project');
    await mkdir(join(source, 'tests'), { recursive: true });
    await writeFile(
      join(source, 'tests', 'test_portable.py'),
      'import unittest\nclass Portable(unittest.TestCase):\n def test_runs(self): self.assertEqual(2 + 2, 4)\n'
    );
    const tar = Bun.spawn(
      [
        'tar',
        '--format=gnu',
        '-czf',
        join(root, 'project.tar.gz'),
        '-C',
        root,
        'generated_project',
      ],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    expect(await tar.exited).toBe(0);
    const bytes = await readFile(join(root, 'project.tar.gz'));
    const destination = join(root, 'extracted');
    await extractProjectArchive(bytes, destination, new AbortController().signal);
    const process = Bun.spawn(['python3', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], {
      cwd: destination,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(`${stdout}${stderr}`).toContain('Ran 1 test');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
