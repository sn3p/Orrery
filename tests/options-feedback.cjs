const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');

// Exercise defensive UI lifecycle transitions against the real App and DOM.
module.exports = async (browser, root, renderer) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await require('./route-files.cjs').routeFiles(page, root);
  await require('./comet-fixture.cjs').routeComets(page);
  try {
    await page.goto(`https://orrery.test/next/?renderer=${renderer}`);
    await page.evaluate(() => threeTest.ready);
    await page.evaluate(() => {
      window.app = threeTest.app;
      window.controls = app.gui.controls;
      app.jedDelta = 0;
      controls.open();
    });
    // A programmatically opened modal must own Escape even with lingering hover help.
    const info = page.getByRole('button', { name: 'About Real time', exact: true });
    await info.hover();
    await expect(page.locator('#' + await info.getAttribute('aria-describedby'))).toBeVisible();
    await page.evaluate(() => app.gui.timeline.open());
    await page.keyboard.press('Escape');
    await expect(page.locator('#orrery-date-dialog')).toBeHidden();
    await expect(page.locator('.orrery-options-panel')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Show comets', exact: true }).check();
    await page.waitForFunction(() => app.cometIds.every(id => app.cometData?.[id]));
    const choose = page.getByRole('button', { name: 'Choose…', exact: true });
    const done = page.getByRole('button', { name: 'Done', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Choose comets', exact: true });
    const toggle = page.getByRole('checkbox', { name: 'Show comets', exact: true });
    for (const held of [true, false]) {
      await page.evaluate(held => app.hold(held), held);
      await choose.click();
      assert.equal(await page.evaluate(() => app.held), true);
      await done.click();
      await expect(choose).toBeFocused();
      assert.equal(await page.evaluate(() => app.held), held, 'Closing preserves the prior hold');
      assert.equal(await page.evaluate(() => app.jedDelta), 0, 'Closing never changes paused speed');
    }
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        controls.cometChoose.click();
        controls.closeCometChooser();
      }
    });
    assert.equal(await page.evaluate(() => app.held), false, 'Immediate reopen does not inherit a stale hold');
    await choose.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(choose).toBeFocused();

    // Another modal owns its hold and focus during a defensive overlapping close.
    await choose.click();
    await page.evaluate(() => {
      controls.openGlossary();
      controls.closeCometChooser();
    });
    await expect(page.locator('#orrery-glossary-title')).toBeFocused();
    assert.equal(await page.evaluate(() => app.held), true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#orrery-glossary')).toBeHidden();
    await expect.poll(() => page.evaluate(() => app.held)).toBe(false);

    // Every pair shares the original hold, even if the first close event is
    // still queued when the next card opens. Cover both directions and callers.
    const handoffs = [
      ['chooser','asteroids'], ['chooser','comets'], ['asteroids','chooser'],
      ['comets','chooser'], ['asteroids','comets'], ['comets','asteroids']
    ];
    for (const held of [false,true]) for (const [first,second] of handoffs) for (const closeFirst of [false,true]) {
      const during = await page.evaluate(async ({held,first,second,closeFirst}) => {
        app.hold(held);
        const dialogs = {chooser:controls.cometDialog,asteroids:controls.glossary,comets:controls.cometInfo};
        const triggers = {chooser:controls.cometChoose,asteroids:controls.glossaryTrigger,comets:controls.cometInfoTrigger};
        triggers[first].click();
        const closed = new Promise(resolve=>dialogs[first].addEventListener('close',resolve,{once:true}));
        if(closeFirst) dialogs[first].close();
        triggers[second].click();
        if(!closeFirst) dialogs[first].close();
        await closed;
        return {held:app.held,focus:dialogs[second].contains(document.activeElement)};
      },{held,first,second,closeFirst});
      assert.deepEqual(during,{held:true,focus:true},`${first} → ${second}: remaining dialog keeps hold/focus`);
      await page.evaluate(()=>{window.handoffClosed=new Promise(resolve=>document.querySelector('dialog[open]').addEventListener('close',resolve,{once:true}));});
      await page.keyboard.press('Escape');
      await page.evaluate(()=>handoffClosed);
      assert.equal(await page.evaluate(()=>app.held),held,'The final close preserves the original caller hold');
      assert.equal(await page.evaluate(()=>app.jedDelta),0,'Handoffs preserve paused speed');
    }
    await page.evaluate(()=>app.hold(false));

    // Explicit suppression must not introduce an Options-button focus call.
    await choose.click();
    const forcedFocus = await page.evaluate(async () => {
      let calls = 0;
      const original = controls.trigger.focus;
      controls.trigger.focus = function (...args) { calls++; return original.apply(this, args); };
      const closed = new Promise(resolve => controls.cometDialog.addEventListener("close", resolve, { once: true }));
      controls.setOpen(false, false);
      await closed;
      controls.trigger.focus = original;
      return calls;
    });
    assert.equal(forcedFocus, 0, 'Programmatic dismissal honours restoreFocus=false');
    await page.evaluate(() => controls.open());

    // Both feedback surfaces share creation/rendering, but retain their own location.
    await page.evaluate(() => {
      window.savedData = app.cometData;
      window.savedStates = app.cometStates;
      app.cometData = {};
      app.cometStates = Object.fromEntries(app.cometIds.map(id => [id, 'error']));
      controls.updateComets();
    });
    const panelRetry = page.locator('.orrery-options-panel').getByRole('button', { name: 'Retry comet data' });
    await expect(panelRetry).toBeVisible();
    await choose.click();
    const dialogRetry = dialog.getByRole('button', { name: 'Retry comet data' });
    await expect(dialogRetry).toBeVisible();
    assert.equal(await dialog.getByRole('status').textContent(),
      await page.locator('.orrery-options-panel [role=status]').textContent());
    await dialogRetry.focus();
    await page.evaluate(() => {
      app.cometData = savedData;
      app.cometStates = savedStates;
      controls.updateComets();
    });
    await expect(done).toBeFocused();
    await done.click();
    await page.evaluate(() => {
      app.cometData = {};
      app.cometStates = Object.fromEntries(app.cometIds.map(id => [id, 'error']));
      controls.updateComets();
    });
    await panelRetry.focus();
    await page.evaluate(() => {
      // Simulate a state update hiding the Retry row while it owns focus.
      app.cometsShown = false;
    });
    await expect(toggle).toBeFocused();
    for (const held of [false,true]) for (const closeFirst of [false,true]) {
      await page.evaluate(({held,closeFirst})=>{
        app.hold(held);
        app.cometsShown=true;
        controls.cometChoose.click();
        if(closeFirst) controls.cometDialog.close();
        controls.openGlossary();
        controls.destroy();
      },{held,closeFirst});
      assert.equal(await page.evaluate(()=>app.held),held,'Disposal releases only the internally acquired hold');
      assert.equal(await page.locator('dialog[open]').count(),0);
      await page.reload();await page.evaluate(()=>threeTest.ready);
      await page.evaluate(()=>{window.app=threeTest.app;window.controls=app.gui.controls;app.jedDelta=0;app.cometsShown=true;controls.open();});
      await expect(choose).toBeEnabled();
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
};
