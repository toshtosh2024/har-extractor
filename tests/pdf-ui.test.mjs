import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const sample = await readFile(new URL('./sample.har', import.meta.url), 'utf8');

// Minimal DOM doubles exercise download routing; image decoding itself belongs to the browser.
class Element {
  constructor(tag = 'div', text = '') {
    this.tagName = tag;
    this.textContent = text;
    this.children = [];
    this.dataset = {};
    this.handlers = {};
    this.value = '';
    this.checked = false;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }

  append(...children) {
    for (const child of children) {
      if (child.tagName === 'fragment') {
        this.append(...child.children);
      } else {
        this.children.push(child);
        child.parentElement = this;
      }
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  addEventListener(name, handler) {
    this.handlers[name] = handler;
  }

  remove() {}
}

function harness(compression = true) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const downloads = [];
  const urls = new Map();
  const rasterCalls = [];
  let nextUrl = 0;
  class LocalURL extends URL {
    static createObjectURL(blob) {
      const url = 'blob:' + nextUrl++;
      urls.set(url, blob);
      return url;
    }

    static revokeObjectURL(url) {
      urls.delete(url);
    }
  }
  class RasterImage {
    naturalWidth = 2;
    naturalHeight = 1;
    async decode() {
      if (urls.get(this.src).size < 10) {
        throw new Error('Invalid image');
      }
    }
    removeAttribute() {}
  }
  const document = {
    getElementById: id => nodes.get(id),
    createTextNode: text => new Element('text', text),
    createDocumentFragment: () => new Element('fragment'),
    querySelectorAll: () => [],
    addEventListener() {},
    body: new Element('body'),
    createElement(tag) {
      const element = new Element(tag);
      if (tag === 'a') {
        element.click = () => downloads.push({ name: element.download, blob: urls.get(element.href) });
      }
      if (tag === 'canvas') {
        element.getContext = () => ({
          fillStyle: '',
          fillRect() { rasterCalls.push(this.fillStyle); },
          drawImage() { rasterCalls.push('draw'); },
          getImageData() { return { data: new Uint8Array([255, 127, 127, 255, 0, 255, 0, 255]) }; }
        });
      }
      return element;
    }
  };
  const context = vm.createContext({
    document, window: { addEventListener() {} }, URL: LocalURL, Blob, Response,
    TextEncoder, TextDecoder, atob, Image: RasterImage,
    ...(compression ? { CompressionStream } : {}),
    setTimeout: (callback, delay) => delay === 30000 ? 0 : setTimeout(callback, 0),
    clearTimeout
  });
  vm.runInContext(html.match(/<script id="har-core">([\s\S]*?)<\/script>/)[1], context);
  const ui = html.match(/<script id="har-ui">([\s\S]*?)<\/script>/)[1];
  const boundary = ui.lastIndexOf('})();');
  vm.runInContext(ui.slice(0, boundary) + `
    globalThis.testUi = {
      downloadSelection, rasterizeImage, resetForLoad,
      configure(ids, key = 'index', dir = 'asc') {
        entries = HarCore.parseHar(globalThis.sample);
        selected = new Set(ids);
        filename = 'sample.har';
        sortKey = key;
        sortDir = dir;
        syncSelection();
      }
    };
  ` + ui.slice(boundary), context);
  context.sample = sample;
  function configure(ids, options = {}, key, dir) {
    for (const [id, checked] of Object.entries(options)) {
      nodes.get(id).checked = checked;
    }
    context.testUi.configure(ids, key, dir);
  }
  return { context, nodes, downloads, urls, rasterCalls, configure };
}

async function zipContents(download) {
  const bytes = Buffer.from(await download.blob.arrayBuffer());
  const files = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const body = offset + 30 + nameLength;
    files.set(bytes.toString('utf8', offset + 30, body), bytes.subarray(body, body + length));
    offset = body + length;
  }
  return files;
}

test('PDF direct download, ZIP routing, page manifest order and optional source images', async () => {
  const h = harness();
  h.configure([15], { 'merge-pdf': true });
  assert.equal(h.nodes.get('zip').textContent, '選択をPDFでダウンロード (1件)');
  await h.context.testUi.downloadSelection();
  assert.equal(h.downloads[0].name, 'sample_images.pdf');
  assert.equal(h.downloads[0].blob.type, 'application/pdf');
  h.configure([0, 14, 15], {}, 'index', 'desc');
  await h.context.testUi.downloadSelection();
  const files = await zipContents(h.downloads[1]);
  assert.deepEqual([...files.keys()], ['sample_images.pdf', 'index.html', 'manifest.csv']);
  const manifest = files.get('manifest.csv').toString('utf8');
  assert.match(manifest, /sample_images.pdf#page=1,https:\/\/example.com\/pdf\/pattern.jpg/);
  assert.match(manifest, /sample_images.pdf#page=2,https:\/\/example.com\/pdf\/pattern.png/);
  assert.ok(manifest.indexOf('#page=1') < manifest.indexOf('#page=2'));
  h.configure([14, 15], { 'keep-images': true });
  assert.match(h.nodes.get('zip').textContent, /ZIP/);
  await h.context.testUi.downloadSelection();
  const kept = await zipContents(h.downloads[2]);
  assert.ok(kept.has('pattern.png') && kept.has('pattern.jpg'));
  assert.match(kept.get('manifest.csv').toString('utf8'), /pattern.png,https:/);
  h.configure([7, 15], { 'keep-images': false, 'include-requests': true });
  await h.context.testUi.downloadSelection();
  const requests = await zipContents(h.downloads[3]);
  assert.ok(requests.has('_requests/007_login.json.txt'));
  h.context.testUi.resetForLoad();
  assert.equal(h.nodes.get('merge-pdf').checked, false);
  assert.equal(h.nodes.get('keep-images').checked, false);
  assert.equal(h.nodes.get('keep-images').disabled, true);
});

test('PDF failure handling, missing compression support and original ZIP mode', async () => {
  const h = harness();
  h.configure([0], { 'merge-pdf': true });
  await h.context.testUi.downloadSelection();
  assert.match(h.nodes.get('message').textContent, /選択に画像がないため/);
  h.configure([9]);
  await h.context.testUi.downloadSelection();
  assert.equal(h.downloads.length, 1);
  assert.match(h.nodes.get('message').textContent, /PDFに含められなかった画像: photo.jpeg/);
  h.configure([9, 0]);
  await h.context.testUi.downloadSelection();
  assert.deepEqual([...(await zipContents(h.downloads[1])).keys()], ['index.html', 'manifest.csv']);
  h.configure([9, 15]);
  await h.context.testUi.downloadSelection();
  assert.equal(h.downloads[2].name, 'sample_images.pdf');
  assert.match(h.nodes.get('message').textContent, /photo.jpeg/);
  const unsupported = harness(false);
  unsupported.configure([15], { 'merge-pdf': true });
  await unsupported.context.testUi.downloadSelection();
  assert.match(unsupported.nodes.get('message').textContent, /このブラウザーはPDF結合に対応していません/);
  assert.ok((await zipContents(unsupported.downloads[0])).has('pattern.jpg'));
  h.configure([15], { 'merge-pdf': false });
  await h.context.testUi.downloadSelection();
  assert.deepEqual([...(await zipContents(h.downloads[3])).keys()], ['pattern.jpg', 'manifest.csv']);
});

test('raster path paints white first, drops alpha, zlib-compresses RGB and revokes its URL', async () => {
  const h = harness();
  const entries = h.context.HarCore.parseHar(sample);
  const image = await h.context.testUi.rasterizeImage(entries[14], h.context.HarCore.decodeResponseBody(entries[14]));
  assert.deepEqual(h.rasterCalls, ['#fff', 'draw']);
  assert.deepEqual(inflateSync(image.bytes), Buffer.from([255, 127, 127, 0, 255, 0]));
  assert.equal(h.urls.size, 0);
  await assert.rejects(() => h.context.testUi.rasterizeImage(entries[9], h.context.HarCore.decodeResponseBody(entries[9])));
  assert.equal(h.urls.size, 0);
});

test('image request bodies force ZIP, and source names cannot replace the generated PDF', async () => {
  const h = harness();
  const har = JSON.parse(sample);
  har.log.entries[15].request.postData = { mimeType: 'text/plain', text: 'image request' };
  har.log.entries[0].request.url = 'https://example.com/sample_images.pdf';
  h.context.sample = JSON.stringify(har);
  h.configure([15], { 'merge-pdf': true, 'include-requests': true });
  assert.match(h.nodes.get('zip').textContent, /ZIP/);
  await h.context.testUi.downloadSelection();
  const withRequest = await zipContents(h.downloads[0]);
  assert.ok(withRequest.has('sample_images.pdf'));
  assert.ok(withRequest.has('_requests/015_pattern.jpg.txt'));
  h.configure([0, 15], { 'include-requests': false });
  await h.context.testUi.downloadSelection();
  const collision = await zipContents(h.downloads[1]);
  assert.ok(collision.has('sample_images.pdf'));
  assert.ok(collision.has('sample_images_2.pdf'));
  const manifest = collision.get('manifest.csv').toString('utf8');
  assert.match(manifest, /sample_images_2.pdf,https:\/\/example.com\/sample_images.pdf/);
  assert.match(manifest, /sample_images.pdf#page=1,https:\/\/example.com\/pdf\/pattern.jpg/);
});
