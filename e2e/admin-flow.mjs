// Drives the admin UI end to end as a signed-in admin (see e2e/run.sh).
import { chromium } from 'playwright';
import { jwt } from './jwt.mjs';

// base: the staff app (admin, judge); view: the public viewer app.
const [base, secret, out, view] = process.argv.slice(2);
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const session = {
  access_token: jwt(secret, 'authenticated', ADMIN), refresh_token: 'e2e', token_type: 'bearer',
  expires_in: 315360000, expires_at: 4102444800,
  user: { id: ADMIN, aud: 'authenticated', role: 'authenticated', email: 'admin@ilca.test' },
};

const JUDGE = '00000000-0000-0000-0000-0000000000a2';
const judgeSession = { ...session, access_token: jwt(secret, 'authenticated', JUDGE),
  user: { id: JUDGE, aud: 'authenticated', role: 'authenticated', email: 'judge@ilca.test' } };

const browser = await chromium.launch();
const problems = [];
async function page(lang, viewport = { width: 1280, height: 900 }, as = session) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(([s, l]) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify(s));
    localStorage.setItem('lang', l);
  }, [as, lang]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  // 502: the stubbed invite email failure (invite step)
  p.on('console', (m) => { if (m.type() === 'error' && !/realtime|websocket|status of 502/i.test(m.text())) problems.push(`console: ${m.text()}`); });
  p.on('response', (r) => { if (r.url().includes('/rest/v1') && r.status() >= 400) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return p;
}
const step = (name) => console.log(`- ${name}`);
const expectText = async (p, text) => {
  try { await p.getByText(text, { exact: false }).first().waitFor({ timeout: 5000 }); }
  catch (e) {
    const errs = await p.locator('.error').allInnerTexts();
    await p.screenshot({ path: `${out}/failure.png`, fullPage: true });
    throw new Error(`waiting for "${text}" failed; page errors: ${JSON.stringify(errs)}; problems: ${JSON.stringify(problems)}`);
  }
};

step('home page with nothing live: no "Live now"; menu link to the competitions list');
{
  const home = await page('en', { width: 1280, height: 900 }, null);
  const reqs = [];
  home.on('request', (r) => { if (r.url().includes('/rest/v1/')) reqs.push(r.url().split('/rest/v1/')[1].split('?')[0]); });
  const t0 = Date.now();
  await home.goto(`${view}/`);
  await home.getByRole('heading', { name: 'Upcoming' }).waitFor();
  console.log(`home (empty): ${Date.now() - t0} ms to content`);
  await home.getByRole('heading', { name: /National ranking/ }).waitFor();
  await home.waitForLoadState('networkidle');
  if (await home.locator('.home-live').count()) problems.push('home shows "Live now" with nothing live');
  // the ranking: this season, and the previous one when this season has no points yet
  if (!/^rpc\/home_page,rpc\/season_rankings(,rpc\/season_rankings)?$/.test(reqs.join())) problems.push(`home requests (empty): ${reqs.join(', ')}`);
  await home.waitForTimeout(6000); // nothing live: the live part is asked again only after 60 s
  if (reqs.filter((r) => r === 'rpc/home_page').length !== 1) problems.push(`home polls with nothing live: ${reqs.join(', ')}`);
  await home.locator('.nav').getByRole('link', { name: 'Competitions' }).click();
  await home.waitForURL(/\/competitions$/);
  await home.locator('h1', { hasText: 'Competitions' }).waitFor();
  await home.locator('.brand').click();
  await home.waitForURL((u) => u.pathname === '/');
  await home.getByRole('heading', { name: 'Upcoming' }).waitFor();
  await home.close();
}

const p = await page('en');
step('create competition');
await p.goto(`${base}/admin`);
await p.getByLabel('Name (English)').fill('Israeli Cup #2');
await p.getByLabel('Name (Hebrew)').fill('גביע ישראל 2');
await p.getByLabel('Starts').fill('2026-11-20');
await p.getByRole('button', { name: 'Create' }).click();
await p.waitForURL(/\/admin\/competition\//);
const compUrl = p.url();

step('add category + round + 4 boulders');
const catForm = p.locator('form', { has: p.getByRole('heading', { name: 'New category' }) });
await catForm.getByLabel('Name (English)').fill('Senior Women');
await catForm.getByLabel('Name (Hebrew)').fill('בוגרות');
await catForm.getByRole('button', { name: 'Add' }).click();
await expectText(p, 'Senior Women');
await p.getByRole('button', { name: 'Add round' }).click();
await expectText(p, 'Judges & corrections');
const boulders = p.getByLabel('Boulders').first();
await boulders.fill('4');
await boulders.press('Tab');
await p.waitForFunction(() => document.querySelector('.admin-row input[type=number]')?.value === '4');

step('import roster CSV');
await p.locator('input[type=file]').setInputFiles(new URL('./roster.csv', import.meta.url).pathname);
await expectText(p, 'Preview');
const preview = await p.locator('.import-preview').innerText();
for (const want of ['New categories: 0', 'New climbers: 3', 'Registrations: 3']) {
  if (!preview.includes(want)) problems.push(`import preview missing "${want}": ${preview}`);
}
await p.getByRole('button', { name: 'Import', exact: true }).click();
await expectText(p, 'Import complete');
await expectText(p, 'Registrations (3)');
if ((await p.getByLabel('Age class').evaluateAll((els) => els.map((e) => e.value))).join(',') !== ',,בנות U19') {
  problems.push('age classes not imported from the group column');
}

step('publish competition, round goes live');
await p.getByLabel('Status').selectOption('published');
await p.getByRole('button', { name: 'Save' }).click();
await p.getByRole('button', { name: 'Go live' }).click();
await expectText(p, 'Close round');
await p.screenshot({ path: `${out}/admin-competition-en.png`, fullPage: true });

step('assign judge to whole round');
await p.getByRole('link', { name: 'Judges & corrections' }).first().click();
await p.waitForURL(/\/admin\/round\//);
const roundId = p.url().split('/').pop();
await p.locator('select[name=judge]').selectOption({ label: 'Judge Yossi' });
await p.getByRole('button', { name: 'Assign' }).click();
await p.locator('.admin-row', { hasText: 'Judge Yossi' }).getByText('Whole round').waitFor();

step('correct a result, check audit');
await p.locator('tr', { hasText: 'נועה לוי' }).getByRole('button', { name: '✎' }).click();
await p.getByLabel('Attempts 1').fill('2');
await p.getByLabel('Zone 1').fill('1');
await p.getByLabel('Top 1').fill('2');
await p.getByRole('button', { name: 'Save' }).click();
await p.locator('tr', { hasText: 'נועה לוי' }).getByText('2/1/2').first().waitFor();
await p.locator('.panel', { hasText: 'Audit log' }).getByText('By Admin ILCA').waitFor();
step('reject an impossible result (top before zone)');
await p.locator('tr', { hasText: 'תמר כהן' }).getByRole('button', { name: '✎' }).click();
await p.getByLabel('Attempts 1').fill('3');
await p.getByLabel('Zone 1').fill('3');
await p.getByLabel('Top 1').fill('2');
await p.getByRole('button', { name: 'Save' }).click();
await p.getByText('✗ Boulder 1').waitFor();
await p.screenshot({ path: `${out}/admin-round-en.png`, fullPage: true });

step('public results: corrected score, "–" for not climbed, age-class filter');
await p.goto(`${view}/round/${roundId}`);
await p.locator('tr', { hasText: 'נועה' }).getByText('24.9').waitFor();
const tamarRow = (await p.locator('tr', { hasText: 'תמר' }).innerText()).replace(/\s+/g, ' ');
if (!/^– .*–$/.test(tamarRow.trim())) problems.push(`not-climbed row should show – for rank and score: "${tamarRow}"`);
await p.getByRole('button', { name: 'בנות U19' }).click();
if ((await p.locator('tbody tr').count()) !== 1) problems.push('age-class filter should show one climber');
await p.screenshot({ path: `${out}/results-filter-en.png`, fullPage: true });

step('judge pad: claim, score, lock; admin sees the lock, opens an appeal; public sees it');
const jp = await page('en', { width: 1280, height: 900 }, judgeSession);
await jp.goto(`${base}/judge`);
await jp.getByRole('link', { name: 'Boulder 2' }).click();
await jp.getByText(/1 \/ 3/).waitFor();                       // one climber at a time, in start order
await jp.getByRole('button', { name: /List/ }).click();
await jp.locator('.starter-list').getByRole('button', { name: /מאיה גל/ }).click();
await jp.locator('.pad-head').getByText('מאיה גל').waitFor();
// On the wall: opening a climber on the pad is not enough; the judge marks it (or counts an attempt).
const vp = await page('en');
await vp.goto(`${view}/round/${roundId}`);
await vp.locator('tr', { hasText: 'מאיה גל' }).waitFor();
await vp.waitForLoadState('networkidle');
if (await vp.locator('.on-wall, .on-wall-row').count()) problems.push('climber shown on the wall before the judge marked it');
await jp.getByRole('button', { name: /On the wall/ }).click();
await jp.getByText('Shown to the public as climbing now').waitFor();
await jp.locator('.pad').screenshot({ path: `${out}/judge-on-wall-en.png` });
await vp.reload();
await vp.locator('.on-wall').getByText('מאיה גל').waitFor();
await vp.locator('tr.on-wall-row', { hasText: 'מאיה גל' }).locator('.climbing-badge').waitFor();
await vp.screenshot({ path: `${out}/results-on-wall-en.png`, fullPage: true });
step('home page with a live round: "Live now" with who is on the wall, refreshed every 5 s');
{
  const home = await page('en', { width: 1280, height: 900 }, null);
  const reqs = [];
  const bodies = [];
  home.on('request', (r) => {
    if (!r.url().includes('/rest/v1/')) return;
    reqs.push(r.url().split('/rest/v1/')[1].split('?')[0]);
    if (r.url().includes('rpc/home_page')) bodies.push(r.postData() ?? '');
  });
  const t0 = Date.now();
  await home.goto(`${view}/`);
  const live = home.locator('.home-live');
  await live.getByRole('heading', { name: 'Live now' }).waitFor();
  console.log(`home (live): ${Date.now() - t0} ms to content`);
  await live.locator('.home-card', { hasText: 'Israeli Cup #2' }).getByText('Senior Women · Qualification').waitFor();
  await live.locator('.on-wall-item', { hasText: 'מאיה גל' }).waitFor();
  if ((await live.getByRole('link', { name: /Israeli Cup #2/ }).getAttribute('href')) !== `/round/${roundId}`) problems.push('live round card does not link to the round');
  await home.screenshot({ path: `${out}/home-live-en.png`, fullPage: true });
  const n = reqs.filter((r) => r === 'rpc/home_page').length;
  await home.waitForTimeout(5600);
  if (reqs.filter((r) => r === 'rpc/home_page').length <= n) problems.push('home does not refresh while a round is live');
  if (bodies.slice(1).some((b) => !b.includes('p_live_only'))) problems.push(`home refresh asks for the whole page: ${bodies.join(' | ')}`);
  if (await home.locator('.cards').getByText('Israeli Cup #2').count()) problems.push('a live competition is also listed under upcoming');
  const he390 = await page('he', { width: 390, height: 844 }, null);
  await he390.goto(`${view}/`);
  await he390.locator('.home-live').getByRole('heading', { name: 'עכשיו בשידור' }).waitFor();
  await he390.locator('.home-live .on-wall-item', { hasText: 'מאיה גל' }).waitFor();
  await he390.getByRole('heading', { name: /מדרג לאומי/ }).waitFor();
  await he390.waitForLoadState('networkidle');
  if (await he390.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) problems.push('home (he, 390px, live) scrolls sideways');
  await he390.screenshot({ path: `${out}/home-live-he-390.png`, fullPage: true });
  await he390.close();
  await home.close();
}
await jp.getByRole('button', { name: 'Zone' }).click();          // zone before any attempt: asks first
await jp.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
await jp.getByRole('button', { name: 'Add attempt' }).click();
await jp.getByRole('button', { name: 'Add attempt' }).click();
await jp.getByRole('button', { name: 'Remove attempt' }).click(); // a mistaken tap
await jp.getByRole('button', { name: 'Zone' }).click();
await jp.locator('.pad-status').getByText('Saved').waitFor();
await jp.locator('.score-box').getByText('10.0').waitFor();       // live points: zone on the 1st attempt
await jp.getByRole('button', { name: /Next · lock/ }).click();
await jp.getByRole('dialog').getByText(/1 Attempts · Zone 1 · no Top/).waitFor();
await jp.getByRole('dialog').getByRole('button', { name: 'Yes, lock' }).click();
await jp.getByText('This result is locked').waitFor();
await jp.screenshot({ path: `${out}/judge-locked-en.png` });
await vp.reload();                                             // locking takes the climber off the wall
await vp.locator('tr', { hasText: 'מאיה גל' }).waitFor();
await vp.waitForLoadState('networkidle');
if (await vp.locator('.on-wall, .on-wall-row').count()) problems.push('locked climber still shown on the wall');
await jp.getByRole('link', { name: /Boulders/ }).click();          // back to picking a boulder
await jp.getByRole('link', { name: 'Boulder 2' }).waitFor();
await p.goto(`${base}/admin/round/${roundId}`);
await p.locator('tr', { hasText: 'מאיה גל' }).getByText(/🔒1\/1/).waitFor();
const appealForm = p.locator('.panel', { hasText: 'Appeals' }).locator('form');
await appealForm.locator('select[name=climber]').selectOption({ label: '201 · מאיה גל' });
await appealForm.locator('select[name=boulder]').selectOption({ label: 'Boulder 2' });
await appealForm.getByPlaceholder('Reason').fill('zone disputed');
await appealForm.getByRole('button', { name: 'Open appeal' }).click();
await p.locator('.panel', { hasText: 'Appeals' }).getByText('zone disputed').waitFor();
await p.goto(`${view}/round/${roundId}`);
await p.locator('tr', { hasText: 'מאיה גל' }).locator('.appeal-badge').waitFor();
await p.getByText(/^Updated /).waitFor();
await p.getByRole('button', { name: /PDF/ }).waitFor();
await p.screenshot({ path: `${out}/results-appeal-en.png`, fullPage: true });

step('final: quota 1, generated start list has only the leader');
await p.goto(compUrl);
await p.locator('select[name=kind]').selectOption('final');
await p.getByRole('button', { name: 'Add round' }).click();
const finalRow = p.locator('.admin-row', { hasText: 'Final' });
await finalRow.waitFor();
const quota = finalRow.getByLabel('Advance from previous round');
await quota.fill('1');
await quota.press('Tab');
await p.waitForTimeout(500);
await finalRow.getByRole('button', { name: 'Generate start list' }).click();
await finalRow.getByText('Starters: 1').waitFor();

step('invite a judge: share link (WhatsApp-safe landing page), email failure explained');
// The edge function isn't in the e2e stack: stub it and check what the app sends.
let inviteBody = null;
let fnOrigin = '';
await p.route('**/functions/v1/invite-judge', async (route) => {
  inviteBody = route.request().postDataJSON();
  fnOrigin = new URL(route.request().url()).origin;
  if (inviteBody.mode === 'email') return route.fulfill({ status: 502, contentType: 'application/json',
    body: JSON.stringify({ error: 'email_failed', message: 'Error sending invite email' }) });
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'link',
    link: `${fnOrigin}/auth/v1/verify?token=abc&type=invite&redirect_to=${encodeURIComponent(inviteBody.redirect_to)}` }) });
});
await p.goto(`${base}/admin/people`);
const invite = p.locator('.panel', { hasText: 'Invite a judge' });
await invite.getByPlaceholder('Full name').fill('Dana Judge');
await invite.getByPlaceholder('Email').fill('dana@ilca.test');
await invite.getByRole('button', { name: /Send by email/ }).click();
await invite.getByText(/Sending the email failed/).waitFor();
await invite.getByRole('button', { name: /Share link/ }).click();
await invite.getByText(/Invite link for dana@ilca.test/).waitFor();
if (inviteBody.full_name !== 'Dana Judge' || inviteBody.email !== 'dana@ilca.test' || !inviteBody.redirect_to.endsWith('/set-password'))
  problems.push(`invite request: ${JSON.stringify(inviteBody)}`);
const shared = await invite.locator('.invite-link input').inputValue();
if (!shared.startsWith(`${base}/invite#`)) problems.push(`shared link is not the landing page: ${shared}`);
await invite.getByRole('link', { name: 'WhatsApp' }).waitFor();
await p.screenshot({ path: `${out}/invite-judge-en.png`, fullPage: true });
const landing = await page('en', { width: 390, height: 800 }, null);
await landing.goto(shared);
const cont = landing.getByRole('link', { name: 'Continue to choose a password' });
await cont.waitFor();
await landing.screenshot({ path: `${out}/invite-landing-en.png`, fullPage: true });
if (!(await cont.getAttribute('href')).startsWith(`${fnOrigin}/auth/v1/verify?token=abc`)) problems.push('invite landing does not continue to Supabase');
// The email template puts the link in raw (not encoded): the page must stay on /invite.
await landing.goto(`${base}/invite#${fnOrigin}/auth/v1/verify?token=raw1&type=invite&redirect_to=x`);
await landing.reload();
await landing.getByRole('link', { name: 'Continue to choose a password' }).waitFor();
if (!landing.url().includes('/invite#')) problems.push(`raw invite link left /invite: ${landing.url()}`);
await landing.goto(`${base}/invite#https://evil.example/auth/v1/verify?token=x`);
await landing.reload(); // same page, only the hash changed
await landing.getByText(/invalid or has expired/).waitFor();
await p.unroute('**/functions/v1/invite-judge');

step('delete an account: asks first, never your own (function stubbed)');
let deleteBody = null;
await p.route('**/functions/v1/delete-account', (route) => {
  deleteBody = route.request().postDataJSON();
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'deleted', profile_removed: false }) });
});
await p.goto(`${base}/admin/people`);
const adminRow = p.locator('.admin-table').first().locator('tr', { hasText: 'admin@ilca.test' });
await adminRow.waitFor();
if (await adminRow.getByRole('button', { name: 'Delete' }).count()) problems.push('admin can delete their own account');
await p.locator('tr', { hasText: 'parent@ilca.test' }).getByRole('button', { name: 'Delete' }).click();
const del = p.getByRole('dialog', { name: 'Delete this account?' });
await del.getByText('parent@ilca.test').waitFor();
await p.screenshot({ path: `${out}/delete-account-en.png` });
await del.getByRole('button', { name: 'Cancel' }).click();
if (deleteBody) problems.push('cancel still deleted the account');
await p.locator('tr', { hasText: 'parent@ilca.test' }).getByRole('button', { name: 'Delete' }).click();
await p.getByRole('dialog').getByRole('button', { name: 'Delete for good' }).click();
await p.getByText('Account deleted: parent@ilca.test').waitFor();
if (!deleteBody?.user_id) problems.push(`delete request: ${JSON.stringify(deleteBody)}`);
await p.unroute('**/functions/v1/delete-account');

step('people: link parent account, make judge a coach, link athlete');
await p.goto(`${base}/admin/people`);
const parentRow = p.locator('tr', { hasText: 'parent@ilca.test' });
await parentRow.locator('select').selectOption({ label: 'נועה לוי · מטפסי תל אביב' });
await p.locator('tr', { hasText: 'נועה לוי' }).getByText('parent@ilca.test').waitFor();
const coachBox = p.locator('tr', { hasText: 'judge@ilca.test' }).getByLabel('Coach');
await coachBox.click(); // controlled: flips once the server confirms and the list reloads
await p.waitForFunction(() => [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('judge@ilca.test'))
  ?.querySelectorAll('input[type=checkbox]')[1]?.checked);
await p.locator('.panel', { hasText: 'Coaches & athletes' }).locator('select').selectOption({ label: 'Judge Yossi' });
const coachPanel = p.locator('.panel', { hasText: 'Coaches & athletes' });
await coachPanel.getByPlaceholder(/Search/).fill('תמר');
await coachPanel.locator('.picker-hits').getByRole('button', { name: 'Add' }).click();
await coachPanel.locator('.admin-row', { hasText: 'תמר כהן' }).waitFor();
await p.screenshot({ path: `${out}/admin-people-en.png`, fullPage: true });

step('rankings: season + series, international result, public table');
await p.goto(compUrl);
await p.getByLabel('Season').fill('2026-27');
await p.getByLabel('Series (rankings)').selectOption('premier_league');
await p.getByRole('button', { name: 'Save' }).first().click();
await p.waitForTimeout(500);
await p.goto(`${base}/admin/rankings`);
await p.getByLabel('Season').fill('2026-27');
const intlForm = p.locator('form', { hasText: 'Event type' });
await intlForm.getByPlaceholder(/Search/).fill('נועה');
await intlForm.locator('.picker-hits').getByRole('button', { name: 'Select climber' }).click();
await intlForm.getByText('נועה לוי').first().waitFor();
await intlForm.getByLabel('Event type').selectOption('world_cup');
await intlForm.getByLabel('Event name').fill('WC Bern');
await intlForm.getByLabel('Starts').fill('2026-06-20');
await intlForm.getByLabel('Place').fill('5');
await intlForm.getByLabel('Field size').fill('57');
await intlForm.getByLabel('Last round').selectOption('final');
await intlForm.getByRole('button', { name: 'Add' }).click();
await p.locator('tr', { hasText: 'WC Bern' }).waitFor(); // 2026-27 uses the ILCA 2027 edition: per-event senior points are 0
step('rankings admin: IFSC sync run and athlete to confirm; ignore hides the athlete');
{
  const ifsc = p.locator('.ifsc-sync');
  await ifsc.getByRole('button', { name: 'Run now' }).waitFor();
  await ifsc.locator('li', { hasText: '3 added · 1 linked · 1 to confirm · 80 world ranking' }).waitFor();
  const row = ifsc.locator('li', { hasText: 'Dana Suggestion' });
  await row.getByText('Dana Suggested').waitFor();
  await row.getByRole('button', { name: 'Confirm' }).waitFor();
  await p.screenshot({ path: `${out}/admin-ifsc-sync-en.png`, fullPage: true });
  await row.getByRole('button', { name: 'Not on the team' }).click();
  await row.waitFor({ state: 'detached' });
}

await p.goto(`${view}/rankings?season=2026-27&c=senior&g=female&d=boulder`);
await p.locator('.edition-line', { hasText: /^(Per|לפי) / }).filter({ hasText: 'אמות מידה לנבחרות 2027' }).waitFor();
await p.screenshot({ path: `${out}/rankings-en.png`, fullPage: true });

step('rankings and climber pages: one data request each');
{
  const pub = await (await browser.newContext()).newPage();
  const reqs = [];
  const t0 = { v: 0 };
  pub.on('request', (r) => { if (r.url().includes('/rest/v1/')) reqs.push(r.url().split('/rest/v1/')[1].split('?')[0]); });
  t0.v = Date.now();
  await pub.goto(`${view}/rankings?season=2026-27&c=senior&g=female&d=boulder`);
  await pub.locator('table.rankings tbody tr').first().waitFor();
  console.log(`rankings: ${Date.now() - t0.v} ms, requests: ${reqs.join(', ')}`);
  if (reqs.filter((r) => r !== 'competitions').join() !== 'rpc/season_rankings') problems.push(`rankings requests: ${reqs.join(', ')}`);
  const href = await pub.locator('table.rankings a.athlete').first().getAttribute('href');
  reqs.length = 0;
  t0.v = Date.now();
  await pub.goto(`${view}${href}`);
  await pub.locator('h1').first().waitFor();
  await pub.locator('.climber-stats, .muted').first().waitFor();
  console.log(`climber page: ${Date.now() - t0.v} ms, requests: ${reqs.join(', ')}`);
  if (reqs.join() !== 'rpc/climber_page') problems.push(`climber page requests: ${reqs.join(', ')}`);
  if (!(await pub.getByText(/Counts for the rankings|נספרת במדרג/).count())) problems.push('climber page: ranked competition has no "counts for the rankings" tag');
  await pub.screenshot({ path: `${out}/climber-en.png`, fullPage: true });
  await pub.close();
}

step('competition finished: home shows latest results with the winner, nothing live, favorites');
await p.goto(compUrl);
await p.getByRole('button', { name: 'Close round' }).click();
await p.getByRole('button', { name: 'Close round' }).waitFor({ state: 'detached' });
await p.getByLabel('Status').selectOption('finished');
await p.getByRole('button', { name: 'Save' }).first().click();
await p.waitForTimeout(500);
{
  const home = await page('en', { width: 1280, height: 900 }, null);
  await home.goto(`${view}/`);
  const latest = home.locator('.home-section', { has: home.getByRole('heading', { name: 'Latest results' }) });
  const card = latest.locator('.home-card', { hasText: 'Israeli Cup #2' });
  await card.waitFor();
  const li = card.locator('.winners li', { hasText: 'Senior Women' });
  await li.waitFor();
  const winner = li.locator('.winner-names a').first();
  const winnerHref = await winner.getAttribute('href');
  if (!/^\/climber\//.test(winnerHref ?? '')) problems.push(`winner does not link to the climber: ${winnerHref}`);
  if (!(await winner.innerText()).includes('נועה')) problems.push(`winner of Senior Women: ${await winner.innerText()}`);
  await home.waitForLoadState('networkidle');
  if (await home.locator('.home-live').count()) problems.push('home shows "Live now" after the round closed');
  if (await home.locator('.home-section', { hasText: 'Your favorites' }).count()) problems.push('home shows favorites without any');
  // star the winner: the favorites section appears, with one more request
  await home.evaluate((id) => localStorage.setItem('favorites', JSON.stringify([id])), winnerHref.split('/').pop());
  const reqs = [];
  home.on('request', (r) => { if (r.url().includes('/rest/v1/')) reqs.push(r.url().split('/rest/v1/')[1].split('?')[0]); });
  const t0 = Date.now();
  await home.reload();
  const fav = home.locator('.home-section', { has: home.getByRole('heading', { name: /Your favorites/ }) });
  await fav.locator('.event', { hasText: 'נועה' }).getByText(/Israeli Cup #2 · 1\//).waitFor();
  console.log(`home (favorites): ${Date.now() - t0} ms to favorites`);
  await home.waitForLoadState('networkidle');
  if (reqs.slice().sort().join() !== 'rpc/favorites_page,rpc/home_page,rpc/season_rankings') problems.push(`home requests (favorites): ${reqs.join(', ')}`);
  console.log(`home requests: ${reqs.join(', ')}`);
  const rk = home.locator('.home-ranking', { hasText: 'Boulder · Women' });
  await rk.locator('li', { hasText: 'נועה' }).waitFor();
  await home.screenshot({ path: `${out}/home-finished-en.png`, fullPage: true });
  await home.getByRole('link', { name: /Full ranking/ }).click();
  await home.waitForURL(/\/rankings\?season=2026-27/);
  await home.locator('.edition-line').waitFor();
  const he390 = await page('he', { width: 390, height: 844 }, null);
  await he390.addInitScript((id) => localStorage.setItem('favorites', JSON.stringify([id])), winnerHref.split('/').pop());
  await he390.goto(`${view}/`);
  await he390.getByRole('heading', { name: 'תוצאות אחרונות' }).waitFor();
  await he390.getByRole('heading', { name: /המועדפים שלך/ }).waitFor();
  await he390.locator('.home-ranking li').first().waitFor();
  await he390.waitForLoadState('networkidle');
  if (await he390.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) problems.push('home (he, 390px) scrolls sideways');
  await he390.screenshot({ path: `${out}/home-he-390.png`, fullPage: true });
  await he390.emulateMedia({ colorScheme: 'dark' });
  await he390.screenshot({ path: `${out}/home-he-390-dark.png`, fullPage: true });
  await he390.close();
  await home.close();
}

step('two apps: the viewer is view-only, the staff app needs sign-in');
const anon = await (await browser.newContext()).newPage();
await anon.goto(`${view}/admin`);
await anon.locator('h1').first().waitFor();
if (await anon.getByRole('link', { name: /Sign in|כניסה/ }).count()) problems.push('viewer app shows a sign-in link');
if (await anon.getByText(/Judges & corrections|New competition|תחרות חדשה/).count()) problems.push('viewer app renders admin pages');
await anon.goto(`${base}/admin`);
await anon.waitForURL(/\/login$/);
await anon.getByRole('button', { name: /Sign in|כניסה/ }).waitFor();

step('Hebrew + 390px screenshots');
const he = await page('he', { width: 390, height: 844 });
await he.goto(compUrl);
await he.getByText('בוגרות').first().waitFor();
await he.screenshot({ path: `${out}/admin-competition-he-390.png`, fullPage: true });
await he.goto(`${base}/admin/round/${roundId}`);
await he.getByText('יומן שינויים').waitFor();
await he.screenshot({ path: `${out}/admin-round-he-390.png`, fullPage: true });

await browser.close();
if (problems.length) {
  console.error(`E2E FAILED:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('E2E ADMIN FLOW PASSED');
