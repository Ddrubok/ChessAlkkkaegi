import assert from 'node:assert/strict';
import { chromium } from '../../../.orca/ui-check/node_modules/playwright/index.mjs';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

async function runSettingsQACheck() {
  console.log('--- Starting QA18 Settings & Mastery Verification ---');
  const server = await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),logLevel:'error',optimizeDeps:{noDiscovery:true,include:[]},server:{host:'127.0.0.1',port:0,open:false,hmr:false}});
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 }, locale: 'ko-KR' });
    page.setDefaultTimeout(8000);
    await page.route('https://**', r => r.abort());
    await page.route('**/qa-check-fixture', r => r.fulfill({
      contentType: 'text/html',
      body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/style.css"></head><body><button id="outside-btn">Outside</button><div id="app"></div></body></html>'
    }));

    await page.goto(origin + '/qa-check-fixture');

    // 1. Setup synthetic state and open settings modal
    await page.evaluate(async () => {
      const { progressStorage: s } = await import('/src/progress-storage.ts');
      const { openSettingsModal: open } = await import('/src/settings-modal.ts');
      const c = await import('/src/cosmetics.ts');
      const ui = await import('/src/mastery-ui.ts');
      window.s = s;
      window.openSettingsModal = open;
      window.cosmetics = c;
      window.masteryUi = ui;
      window.client = {
        rpc: async (n, a) => ({
          data: {
            data: a.p_data ?? {},
            revision: 1,
            capabilities: ['account-progress-v1', 'mastery-v1', 'banners-v1', 'cosmetics-v1']
          }
        })
      };
      await s.activate(window.client, 'test-qa18-user');
      open();
    });

    // Verify modal attributes and background inert (QA18-05)
    const modalRole = await page.locator('.settings-modal-overlay').getAttribute('role');
    const modalAria = await page.locator('.settings-modal-overlay').getAttribute('aria-modal');
    assert.equal(modalRole, 'dialog', 'Modal role must be dialog');
    assert.equal(modalAria, 'true', 'Modal aria-modal must be true');

    const outsideInert = await page.locator('#outside-btn').getAttribute('inert');
    assert.ok(outsideInert !== null, 'Outside element must be inert while modal is open');

    // 2. QA18-02: Test mobile 320px conditions overflow
    await page.locator('#tab-btn-banner').click();
    await page.locator('[data-slot-tab="badge"]').click();
    await page.locator('.cosmetics-option-card.locked').last().scrollIntoViewIfNeeded();

    const conditionBoxes = await page.locator('.cosmetics-option-cond').evaluateAll(es =>
      es.map(e => ({
        text: e.textContent,
        width: e.clientWidth,
        right: e.getBoundingClientRect().right
      }))
    );

    for (const item of conditionBoxes) {
      assert.ok(item.right <= 320, `Condition text "${item.text}" should not overflow 320px viewport, got right edge ${item.right}`);
    }
    console.log('✔ QA18-02 PASS: 320px mobile condition text wrapped and fits within screen bounds');

    // 3. QA18-03: Test draft retention across tab switches
    await page.locator('[data-slot-tab="banner"]').click();
    await page.locator('[data-id="forest"]').click();
    assert.equal(await page.locator('[data-id="forest"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#cosmetics-btn-apply').isEnabled(), true);

    // Switch to sound tab, then to language tab, then back to banner
    await page.locator('#tab-btn-sound').click();
    await page.locator('#tab-btn-language').click();
    await page.locator('#tab-btn-banner').click();

    const forestSelected = await page.locator('[data-id="forest"]').getAttribute('aria-pressed');
    const applyEnabled = await page.locator('#cosmetics-btn-apply').isEnabled();
    assert.equal(forestSelected, 'true', 'Draft selection "forest" must be preserved after switching tabs');
    assert.equal(applyEnabled, true, 'Apply button must remain enabled with unapplied draft changes');
    console.log('✔ QA18-03 PASS: Draft loadout preserved across sound/language tab switches');

    // 4. QA18-05: Focus Trap test
    await page.locator('#settings-modal-close').focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const activeInDialog = await page.evaluate(() => !!document.activeElement?.closest('.settings-modal-overlay'));
      assert.ok(activeInDialog, `Tab ${i + 1}: Focus escaped dialog to ${await page.evaluate(() => document.activeElement?.tagName)}`);
    }
    console.log('✔ QA18-05 PASS: Focus trap strictly contained inside modal during keyboard Tab navigation');

    // Close modal and verify focus restore
    await page.keyboard.press('Escape');
    const modalCount = await page.locator('.settings-modal-overlay').count();
    assert.equal(modalCount, 0, 'Modal should close on Escape key');
    const outsideInertAfterClose = await page.locator('#outside-btn').getAttribute('inert');
    assert.equal(outsideInertAfterClose, null, 'Outside inert must be restored after modal close');

    // 5. QA18-04: Mastery Medal Book and default cosmetic equipment
    const bookCheck = await page.evaluate(async () => {
      const s = window.s;
      const c = window.cosmetics;
      const ui = window.masteryUi;
      c.equipCosmeticLoadout(s, {
        ...c.DEFAULT_COSMETICS,
        title: 'title:challenger',
        frame: 'frame:classic-gold'
      });
      ui.openMasteryBook(document.body, s, () => {});
      return {
        options: [...document.querySelectorAll('[data-equip-slot]')].map(e => ({
          slot: e.dataset.equipSlot,
          item: e.dataset.equipItem,
          selected: e.getAttribute('aria-pressed')
        })),
        summary: ui.renderMasteryProfileSummary(s)
      };
    });

    const challengerOption = bookCheck.options.find(o => o.slot === 'title' && o.item === 'title:challenger');
    assert.ok(challengerOption, 'Mastery book must contain "title:challenger" option');
    assert.equal(challengerOption.selected, 'true', '"title:challenger" option must be selected (aria-pressed=true)');

    const classicFrameOption = bookCheck.options.find(o => o.slot === 'frame' && o.item === 'frame:classic-gold');
    assert.ok(classicFrameOption, 'Mastery book must contain "frame:classic-gold" option');
    assert.equal(classicFrameOption.selected, 'true', '"frame:classic-gold" option must be selected (aria-pressed=true)');

    assert.ok(bookCheck.summary.includes('도전자'), 'Profile mastery summary must display challenger title');
    console.log('✔ QA18-04 PASS: Mastery book includes classic-gold frame and challenger title with proper summary display');

    console.log('--- ALL QA18 CHECKS PASSED SUCCESSFULLY ---');
  } finally {
    await browser.close();
    await server.close();
  }
}

runSettingsQACheck().catch(err => {
  console.error('QA Check Failed:', err);
  process.exit(1);
});
