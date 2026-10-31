import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareInstagramImage } from './instagram-image-delivery.ts';
const origin = 'https://www.esantoscorretor.com.br';
const id = '71a2afa46ed35bc23da15049';
const source = `${origin}/api/media/${id}`;
test('stages stored JPEG bytes and gives Meta a public CDN URL', async () => {
  const result = await prepareInstagramImage(source, origin, async key => {
    assert.equal(key, id);
    return { mime: 'image/jpeg', data: btoa('\xff\xd8\xffabc') };
  }, async (key, bytes) => {
    assert.equal(key, id);
    assert.deepEqual([...bytes], [255,216,255,97,98,99]);
    return 'https://cdn.example/image.jpg';
  });
  assert.equal(result, 'https://cdn.example/image.jpg');
});
test('does not read the database for external or non-media URLs', async () => {
  for (const url of ['https://other.example/api/media/'+id, origin+'/api/private/'+id]) {
    assert.equal(await prepareInstagramImage(url, origin, async () => { throw Error('unexpected read'); }, async () => { throw Error('unexpected store'); }), url);
  }
});
test('missing and invalid media fail before container creation', async () => {
  await assert.rejects(prepareInstagramImage(source, origin, async () => null, async () => ''), /não foi encontrada/);
  await assert.rejects(prepareInstagramImage(source, origin, async () => ({mime:'image/png',data:btoa('PNG')}), async () => ''), /JPEG/);
});
