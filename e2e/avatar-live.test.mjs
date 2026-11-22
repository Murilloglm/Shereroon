import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { BASE_URL, launchChrome, startStack, waitFor } from './harness.mjs';
import { pngFile, imageShows } from './images.mjs';
let stack, browser, owner, viewer, guest;
let photo;
async function signup(page, username) {
  await page.getByTestId('auth-tab-criar').click(); await page.getByTestId('auth-username').fill(username);
  await page.getByTestId('auth-display-name').fill(username); await page.getByTestId('auth-password').fill('test-password-123');
  await page.getByTestId('auth-submit').click(); await page.getByTestId('account-settings-open').waitFor();
}
async function upload(page, color) {
  const path = pngFile(`photo-${color}.png`, 96, 96, color === 'blue' ? [50,150,250,255] : [180,50,200,255]);
  return page.evaluate(async ({ bytes }) => {
    const response = await fetch('/api/me/media/avatar', { method: 'POST', headers: { authorization: `Bearer ${localStorage.getItem('shareroom:conta')}` }, body: new Uint8Array(bytes) });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).profile.avatar;
  }, { bytes: [...readFileSync(path)] });
}
async function photoShows(page, reference, scope) {
  const img = (scope ?? page).locator(`img[src$="/api/media/${reference.slice(8)}"]`).first();
  await img.waitFor(); await waitFor(() => imageShows(img), 'photo has decoded pixels');
}
before(async () => {
  stack = await startStack({ DATABASE_URL: '', COSMIC_DEV_POINTS: '1' }); browser = await launchChrome({ headless: true });
  owner = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  viewer = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  for (const [page, name] of [[owner,'photoowner'],[viewer,'photoviewer']]) { page.setDefaultTimeout(20000); await page.goto(BASE_URL); await signup(page,name); }
  await owner.getByTestId('rail-create').click(); await owner.getByTestId('group-name').fill('Photos'); await owner.getByTestId('group-create').click(); await owner.getByTestId('chat').waitFor();
  await owner.getByTestId('group-menu').click(); await owner.getByTestId('group-invite').click();
  await waitFor(async () => /#\/convite\//.test(await owner.getByTestId('group-invite-link').inputValue()), 'invite');
  const invite = await owner.getByTestId('group-invite-link').inputValue(); await owner.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).first().click();
  await viewer.goto(invite); await viewer.getByTestId('join-accept').click(); await viewer.getByTestId('chat').waitFor();
});
after(async () => { await browser?.close(); await stack?.stop(); });

test('photo is decoded in own footer and remote member/chat views; updates without reload', async () => {
  photo = await upload(owner,'blue');
  await photoShows(owner,photo,owner.getByTestId('user-panel'));
  await photoShows(viewer,photo);
  await owner.getByTestId('chat-input').fill('Photo message'); await owner.getByTestId('chat-input').press('Enter');
  const message = viewer.getByTestId('chat-message').filter({hasText:'Photo message'});
  await photoShows(viewer,photo,message);
  photo = await upload(owner,'purple');
  await photoShows(owner,photo,owner.getByTestId('user-panel'));
  await photoShows(viewer,photo,message);
  const media = await owner.request.get(`${BASE_URL}/api/media/${photo.slice(8)}`);
  assert.equal(media.status(),200); assert.match(media.headers()['cache-control'],/immutable/);
});

test('voice header shows the photo and a logged-in private caller shares it with an anonymous guest', async () => {
  await owner.getByTestId('channel').filter({hasText:/^Sala de voz$/}).click();
  await owner.getByTestId('connection').waitFor();
  await photoShows(owner,photo,owner.getByRole('button',{name:'Sua conta nesta sala'}));
  await owner.getByTestId('dock-leave').click();
  await owner.goto(`${BASE_URL}/#/salas`); await owner.getByTestId('home-user-name').fill('Photoowner'); await owner.getByTestId('home-room-name').fill('Private photo'); await owner.getByTestId('home-create').click(); await owner.getByTestId('room').waitFor();
  await photoShows(owner,photo,owner.getByRole('button',{name:'Sua conta nesta sala'}));
  const changeLook = (method, path, body) => owner.evaluate(async ({method,path,body}) => {
    const response = await fetch(path, {method, headers: {authorization: 'Bearer '+localStorage.getItem('shareroom:conta'), 'content-type':'application/json'}, body: JSON.stringify(body)});
    if (!response.ok) throw Error(await response.text());
  }, {method,path,body});
  await changeLook('POST','/api/dev/points',{amount:1000});
  for (const [itemId,expectedPrice] of [['neon-cor-nome',250],['hinata-cor-nome',250],['hinata-decoracao',150]]) {
    await changeLook('POST','/api/shop/buy',{itemId,expectedPrice});
  }
  await changeLook('PUT','/api/me/equipped',{slot:'decoracao',itemId:'hinata-decoracao',variant:'original'});
  await changeLook('PUT','/api/me/equipped',{slot:'cor-nome',itemId:'neon-cor-nome',variant:'original'});
  const invite = await owner.getByTestId('room-link').inputValue();
  guest = await (await browser.newContext({viewport:{width:1400,height:950}})).newPage(); guest.setDefaultTimeout(20000);
  await guest.goto(invite); await guest.getByTestId('gate-name').fill('Anonymous'); await guest.getByTestId('gate-join').click(); await guest.getByTestId('room').waitFor();
  await photoShows(guest,photo);
  const ownerCard = guest.getByTestId('call-card').filter({hasText:'Photoowner'});
  const cardName = ownerCard.getByTestId('call-card-name');
  await ownerCard.locator('[data-decoration="hinata-decoracao"]').evaluate(img => img.decode());
  await ownerCard.locator('[data-theme-id=hinata] [data-motif=lily]').first().waitFor();
  await photoShows(guest,photo,ownerCard);
  await cardName.locator('[data-name-style="neon-cor-nome"]').waitFor();
  await changeLook('PUT','/api/me/equipped',{slot:'cor-nome',itemId:'hinata-cor-nome',variant:'original'});
  await cardName.locator('[data-name-style="hinata-cor-nome"]').waitFor();
  assert.match(await cardName.locator('[data-name-style]').evaluate(el => getComputedStyle(el).backgroundImage), /linear-gradient/);
  photo = await upload(viewer,'blue'); // independent account must not replace the owner's signed avatar
  const ownerNew = await upload(owner,'blue');
  await photoShows(guest,ownerNew);
  await photoShows(owner,ownerNew,owner.getByRole('button',{name:'Sua conta nesta sala'}));
  await guest.screenshot({path:'e2e/.artifacts/private-avatar-live.png'});
});

test('an unavailable photo falls back to initials and a later photo recovers', async () => {
  await guest.route('**/api/media/**', (route) => route.abort());
  const unavailable = await upload(owner,'purple');
  const card = guest.getByTestId('call-card').filter({hasText:'Photoowner'});
  await waitFor(async () => await card.locator('[data-avatar="iniciais"]').textContent() === 'P', 'image failure falls back to the initial');
  assert.equal(await card.locator(`img[src$="/${unavailable.slice(8)}"]`).count(),0);
  await guest.unroute('**/api/media/**');
  const replacement = await upload(owner,'blue');
  await photoShows(guest,replacement,card);
});
