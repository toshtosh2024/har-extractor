import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const source = html.match(/<script id="har-core">([\s\S]*?)<\/script>/)?.[1];
assert.ok(source);
const context = vm.createContext({
  atob,
  btoa,
  TextEncoder,
  TextDecoder,
  URL,
  console
});
vm.runInContext(source, context);
const C = context.HarCore;
try {
  await access(new URL('./sample.har', import.meta.url));
} catch {
  await import('./make-sample-har.mjs');
}
const sample = await readFile(new URL('./sample.har', import.meta.url), 'utf8');
const entries = C.parseHar(sample);
const plain = value => JSON.parse(JSON.stringify(value));
const fixture = (url, mime = 'text/plain') => ({
  url,
  mime
});

test('sample parsing, MIME, categories, body flags and size', () => {
  assert.equal(entries.length, 17);
  assert.deepEqual(plain(entries.map(e => e.category)), [
    'doc', 'js', 'js', 'css', 'img', 'img', 'json', 'json', 'other', 'img', 'img', 'other', 'img', 'font', 'img', 'img', 'img'
  ]);
  assert.equal(entries[0].mime, 'text/html');
  assert.equal(entries[8].mime, 'text/plain');
  assert.equal(entries[10].hasBody, false);
  assert.equal(entries[11].hasBody, false);
  assert.equal(entries[7].hasRequestBody, true);
  assert.equal(entries[6].hasRequestBody, false);
  for (const e of entries) {
    assert.equal(typeof e.bodySize, 'number');
    assert.equal(e.name, C.makeFilename(e, {
      keepDirs: false
    }));
    assert.equal(e.format, C.formatOf(e));
  }
  assert.equal(entries[8].bodySize, Buffer.byteLength('こんにちは、HAR抽出テストです。'));
  assert.equal(entries[0].index, 0);
  assert.equal(entries[0].host, 'example.com');
  assert.equal(entries[1].query, '?v=3');
  const blank = C.parseHar(JSON.stringify({
    log: {
      entries: [{
        response: {
          content: {
            text: ''
          }
        },
        request: {
          postData: {
            text: ''
          }
        }
      }]
    }
  }))[0];
  assert.equal(blank.hasBody, false);
  assert.equal(blank.hasRequestBody, false);
  assert.equal(blank.bodySize, 0);
});

test('parse errors have Japanese messages; parsing does not decode base64', () => {
  for (const text of ['{', '{}', 'null', '{"log":{"entries":{}}}']) {
    assert.throws(() => C.parseHar(text), /[ぁ-んァ-ン一-龯]/);
  }
  const result = C.parseHar('{"log":{"entries":[{"response":{"content":{"encoding":"base64","text":"!!!"}}}]}}');
  assert.equal(result[0].hasBody, true);
  assert.throws(() => C.decodeResponseBody(result[0]), /Base64/);
});

test('body decoding: base64 whitespace, UTF-8 and request', () => {
  const expected = Buffer.from(JSON.parse(sample).log.entries[4].response.content.text, 'base64');
  assert.deepEqual(Buffer.from(C.decodeResponseBody(entries[4])), expected);
  const e = structuredClone(entries[4]);
  e.raw.response.content.text = '\n ' + e.raw.response.content.text.slice(0, 20) + '\r\n' + e.raw.response.content.text.slice(20) + ' ';
  assert.deepEqual(Buffer.from(C.decodeResponseBody(e)), expected);
  assert.equal(new TextDecoder().decode(C.decodeResponseBody(entries[8])), 'こんにちは、HAR抽出テストです。');
  assert.equal(new TextDecoder().decode(C.decodeRequestBody(entries[7])), '{"username":"テスト"}');
  assert.equal(C.decodeResponseBody(entries[10]), null);
  assert.equal(C.decodeRequestBody(entries[0]), null);
});

test('filename safety, paths, query, extensions and truncation', () => {
  assert.equal(C.makeFilename(entries[0], {}), 'index.html');
  assert.equal(C.makeFilename(entries[1], {}), 'app.js');
  assert.equal(C.makeFilename(entries[8], {}), 'readme.txt');
  assert.equal(C.makeFilename(entries[1], {
    keepDirs: true
  }), 'example.com/assets/app.js');
  assert.equal(C.makeFilename(fixture('https://x.test/a%3Cb%3E%3A%22%5C%7C%3F%2A%00.txt'), {}), 'a_b________.txt');
  assert.equal(C.makeFilename(fixture('https://x.test/a/%2E%2E%2Fsecret/file.txt'), {
    keepDirs: true
  }), 'x.test/a/secret/file.txt');
  assert.equal(C.makeFilename(fixture('https://x.test/bad%ZZ.txt'), {}), 'bad%ZZ.txt');
  assert.equal(C.makeFilename(fixture('https://x.test/dir/', 'text/html'), {}), 'index.html');
  const long = C.makeFilename(fixture('https://x.test/' + 'あ'.repeat(150) + '.txt'), {});
  assert.equal(long.length, 100);
  assert.ok(long.endsWith('.txt'));
  assert.equal(C.makeFilename(fixture('https://x.test/%E6%97%A5%E6%9C%AC.txt?x=1#hash'), {}), '日本.txt');
});

test('dedupe reserves existing suffixes and ignores case', () => {
  assert.deepEqual(plain(C.dedupeNames(['app.js', 'app.js', 'app.js'])), ['app.js', 'app_2.js', 'app_3.js']);
  assert.deepEqual(plain(C.dedupeNames(['app.js', 'APP.js', 'app_2.js', 'app.js'])), ['app.js', 'APP_3.js', 'app_2.js', 'app_4.js']);
  const names = ['a', 'a', 'a_2', 'x/a.js', 'x/A.js', 'x/a_2.js'];
  const result = plain(C.dedupeNames(names));
  assert.equal(new Set(result.map(x => x.toLowerCase())).size, names.length);
});

test('MIME extensions, format normalization and category fallback', () => {
  const cases = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'application/json': 'json',
    'application/problem+json': 'json',
    'text/javascript': 'js',
    'application/javascript': 'js',
    'application/x-javascript': 'js',
    'text/css': 'css',
    'text/html': 'html',
    'text/plain': 'txt',
    'font/woff2': 'woff2',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/x-icon': 'ico',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'application/wasm': 'wasm',
    'unknown': 'bin'
  };
  for (const [mime, ext] of Object.entries(cases)) {
    assert.equal(C.extFromMime(mime), ext);
  }
  const formats = [
    ['photo.jpeg', 'image/jpeg', 'jpg'],
    ['x.htm', 'text/html', 'html'],
    ['x.mjs', 'text/javascript', 'js'],
    ['icon.svg', 'image/svg+xml', 'svg'],
    ['users', 'application/json', 'json'],
    ['a.woff2', 'font/woff2', 'woff2'],
    ['a.longextension', 'text/plain', 'txt']
  ];
  for (const [url, mime, format] of formats) {
    assert.equal(C.formatOf(fixture('https://x/' + url, mime)), format);
  }
  assert.equal(C.categorize('application/json', 'fetch'), 'json');
  assert.equal(C.categorize('text/css', 'fetch'), 'css');
  assert.equal(C.categorize('audio/mpeg'), 'media');
  assert.equal(C.categorize('application/octet-stream', 'document'), 'doc');
});

test('every sort key both directions, numeric Japanese collation and ties', () => {
  const values = [{
    index: 2,
    name: 'file10',
    url: 'https://x/10',
    format: 'png',
    bodySize: 10,
    status: 404,
    time: 30
  }, {
    index: 0,
    name: 'file2',
    url: 'https://x/2',
    format: 'js',
    bodySize: 2,
    status: 200,
    time: 10
  }, {
    index: 1,
    name: 'FILE2',
    url: 'https://x/2',
    format: 'js',
    bodySize: 2,
    status: 200,
    time: 10
  }];
  for (const key of ['index', 'name', 'url', 'format', 'size', 'status', 'time']) {
    for (const dir of ['asc', 'desc']) {
      const result = C.sortEntries(values, key, dir);
      assert.deepEqual(plain(result.map(e => e.index)), dir === 'asc' ? [0, 1, 2] : key === 'index' ? [2, 1, 0] : [2, 0, 1]);
      assert.notEqual(result, values);
    }
  }
  assert.deepEqual(values.map(e => e.index), [2, 0, 1]);
});

test('CRC32 known vector', () => assert.equal(C.crc32(new TextEncoder().encode('123456789')), 0xCBF43926));

test('ZIP local records, central directory, UTF-8, CRC and external unzip', async t => {
  const files = [{
    name: '日本語/こんにちは.txt',
    bytes: new TextEncoder().encode('日本語の本文')
  }, {
    name: 'image.png',
    bytes: C.decodeResponseBody(entries[4])
  }, {
    name: 'empty',
    bytes: new Uint8Array()
  }];
  const bytes = C.buildZip(files);
  const data = Buffer.from(bytes);
  let p = 0;
  const offsets = [];
  for (const file of files) {
    offsets.push(p);
    assert.equal(data.readUInt32LE(p), 0x04034b50);
    assert.equal(data.readUInt16LE(p + 6), 0x800);
    assert.equal(data.readUInt16LE(p + 8), 0);
    assert.equal(data.readUInt32LE(p + 14), C.crc32(file.bytes));
    const length = data.readUInt32LE(p + 18);
    const nameLength = data.readUInt16LE(p + 26);
    assert.equal(data.toString('utf8', p + 30, p + 30 + nameLength), file.name);
    assert.deepEqual(data.subarray(p + 30 + nameLength, p + 30 + nameLength + length), Buffer.from(file.bytes));
    p += 30 + nameLength + length;
  }
  const central = p;
  for (const [i, file] of files.entries()) {
    assert.equal(data.readUInt32LE(p), 0x02014b50);
    assert.equal(data.readUInt16LE(p + 8), 0x800);
    assert.equal(data.readUInt32LE(p + 42), offsets[i]);
    const n = data.readUInt16LE(p + 28);
    assert.equal(data.toString('utf8', p + 46, p + 46 + n), file.name);
    p += 46 + n;
  }
  assert.equal(data.readUInt32LE(p), 0x06054b50);
  assert.equal(data.readUInt16LE(p + 10), 3);
  assert.equal(data.readUInt32LE(p + 12), p - central);
  assert.equal(data.readUInt32LE(p + 16), central);
  assert.equal(p + 22, data.length);
  const dir = await mkdtemp(join(tmpdir(), 'har-zip-'));
  try {
    const path = join(dir, 'test.zip');
    await writeFile(path, bytes);
    const run = spawnSync('unzip', ['-t', path], {
      encoding: 'utf8'
    });
    if (run.error?.code === 'ENOENT') {
      t.diagnostic('unzip がないため外部検証のみスキップ');
    } else {
      assert.equal(run.status, 0, run.stdout + run.stderr);
    }
  } finally {
    await rm(dir, {
      recursive: true,
      force: true
    });
  }
  assert.equal(C.buildZip([]).length, 22);
});

test('classic ZIP limits rejected before allocating output', () => {
  assert.throws(() => C.buildZip(Array(65536)), /上限/);
  assert.throws(() => C.buildZip([{
    name: 'x'.repeat(65536),
    bytes: new Uint8Array()
  }]), /上限/);
  assert.throws(() => C.buildZip([{
    name: 'x',
    bytes: {
      length: 0xffffffff
    }
  }]), /上限/);
});

test('manifest RFC4180 quotes, Japanese BOM and bytes formatting', () => {
  const csv = C.buildManifestCsv([{
    file: '日本,語.txt',
    url: 'https://x/"a"\r\nb',
    method: 'GET',
    status: 200,
    mime: 'text/plain'
  }]);
  assert.equal(csv, '\ufefffile,url,method,status,mime\r\n"日本,語.txt","https://x/""a""\r\nb",GET,200,text/plain\r\n');
  assert.deepEqual([...new TextEncoder().encode(csv).slice(0, 3)], [239, 187, 191]);
  assert.equal(C.formatBytes(0), '0 B');
  assert.equal(C.formatBytes(1024), '1.00 KB');
  assert.equal(C.formatBytes(1048576), '1.00 MB');
  assert.equal(C.formatBytes(1073741824), '1.00 GB');
});

test('inline-only document and forbidden APIs absent', () => {
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.equal((html.match(/<script /g) || []).length, 2);
  assert.doesNotMatch(source, /\bwindow\b|\bdocument\b\s*\./);
});

test('manifest neutralizes spreadsheet formulas in every column before quoting', () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r']) {
    const value = prefix + 'SUM(1,2)"日本語"';
    const row = Object.fromEntries(['file', 'url', 'method', 'status', 'mime'].map(key => [key, value]));
    const escaped = '"' + "'" + value.replace(/"/g, '""') + '"';
    assert.equal(C.buildManifestCsv([row]), '\ufefffile,url,method,status,mime\r\n' + Array(5).fill(escaped).join(',') + '\r\n');
  }
  assert.equal(C.buildManifestCsv([{
    file: "'safe.txt",
    url: 'https://example.com',
    method: 'GET',
    status: 200,
    mime: 'text/plain'
  }]), "\ufefffile,url,method,status,mime\r\n'safe.txt,https://example.com,GET,200,text/plain\r\n");
});

test('data and blob URLs use short names, MIME formats and scheme hosts', () => {
  const cases = [
    ['data:image/png;base64,aGVsbG8=', 'text/plain', 'data', 'png'],
    ['DATA:IMAGE/AVIF;charset=utf-8;BASE64,aGVsbG8=', 'image/png', 'data', 'avif'],
    ['data:image/svg+xml;charset=UTF-8,%3Csvg%3E%3C/svg%3E', 'text/plain', 'data', 'svg'],
    ['data:text/plain,hello.jpeg', 'image/jpeg', 'data', 'txt'],
    ['data:font/woff2;base64,AAAA', '', 'data', 'woff2'],
    ['data:;charset=utf-8,hello', 'text/markdown', 'data', 'md'],
    ['data:;base64,aGVsbG8=', 'image/png', 'data', 'png'],
    ['data:,hello', 'text/plain', 'data', 'txt'],
    ['data:,hello', '', 'data', 'bin'],
    ['data:application/unknown;base64,AAAA', 'image/png', 'data', 'bin'],
    ['data:application/manifest+json,{}', 'text/plain', 'data', 'json'],
    ['data:image/png;base64', 'image/jpeg', 'data', 'jpg'],
    ['data:not-a-mime,hello', 'application/pdf', 'data', 'pdf'],
    ['data:image/%ZZ,hello', 'image/png', 'data', 'png'],
    ['data:image%2Fpng;base64,AAAA', 'text/plain', 'data', 'png'],
    ['data:image/png#fragment,hello', 'text/plain', 'data', 'txt'],
    ['data:image/png?query,hello', 'text/plain', 'data', 'txt'],
    ['data:image/png,hello?query#fragment', 'text/plain', 'data', 'png'],
    ['data:', 'text/plain', 'data', 'txt'],
    ['blob:https://example.com/uuid.jpeg', 'image/png', 'blob', 'png'],
    ['blob:null/uuid', 'video/webm', 'blob', 'webm'],
    ['BLOB:not-a-valid-origin', 'audio/mp4', 'blob', 'm4a'],
    ['blob:', '', 'blob', 'bin']
  ];
  for (const [url, mime, kind, format] of cases) {
    const entry = { url, mime, index: 42 };
    assert.equal(C.makeFilename(entry, { keepDirs: false }), `${kind}_42.${format}`, url);
    assert.equal(C.makeFilename(entry, { keepDirs: true }), `_${kind}/${kind}_42.${format}`, url);
    assert.equal(C.makeFilename({ url, mime }, {}), `${kind}_0.${format}`, url);
    assert.equal(C.formatOf(entry), format, url);
  }
  const parsed = C.parseHar(JSON.stringify({
    log: {
      entries: cases.map(([url, mime]) => ({
        request: { method: 'GET', url },
        response: { content: { mimeType: mime } }
      }))
    }
  }));
  for (let index = 0; index < parsed.length; index++) {
    const [, , kind, format] = cases[index];
    assert.equal(parsed[index].host, kind + ':');
    assert.equal(parsed[index].name, `${kind}_${index}.${format}`);
    assert.equal(parsed[index].format, format);
    assert.equal(parsed[index].hasBody, false);
  }
  const huge = { url: 'data:image/png;base64,' + 'AAAA'.repeat(50000), mime: '', index: 0 };
  assert.equal(C.makeFilename(huge, { keepDirs: true }), '_data/data_0.png');
  for (const index of [undefined, null, -1, '42', NaN, Infinity]) {
    assert.equal(C.makeFilename({ ...huge, index }, {}), 'data_0.png');
  }
});

test('Windows device names are prefixed in every sanitized segment', () => {
  const reserved = ['CON', 'PRN', 'AUX', 'NUL'];
  for (let number = 1; number <= 9; number++) {
    reserved.push('COM' + number, 'LPT' + number);
  }
  for (const name of reserved) {
    for (const spelling of [name, name.toLowerCase()]) {
      const entry = fixture(`https://example.com/${spelling}/${spelling}.txt`);
      assert.equal(C.makeFilename(entry, {}), `_${spelling}.txt`);
      assert.equal(C.makeFilename(entry, { keepDirs: true }), `example.com/_${spelling}/_${spelling}.txt`);
      assert.equal(C.makeFilename(fixture(`https://example.com/${spelling}`), {}), `_${spelling}.txt`);
    }
  }
  assert.equal(C.makeFilename(fixture('https://con/PRN.tar.gz'), { keepDirs: true }), '_con/_PRN.tar.gz');
  assert.equal(C.makeFilename(fixture('https://x/CON%20.txt'), {}), '_CON .txt');
  assert.equal(C.makeFilename(fixture('https://x/dir.%20/%20/%20.%20/file.txt'), { keepDirs: true }), 'x/dir/_/_/file.txt');
  for (const name of ['COM0', 'COM10', 'LPT0', 'LPT10', 'CONSOLE', 'AUXILIARY', '_CON']) {
    assert.equal(C.makeFilename(fixture(`https://x/${name}.txt`), {}), `${name}.txt`);
  }
  const longName = C.makeFilename(fixture('https://x/CON.' + 'x'.repeat(120) + '.txt'), {});
  assert.equal(longName.length, 100);
  assert.ok(longName.startsWith('_CON.'));
  assert.ok(longName.endsWith('.txt'));
  const names = ['CON.txt', '_CON.txt', '_con_2.txt'].map(name => C.makeFilename(fixture('https://x/' + name), {}));
  assert.deepEqual(plain(C.dedupeNames(names)), ['_CON.txt', '_CON_3.txt', '_con_2.txt']);
});

test('additional MIME mappings support parameters and case-insensitive names', () => {
  const mappings = {
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'video/webm': 'webm',
    'audio/ogg': 'ogg',
    'video/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'font/ttf': 'ttf',
    'application/x-font-ttf': 'ttf',
    'font/otf': 'otf',
    'application/font-woff': 'woff',
    'application/pdf': 'pdf',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'application/zip': 'zip',
    'application/manifest+json': 'json',
    'application/x-protobuf': 'pb',
    'application/protobuf': 'pb',
    'text/event-stream': 'txt',
    'application/octet-stream': 'bin'
  };
  for (const [mime, extension] of Object.entries(mappings)) {
    assert.equal(C.extFromMime(mime), extension);
    assert.equal(C.extFromMime(mime.toUpperCase() + '; charset=utf-8'), extension);
    const entry = fixture('https://example.com/resource', mime);
    assert.equal(C.formatOf(entry), extension);
    assert.equal(C.makeFilename(entry, {}), 'resource.' + extension);
  }
});

test('5000-entry HAR smoke test: parse, all sort keys, dedupe and 500-file ZIPs', () => {
  const mimes = ['text/html', 'application/json', 'image/png', 'text/plain', 'font/woff2', 'audio/ogg', 'application/pdf'];
  const rawEntries = Array.from({ length: 5000 }, (_, index) => {
    const hasBody = index % 9 !== 0 && index % 13 !== 0;
    const base64 = index % 4 === 0;
    const text = base64
      ? Buffer.from([index & 255, 0, 255, 128]).toString('base64')
      : `本文 ${index}`;
    const mimeType = mimes[index % mimes.length];
    const basename = ['CON', '_CON', 'file', 'FILE', 'file_2'][index % 5];
    let url = `https://example.com/dir${index % 3}/${basename}?request=${index}`;
    if (index % 17 === 0) {
      url = `data:${mimeType};charset=utf-8,content`;
    } else if (index % 19 === 0) {
      url = `blob:https://example.com/${index}`;
    }
    return {
      request: { method: 'GET', url },
      response: {
        status: hasBody ? (index % 7 === 0 ? 404 : 200) : 304,
        content: {
          mimeType,
          ...(base64 ? { encoding: 'base64' } : {}),
          ...(hasBody ? { text } : index % 13 === 0 ? { text: '' } : {})
        }
      },
      time: index % 101
    };
  });
  const parsed = C.parseHar(JSON.stringify({ log: { entries: rawEntries } }));
  assert.equal(parsed.length, 5000);
  const expectedBodyCount = rawEntries.filter(entry => Boolean(entry.response.content.text)).length;
  assert.equal(parsed.filter(entry => entry.hasBody).length, expectedBodyCount);
  for (let index = 0; index < parsed.length; index++) {
    const entry = parsed[index];
    assert.equal(entry.index, index);
    assert.equal(entry.name, C.makeFilename(entry, { keepDirs: false }));
    assert.equal(entry.format, C.formatOf(entry));
    const decoded = C.decodeResponseBody(entry);
    assert.equal(entry.bodySize, decoded?.length || 0);
    assert.equal(decoded !== null, entry.hasBody);
  }
  for (const key of ['index', 'name', 'url', 'format', 'size', 'status', 'time']) {
    for (const direction of ['asc', 'desc']) {
      const sorted = C.sortEntries(parsed, key, direction);
      assert.equal(sorted.length, parsed.length);
      assert.notEqual(sorted, parsed);
      assert.equal(new Set(sorted.map(entry => entry.index)).size, parsed.length);
      const field = key === 'size' ? 'bodySize' : key;
      for (let index = 1; index < sorted.length; index++) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        const comparison = typeof previous[field] === 'string'
          ? previous[field].localeCompare(current[field], 'ja', { numeric: true, sensitivity: 'base' })
          : previous[field] - current[field];
        assert.ok(direction === 'asc' ? comparison <= 0 : comparison >= 0);
        if (comparison === 0) {
          assert.ok(previous.index < current.index);
        }
      }
    }
  }
  assert.deepEqual(plain(parsed.map(entry => entry.index)), Array.from({ length: 5000 }, (_, index) => index));
  for (const keepDirs of [false, true]) {
    const names = parsed.map(entry => C.makeFilename(entry, { keepDirs }));
    const unique = C.dedupeNames(names);
    assert.equal(unique.length, 5000);
    assert.equal(new Set(unique.map(name => name.toLowerCase())).size, 5000);
    const chosen = parsed.filter(entry => entry.hasBody).slice(0, 500);
    const files = chosen.map(entry => ({ name: unique[entry.index], bytes: C.decodeResponseBody(entry) }));
    const zip = Buffer.from(C.buildZip(files));
    const end = zip.length - 22;
    assert.equal(zip.readUInt32LE(end), 0x06054b50);
    assert.equal(zip.readUInt16LE(end + 8), 500);
    assert.equal(zip.readUInt16LE(end + 10), 500);
    const centralStart = zip.readUInt32LE(end + 16);
    assert.equal(centralStart + zip.readUInt32LE(end + 12), end);
    let offset = 0;
    for (const file of files) {
      assert.equal(zip.readUInt32LE(offset), 0x04034b50);
      const size = zip.readUInt32LE(offset + 18);
      const nameLength = zip.readUInt16LE(offset + 26);
      const bodyStart = offset + 30 + nameLength;
      assert.equal(zip.toString('utf8', offset + 30, bodyStart), file.name);
      assert.deepEqual(zip.subarray(bodyStart, bodyStart + size), Buffer.from(file.bytes));
      assert.equal(zip.readUInt32LE(offset + 14), C.crc32(file.bytes));
      offset = bodyStart + size;
    }
    assert.equal(offset, centralStart);
  }
});

function jpegWithOrientation(jpeg, orientation, little) {
  const segment = Buffer.alloc(36);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(34, 2);
  segment.write('Exif\0\0', 4, 'binary');
  segment.write(little ? 'II' : 'MM', 10);
  const view = new DataView(segment.buffer, segment.byteOffset, segment.length);
  view.setUint16(12, 42, little);
  view.setUint32(14, 8, little);
  view.setUint16(18, 1, little);
  view.setUint16(20, 0x0112, little);
  view.setUint16(22, 3, little);
  view.setUint32(24, 1, little);
  view.setUint16(28, orientation, little);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

test('JPEG dimensions, EXIF byte orders, SOF variants and hostile boundaries', () => {
  const jpeg = Buffer.from(C.decodeResponseBody(entries[15]));
  assert.deepEqual(plain(C.jpegInfo(jpeg)), {
    width: 120, height: 80, components: 3, progressive: false, orientation: 1
  });
  for (const little of [true, false]) {
    assert.equal(C.jpegInfo(jpegWithOrientation(jpeg, 6, little)).orientation, 6);
    assert.equal(C.jpegInfo(jpegWithOrientation(jpeg, 9, little)).orientation, 1);
    const hostile = jpegWithOrientation(jpeg, 6, little);
    hostile.fill(0xff, 16, 20);
    assert.equal(C.jpegInfo(hostile).orientation, 1);
    const excessiveTags = jpegWithOrientation(jpeg, 6, little);
    excessiveTags.fill(0xff, 20, 22);
    assert.equal(C.jpegInfo(excessiveTags).orientation, 1);
  }
  const exif = jpegWithOrientation(jpeg, 6, true);
  const xmp = Buffer.from([0xff, 0xe1, 0, 6, 88, 77, 80, 0]);
  const both = Buffer.concat([exif.subarray(0, 38), xmp, exif.subarray(38)]);
  assert.equal(C.jpegInfo(both).orientation, 6);
  const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  for (const marker of [0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
    const variant = Buffer.from(jpeg);
    variant[sof + 1] = marker;
    assert.equal(C.jpegInfo(variant).width, 120);
    assert.equal(C.jpegInfo(variant).progressive, [0xc2, 0xc6, 0xca, 0xce].includes(marker));
  }
  for (let length = 0; length < jpeg.length; length++) {
    assert.equal(C.jpegInfo(jpeg.subarray(0, length)), null);
  }
  for (const bytes of [C.decodeResponseBody(entries[14]), new Uint8Array(), Buffer.from('garbage'), null]) {
    assert.doesNotThrow(() => C.jpegInfo(bytes));
    assert.equal(C.jpegInfo(bytes), null);
  }
  for (const length of [0, 1, 65535]) {
    const bad = Buffer.from(jpeg);
    bad.writeUInt16BE(length, sof + 2);
    assert.equal(C.jpegInfo(bad), null);
  }
});

test('PDF byte layout, exact xref offsets, stream lengths, page sizes and metadata', () => {
  const jpeg = C.decodeResponseBody(entries[15]);
  const pages = [
    { widthPt: 90, heightPt: 60, image: { kind: 'jpeg', bytes: jpeg, width: 120, height: 80, components: 3 } },
    {
      widthPt: 1.23456, heightPt: 1.5,
      image: { kind: 'flate', bytes: deflateSync(Buffer.from([255, 0, 0, 0, 255, 0])), width: 2, height: 1 }
    }
  ];
  const pdf = Buffer.from(C.buildPdf(pages));
  assert.ok(pdf.subarray(0, 9).equals(Buffer.from('%PDF-1.4\n')));
  assert.deepEqual([...pdf.subarray(9, 15)], [0x25, 0xe2, 0xe3, 0xcf, 0xd3, 10]);
  const text = pdf.toString('latin1');
  assert.match(text, /%%EOF\n$/);
  const xref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(text.slice(xref, xref + 5), 'xref\n');
  const xrefHeader = text.slice(xref).match(/^xref\n0 (\d+)\n/);
  const size = Number(xrefHeader[1]);
  assert.equal(size, 10);
  assert.equal(Number(text.match(/\/Size (\d+)/)[1]), size);
  let position = xref + xrefHeader[0].length;
  assert.equal(text.slice(position, position + 20), '0000000000 65535 f\r\n');
  position += 20;
  const offsets = [];
  for (let id = 1; id < size; id++) {
    const line = text.slice(position, position + 20);
    assert.match(line, /^\d{10} 00000 n\r\n$/);
    const offset = Number(line.slice(0, 10));
    offsets.push(offset);
    assert.equal(text.slice(offset, offset + `${id} 0 obj\n`.length), `${id} 0 obj\n`);
    position += 20;
  }
  let streams = 0;
  for (let index = 0; index < offsets.length; index++) {
    const object = pdf.subarray(offsets[index], offsets[index + 1] || xref);
    const objectText = object.toString('latin1');
    const stream = objectText.match(/\/Length (\d+) >>\nstream\n/);
    if (!stream) {
      continue;
    }
    streams++;
    const start = stream.index + stream[0].length;
    const length = Number(stream[1]);
    assert.equal(objectText.slice(start + length, start + length + 10), '\nendstream');
    if (objectText.includes('/DCTDecode')) {
      assert.deepEqual(object.subarray(start, start + length), Buffer.from(jpeg));
    }
  }
  assert.equal(streams, 4);
  assert.match(text, /\/Count 2\b/);
  assert.match(text, /\/MediaBox \[0 0 90 60\]/);
  assert.match(text, /\/MediaBox \[0 0 1\.2346 1\.5\]/);
  assert.match(text, /q 90 0 0 60 0 0 cm \/Im0 Do Q/);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/Producer <feff004800410052002062bd51fa30c430fc30eb>/);
  assert.match(text, /\/Root 1 0 R \/Info 9 0 R/);
  const gray = C.buildPdf([{ ...pages[0], image: { ...pages[0].image, components: 1 } }]);
  assert.match(Buffer.from(gray).toString('latin1'), /\/ColorSpace \/DeviceGray/);
  assert.throws(() => C.buildPdf([]), /画像がありません/);
  assert.throws(() => C.buildPdf([{ ...pages[0], widthPt: Infinity }]), /サイズが不正/);
  assert.throws(() => C.buildPdf([{ ...pages[0], image: { ...pages[0].image, components: 4 } }]), /データが不正/);
});
