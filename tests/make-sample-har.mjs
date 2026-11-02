import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function patternPng() {
  const width = 120;
  const height = 80;
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 4) + 1 + x * 4;
      const stripe = (Math.floor(x / 20) + Math.floor(y / 20)) % 2;
      rows[offset] = stripe ? 245 : 30;
      rows[offset + 1] = Math.round(y / (height - 1) * 255);
      rows[offset + 2] = stripe ? 50 : 220;
      rows[offset + 3] = x < 60 ? 255 : 100;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}
export const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQiT73HwAEQQJNdn40sgAAAABJRU5ErkJggg==';
export const patternPngBase64 = patternPng().toString('base64');
export const sampleJpegBase64 = [
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQA',
  'AAABAAAAeKADAAQAAAABAAAAUAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmA',
  'CZjs+EJ+/8AAEQgAUAB4AwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQE',
  'AAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldY',
  'WVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk',
  '5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMR',
  'BAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdo',
  'aWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz',
  '9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8P',
  'D//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQA',
  'CP/aAAwDAQACEQMRAD8A/KL+zv8AZo/s7/ZrvP7OHpR/Zw9K/wBhv7UPjP7Z8ze+F2nf8hPj/nj/AOz16z/Z3tWF8LdOH/Ez4/54',
  '/wDs9etf2cPSv8k/pN5n/wAZxmGv/Pr/ANM0z/Wz6Mmc/wDGD5fr/wA/f/T1Q4L+zvavkz+zv9mvvD+zh6V8l/2cPSv3n6EeZ/8A',
  'I21/58/+5T8G+m5nP/Ip1/5/f+4jg/7O/wBmv0o/4J52flf8J/xjP9lf+3dfCf8AZw9K/Rb9gSz8r/hO+Ov9l/8At1X9EfSIzHm4',
  'Oxy/69/+nYH8h+HGa82dUI3/AJv/AEiR9++TR5NbHke1Hke1f5ge3P6n+tHkPke1Hke1bHke1Hke1f177c/kL60W/D8H+v4/u/1r',
  'o/Jqp4fg/wBfx/d/rXR+R7V/OPHtf/hWrf8Abv8A6TE/o3gLFf8ACTR/7e/9KkY/k0eTWx5HtR5HtXyHtz7D60f/0PnX/hTv/UT/',
  'APIP/wBnR/wp3/qJ/wDkH/7Ovpf+zfaj+zfavlf+Jr+OP+hh/wCUqP8A8rP7j/4l84H/AOgD/wAqVv8A5YfNH9nf8K17f2j/AGj/',
  'ANsdnk/995zv9sYo/wCFgD/oF/8Akb/7XXe/FLTf+QZx/wA9v/ZK8l/s32r+tfDLgTI+Msjw/EnElD22Mrc3PPmnDm5Jypx92nKE',
  'FaEYrSKva7u22fyT4neM2ecG55iOG+G8R7HCUeXkhywny88I1Je9UjKbvOUnrJ2vZWSSW7/wsAf9Av8A8jf/AGuj/hTv/UT/APIP',
  '/wBnWF/ZvtX1p/ZvtXwfjbmf/EOPqn+pj+rfWef2n/Lzm9nycn8X2lre0n8Nr31vZW+98Ec5/wCIjfW/9c39Z+rcns/+XfL7Tn5/',
  '4XJe/JD4r2tpa7v80f8ACnf+on/5B/8As6+xP2TfDf8Awg//AAlX777Z9t+w/wAPl7fL8/3bOd1cl/ZvtXufwXs/K/tjjGfs/wD7',
  'Ur8k4Z8duJeJMdTyXOcX7XD1b80eSnG/KnNawjGStKKejW1npdH3/iV4X8N8P5JXzfJsL7PEU+Xllz1JW5pxi9JylF3jJrVPe611',
  'Pf8A+2v+nf8A8e/+tR/bX/Tv/wCPf/Wqn5FHkV+tf6l5T/z5/wDJpf8AyR/KP/ER82/5/f8Aksf/AJEuf8Ix/wBN/wDxz/69H/CM',
  'f9N//HP/AK9d35NHk1+Q/wDERM1/5/f+Sx/+RP1//UzKf+fP/k0v/kjhPJ/sL/pv5/8AwHG38/Wj+2v+nf8A8e/+tWx4gh/49/8A',
  'gf8ASub8iv0fIcpwmZ4SGOx0OapK93dq9m0tE0tkloj83z/inF5Zi54HAz5aUbWVk7XSb1ab3b3Zc/tr/p3/APHv/rUf21/07/8A',
  'j3/1qp+RR5Fev/qXlP8Az5/8ml/8keR/xEfNv+f3/ksf/kT/0fSf7O/2aP7O/wBmvCP7O/2aP7O/2a6v+JNv+pv/AOUf/up6f/E+',
  'v/Uq/wDK/wD9xN34o6d/yDPl/wCe3/sleTf2cfSvpb4Xad/yE/l/54/+z161/Z3+zR/xMD/xDn/jDPqv1n6t/wAvOf2fN7T978HJ',
  'O1ufl+N3tfS9kf8AEKv+Ij/8Zn9c+rfWf+XfJ7Tl9n+6+Pnp3v7Pm+BWvbW138H/ANnH0r6z/s7/AGa73+zv9mvkv+zv9mj+0/8A',
  'iMnX6l9S/wC43P7b/wAFcvL7L+9fm6W1P7Z/4g31+u/Xf+4PJ7H/AMG83N7X+7bl63093/s7/Zr2H4T2flf2rxjPkf8As9fE/wDZ',
  '3+zX2Z+yNaeV/wAJXxjP2H/2vSl4Af6oL/WL6/7b2P2PZ8nNz/u/i9pK1ua/wu9raXuoqfSl/wBc1/q19R9j7f7ftOe3J+8+H2cb',
  '35LfErXvraz9t8ijyK9f8mjyaz/4i7/1D/8Ak3/2pz/8Qz/6if8AyX/7YxvI9qPI9q5LyPajyPaj/iGX/UT/AOSf/bD/AOIv/wDU',
  'P/5P/wDalrxBB/qP+Bf0rnPIrvPD8P8Ar+P7v9a6PyaP9c/7E/4S/Z8/J9q/Lfm97azta9txf6vf23/wqe19nz/ZtzW5fd3ur3tf',
  'Y8g8ijyK9f8AJo8mj/iLv/UP/wCTf/ah/wAQz/6if/Jf/tj/0r/9nf7NH9nf7NfS3/CnR/0Ev/IH/wBnR/wp0f8AQS/8gf8A2dff',
  '/wDE1/A//Qw/8pVv/lZ/If8AxL7xx/0Af+VaP/yw4P4Xad/yE+P+eP8A7PXrP9ne1YX9nD4a9v7R/tH/ALY7PJ/77znf7YxR/wAL',
  'B/6hf/kb/wCwr+SfE3gTPOMs8xHEnDdD22ErcvJPmhDm5IRpy92pKM1acZLWKva6umm/618MfGbI+Dcjw/DfEmJ9ji6PNzw5Zz5e',
  'ecqkfepxlB3hKL0k7Xs7NNLd/s72r5M/s7/Zr6W/4WD/ANQv/wAjf/YUf8KdH/QS/wDIH/2dfe+CWZ/8Q4+t/wCub+rfWeT2f/Lz',
  'm9nz8/8AC57W9pD4rXvpezt8H43Zx/xEb6p/qY/rP1bn9p/y75facnJ/F5L35J/De1tbXV/mn+zv9mvrn9lez8r/AISfjGfsX/te',
  'uc/4U6P+gl/5A/8As69o+EPhseB/7W/e/bPtvkfw+Xt8vzPds53V+scVeO3DfEuAqZLk2L9riKtuWPJUjflkpvWcYxVoxb1a2stb',
  'I/OvDzwv4k4fzihm+c4b2eHp83NLnpytzQlFe7CUpO8pJaJ2vd6HunkUeRVT+2v+nf8A8e/+tR/bX/Tv/wCPf/Wr8c/1Kzb/AJ8/',
  '+TR/+SP6e/4iPlP/AD+/8ll/kcJ5Io8kV3f/AAjH/Tf/AMc/+vR/wjH/AE3/APHP/r1+vf8AEQ8q/wCf3/ksv/kT8g/1Lzb/AJ8/',
  '+TR/zMfw/D/r/wDgH9a6PyKqeT/YX/Tfz/8AgONv5+tH9tf9O/8A49/9avzjPsoxeZ4ueOwMOanK1ndK9kk9G0901qj9HyHijCZX',
  'hIYHHT5Ksb3Vm7Xba1imtmnoy35FHkVU/tr/AKd//Hv/AK1H9tf9O/8A49/9avI/1Kzb/nz/AOTR/wDkj2P+Ij5T/wA/v/JZf5H/',
  '0/08/s4elH9nD0rvP7N9qP7N9q/yN/tQ/Wf7Z8z5p+KOnf8AIM4/57f+yV5L/Z3tX0t8UdN/5BnH/Pb/ANkryb+zfav9bPoyZp/x',
  'g+X6/wDP3/09UP8AJP6Tmc/8ZxmGv/Pr/wBM0zgv7O9q+tP7OHpXhH9m+1fWf9m+1fg303M0/wCRTr/z+/8AcR+8/Qjzn/kba/8A',
  'Pn/3KcH/AGcPStfSrPyvNwOu3+tdL/ZvtU0Vn5WeMZr+dPo9ZjzcYYJf9fP/AE1M/rbxOzXnyPERv/L/AOlxMzyfajyfatjyKPIr',
  '/Tb25/JP1k67yT6UeSfStjyPajyPav5D9uf159ZOE8QQn9xx/e/pXOeT7V3fiCD/AFH/AAL+lc55Ff0bwHX/AOEmj/29/wClM/nL',
  'jzE/8K1b/t3/ANJRj+T7UeT7VseRR5FfX+3PkPrJ/9k=',
].join('');
const specs = [['https://example.com/', 'text/html; charset=utf-8', '<!doctype html><html lang="ja"><title>サンプル</title><p>HARテスト</p></html>', 'document'], ['https://example.com/assets/app.js?v=3', 'application/javascript', 'console.log("app");', 'script'], ['https://cdn.example.net/lib/app.js', 'text/javascript', 'console.log("library");', 'script'], ['https://example.com/assets/style.css', 'text/css', 'body { color: #345; }', 'stylesheet'], ['https://example.com/img/logo.png', 'image/png', pngBase64, 'image', 'base64'], ['https://example.com/img/icon.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="blue"/></svg>', 'image'], ['https://api.example.com/v1/users?page=2', 'application/json', '{"users":[{"name":"花子"}]}', 'fetch'], ['https://api.example.com/v1/login', 'application/json', '{"ok":true}', 'xhr'], ['https://example.com/docs/readme', 'text/plain; charset=utf-8', 'こんにちは、HAR抽出テストです。', 'other'], ['https://example.com/img/photo.jpeg', 'image/jpeg', '/9j/2Q==', 'image', 'base64'], ['https://example.com/img/cached.png', 'image/png', undefined, 'image', undefined, 304], ['https://example.com/beacon', 'text/plain', undefined, 'other', undefined, 204], ['https://example.com/img/logo.png', 'image/png', pngBase64, 'image', 'base64'], ['https://example.com/fonts/a.woff2', 'font/woff2', 'd09GMgAAAAA=', 'font', 'base64']];
specs.push(['https://example.com/pdf/pattern.png', 'image/png', patternPngBase64, 'image', 'base64']);
specs.push(['https://example.com/pdf/pattern.jpg', 'image/jpeg', sampleJpegBase64, 'image', 'base64']);
specs.push(['https://example.com/pdf/shapes.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">' + '<rect width="120" height="80" fill="#eaf1ff"/>' + '<circle cx="35" cy="40" r="25" fill="#245bce"/>' + '<path d="M75 15L110 65H65Z" fill="#e95b40" fill-opacity="0.6"/></svg>', 'image']);
const entries = specs.map(([url, mimeType, text, resourceType, encoding, status = 200], i) => {
  const size = text === undefined ? 0 : Buffer.byteLength(text, encoding === 'base64' ? 'base64' : 'utf8');
  const request = {
    method: i === 7 ? 'POST' : 'GET',
    url,
    httpVersion: 'HTTP/2',
    headers: [{
      name: 'Accept',
      value: '*/*'
    }],
    queryString: [...new URL(url).searchParams].map(([name, value]) => ({
      name,
      value
    })),
    cookies: [],
    headersSize: -1,
    bodySize: i === 7 ? 27 : 0
  };
  if (i === 7) request.postData = {
    mimeType: 'application/json',
    text: '{"username":"テスト"}'
  };
  return {
    startedDateTime: `2026-11-02T00:00:${String(i).padStart(2, '0')}.000Z`,
    time: 10 + i * 2,
    _resourceType: resourceType,
    request,
    response: {
      status,
      statusText: status === 304 ? 'Not Modified' : status === 204 ? 'No Content' : 'OK',
      httpVersion: 'HTTP/2',
      headers: [{
        name: 'Content-Type',
        value: mimeType
      }],
      cookies: [],
      content: {
        size,
        mimeType,
        ...(text === undefined ? {} : {
          text
        }),
        ...(encoding ? {
          encoding
        } : {})
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: size
    },
    cache: {},
    timings: {
      send: 1,
      wait: 8 + i * 2,
      receive: 1
    }
  };
});
export const sampleHar = {
  log: {
    version: '1.2',
    creator: {
      name: 'Local HAR sample',
      version: '1.0'
    },
    entries
  }
};
await writeFile(new URL('./sample.har', import.meta.url), JSON.stringify(sampleHar, null, 2) + '\n');
