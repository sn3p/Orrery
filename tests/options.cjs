const assert = require("node:assert/strict");
const path = require("node:path");
const { expect } = require("playwright/test");

exports.openOptions = async page => {
  const trigger = page.getByRole("button", { name: "Options", exact: true });
  if (await trigger.getAttribute("aria-expanded") === "false") await trigger.click();
};

// Tab from the open disclosure to the first control in the panel. Firefox
// gives an overflowing scroll container without tabindex its own Tab stop,
// even when it holds controls (Chromium and WebKit skip it). When the panel
// overflows the viewport, the first Tab lands on the panel itself.
exports.tabIntoOptions = async (page, key = "Tab") => {
  await page.keyboard.press(key);
  const onScroller = await page.evaluate(() => {
    const panel = document.activeElement;
    return panel?.matches(".orrery-options-panel") && !panel.hasAttribute("tabindex")
      && panel.scrollHeight > panel.clientHeight;
  });
  if (onScroller) await page.keyboard.press(key);
};

// Help is an intentional tab stop between a setting and the next control.
exports.tabThroughHelp = async (page, name, key = "Tab") => {
  const info = page.getByRole("button", { name: `About ${name}`, exact: true });
  const tip = page.locator("#" + await info.getAttribute("aria-describedby"));
  await page.keyboard.press(key);
  await expect(info).toBeFocused();
  await expect(tip).toBeVisible();
  await page.keyboard.press(key);
  await expect(tip).toBeHidden();
};

exports.testOptions = async (browser, url, output, name, application = "unified") => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await require('./default-catalog-route.cjs').routeDefaultCatalog(page);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const trigger = page.getByRole("button", { name: "Options", exact: true });
  const panel = page.locator(".orrery-options-panel");
  const renderer = page.getByRole("combobox", { name: "Renderer", exact: true });
  const speed = page.getByRole("textbox", { name: "Playback speed" });
  const labels = page.getByRole("combobox", { name: "Planet labels" });
  const orbits = page.getByRole("checkbox", { name: "Planet orbits" });
  const groups = page.getByRole("combobox", { name: "Minor-planet groups" });
  const dpr = page.getByRole("combobox", { name: "Rendering pixel ratio" });
  const checkSpacing = async () => {
    await require("./options-geometry.cjs")(panel);
    const priorSpeed = await speed.inputValue();
    const track = panel.locator('.lil-slider');
    await track.scrollIntoViewIfNeeded();
    const trackBox = await track.boundingBox();
    assert(trackBox.width >= 80, 'Speed track has a usable drag target');
    for (const fraction of [0.75, 0.25]) {
      await page.mouse.move(trackBox.x + trackBox.width / 2, trackBox.y + trackBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(trackBox.x + trackBox.width * fraction, trackBox.y + trackBox.height / 2);
      await page.mouse.up();
      const value = Number(await speed.inputValue());
      assert(fraction > 0.5 ? value > 0 : value < 0, 'Dragging the visible speed track changes playback direction');
    }
    await speed.fill(priorSpeed);
    await speed.press('Enter');
    // A typed speed applies once, on Enter. Partial input such as "0" must not
    // pause playback or pin the date in the share URL.
    const fill = panel.locator('.lil-fill');
    const typing = async () => ({ fill: await fill.evaluate(el => el.style.width), search: await page.evaluate(() => location.search) });
    const beforeTyping = await typing();
    await speed.fill('');
    await speed.pressSequentially('0.25');
    assert.deepEqual(await typing(), beforeTyping, 'Typing does not apply a partial speed');
    await speed.press('Enter');
    assert.equal(await speed.inputValue(), '0.25');
    assert.notEqual((await typing()).fill, beforeTyping.fill, 'Enter applies the typed speed');
    await speed.fill(priorSpeed);
    await speed.press('Enter');
    const spacing = await panel.evaluate(el => {
      const label = document.createRange();
      label.selectNodeContents(el.querySelector("input[aria-label='Playback speed']").closest(".lil-controller").querySelector(".lil-name"));
      const select = el.querySelector("select[aria-label='Rendering pixel ratio']");
      return {
        gap: el.querySelector(".lil-slider").getBoundingClientRect().left - label.getBoundingClientRect().right,
        appearance: getComputedStyle(select).appearance,
        background: getComputedStyle(select).backgroundImage,
        paddingRight: parseFloat(getComputedStyle(select).paddingRight),
      };
    });
    assert(spacing.gap >= 6, "Speed label keeps at least 6px of visible space before the slider");
    assert.equal(spacing.appearance, "none", "Selects use the inset custom chevron");
    assert(spacing.background.includes("data:image/svg+xml") && spacing.paddingRight >= 22,
      "Select text reserves room for its drawn chevron");
    const info = page.getByRole("button", { name: "About Rendering pixel ratio", exact: true });
    await dpr.focus();
    await info.scrollIntoViewIfNeeded();
    await info.focus();
    const tooltip = page.locator("#" + await info.getAttribute("aria-describedby"));
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("2× is sharper but uses more GPU.");
    const box = await tooltip.boundingBox(), viewport = page.viewportSize();
    assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1
      && box.y + box.height <= viewport.height + 1, "Help stays inside the viewport");
    assert(await tooltip.evaluate(el => !el.closest('.orrery-options-panel')), "Help escapes the panel's scroll clipping");
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();
    await expect(panel).toBeVisible();
    await expect(info).toBeFocused();
  };
  try {
    await page.goto(url);
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
    assert.equal(await trigger.count(), 1, "Production has an options trigger");
    assert.equal(await trigger.textContent(), "[+] options");
    assert(await panel.isHidden(), "Options start closed");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal(await trigger.getAttribute("aria-controls"), await panel.getAttribute("id"));
    assert.equal(await renderer.count(), 0, "Closed renderer choice is absent from the accessibility tree");
    assert.equal(await speed.count(), 0, "Closed controls are absent from the accessibility tree");
    assert.equal(await labels.count(), 0, "Closed label modes are absent from the accessibility tree");
    assert.equal(await orbits.count(), 0, "Closed orbit visibility is absent from the accessibility tree");
    assert.equal(await groups.count(), 0, "Closed group filters are absent from the accessibility tree");
    const triggerStyle = await trigger.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        decorationLine: style.textDecorationLine,
        markerColor: getComputedStyle(element.querySelector('.orrery-options-indicator')).color,
      };
    });
    assert.equal(triggerStyle.color, 'rgb(136, 136, 136)', 'Options uses the muted HUD color at rest');
    assert.equal(triggerStyle.decorationLine, 'none', 'Options is plain text without a link underline');
    assert.equal(triggerStyle.markerColor, triggerStyle.color, 'Options marker does not stay green at rest');
    await trigger.hover();
    assert.equal(await trigger.evaluate(element => getComputedStyle(element).color), 'rgb(0, 232, 90)',
      'Options turns green on hover');
    await page.mouse.move(640, 400);
    await page.evaluate(() => document.fonts.ready);
    const closedTrigger = await trigger.boundingBox();
    await page.screenshot({ path: path.join(output, `${name}-options-closed-desktop.png`) });

    await trigger.focus(); await trigger.press("Enter");
    assert(await panel.isVisible());
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    assert.equal(await trigger.textContent(), "[-] options");
    assert.deepEqual(await trigger.boundingBox(), closedTrigger, "Toggle stays aligned when opening the panel");
    const toggleStyle = await trigger.evaluate(el => {
      const indicator = el.querySelector(".orrery-options-indicator");
      const word = document.createRange();
      word.setStart(el.lastChild, 1);
      word.setEnd(el.lastChild, el.lastChild.length);
      return {
        unified: !!document.querySelector(".orrery-footer"),
        textSize: parseFloat(getComputedStyle(el).fontSize),
        labelSize: parseFloat(getComputedStyle(document.querySelector(".lil-name")).fontSize),
        indicatorSize: parseFloat(getComputedStyle(indicator).fontSize),
        gap: word.getBoundingClientRect().left - indicator.getBoundingClientRect().right,
      };
    });
    assert.equal(toggleStyle.textSize, toggleStyle.labelSize, "Options keeps the original label size");
    assert.equal(toggleStyle.indicatorSize, 12, "Preview marker shares the 12px UI size");
    assert(toggleStyle.gap > 0 && toggleStyle.gap < toggleStyle.textSize * 0.4,
      "Marker and word have a compact positive gap");
    assert(await trigger.evaluate(el => el === document.activeElement),
      "Opening keeps focus on the disclosure without invoking a native picker");
    await exports.tabIntoOptions(page);
    assert(await panel.evaluate(el => el.querySelector("select[aria-label='Renderer']") === document.activeElement
      || (!el.querySelector("select[aria-label='Renderer']") && el.querySelector("input") === document.activeElement)),
    "Tab reaches the first revealed control");
    await expect(renderer).not.toHaveAttribute("aria-describedby", /.+/);
    await expect(speed).toHaveAccessibleDescription("Time scale: 1 = 60 days/s. 0 pauses; negative reverses.");
    await expect(labels).toHaveAccessibleDescription("Show labels for Earth, all planets, or none.");
    await expect(orbits).toHaveAccessibleDescription("Show or hide planetary orbit lines.");
    assert.equal(await labels.getAttribute("title"), null);
    assert.equal(await orbits.getAttribute("title"), null);
    await expect(groups).not.toHaveAttribute("aria-describedby", /.+/);
    assert.deepEqual(await labels.locator("option").allTextContents(), ["Off", "Earth only", "All planets"]);
    assert.equal(await labels.inputValue(), "earth");
    assert(await orbits.isChecked(), "Planet orbits start visible");
    assert.deepEqual(await groups.locator("option").allTextContents(),
      ["All", "Near Earth", "Hungarias", "Main belt", "Inner belt", "Middle belt", "Outer belt", "Hildas",
        "Jupiter Trojans", "Distant", "Without the belt"]);
    assert.equal(await groups.inputValue(), "all", "Group filter starts at All");
    assert.equal(await page.getByRole("button", { name: "About asteroids" }).count(), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.populationPreset")), null,
      "The All default does not invent a saved population preference");
    assert.deepEqual(await orbits.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }), { width: 16, height: 16 }, "Orbit checkbox keeps a compact native control");
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.planetOrbits")), null,
      "The visible default does not invent a saved orbit preference");
    const dprHelp = await page.locator("#" + await dpr.getAttribute("aria-describedby")).textContent();
    assert.equal(dprHelp, "2× is sharper but uses more GPU.");
    assert.deepEqual(await panel.getByRole("heading").allTextContents(),
      ["Rendering", "Playback", "Planets", "Asteroids", "Comets"], "Settings use the reviewed section order");
    assert.equal(await panel.evaluate(el => el.getBoundingClientRect().width), 300,
      "The redesign retains the production panel width");
    const styles = await panel.evaluate(el => ({
      background: getComputedStyle(el).backgroundColor,
      hints: [...document.querySelectorAll("[role=tooltip]")].map(hint => ({
        help: getComputedStyle(hint).color,
        background: getComputedStyle(hint).backgroundColor,
      })),
      select: (() => {
        const style = getComputedStyle(el.querySelector("select"));
        return ["Top", "Right", "Bottom", "Left"].every(side =>
          parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== "none"
          && style[`border${side}Color`] !== style.backgroundColor);
      })(),
    }));
    const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(channel => {
      const srgb = channel / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
    for (const hint of styles.hints) {
      const help = luminance(hint.help), background = luminance(hint.background);
      const contrast = (Math.max(help, background) + 0.05) / (Math.min(help, background) + 0.05);
      assert(contrast >= 4.5, `Help text contrast is at least 4.5:1 (actual ${contrast.toFixed(2)}:1)`);
    }
    assert(styles.select, "DPR select has a visible border on every side");
    await checkSpacing();
    const realTime = page.getByRole("checkbox", { name: "Real time", exact: true });
    const realInfo = page.getByRole("button", { name: "About Real time", exact: true });
    const realTip = page.locator("#" + await realInfo.getAttribute("aria-describedby"));
    const wasRealTime = await realTime.isChecked();
    const realRow = panel.locator('.lil-controller').filter({ has: realTime });
    const realRowBox = await realRow.boundingBox();
    const checkboxBox = await realTime.boundingBox(), infoBox = await realInfo.boundingBox();
    await realRow.click({ position: {
      x: (checkboxBox.x + checkboxBox.width + infoBox.x) / 2 - realRowBox.x,
      y: realRowBox.height / 2,
    } });
    assert.equal(await realTime.isChecked(), wasRealTime, "Blank space between checkbox and help never toggles the checkbox");
    await realInfo.hover();
    await expect(realTip).toBeVisible();
    await page.mouse.move(640, 400);
    await expect(realTip).toBeHidden();
    await trigger.focus();
    await realInfo.hover();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await exports.openOptions(page);
    await realInfo.click();
    await realTip.dblclick();
    await expect(realTip).toBeVisible();
    assert(await page.evaluate(() => getSelection().toString().length > 0), "Pinned help text can be selected");
    await realInfo.click();
    await expect(realTip).toBeHidden();
    await realInfo.click();
    await expect(realTip).toBeVisible();
    assert.equal(await realTime.isChecked(), wasRealTime, "Clicking help never toggles the checkbox row");
    await page.mouse.move(640, 400);
    await expect(realTip).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => {
      const tipBox = await realTip.boundingBox();
      return !!tipBox && tipBox.x >= 0 && tipBox.y >= 0 && tipBox.x + tipBox.width <= 390
        && tipBox.y + tipBox.height <= 844;
    }, { message: "An open pinned tooltip follows viewport resize" }).toBe(true);
    await realInfo.click();
    await expect(realTip).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });
    await speed.fill("0"); await speed.press("Enter");
    await page.evaluate(() => {
      const gl = document.querySelector("canvas").getContext("webgl2");
      window.panelDraws = 0;
      window.panelElements = 0;
      for (const [method, countIndex, instanceIndex] of [
        ["drawArrays", 2, null], ["drawElements", 1, null],
        ["drawArraysInstanced", 2, 3], ["drawElementsInstanced", 1, 4],
      ]) {
        const draw = gl[method].bind(gl);
        gl[method] = (...args) => {
          window.panelDraws++;
          window.panelElements += args[countIndex] * (instanceIndex === null ? 1 : args[instanceIndex]);
          return draw(...args);
        };
      }
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.panelDraws = 0; window.panelElements = 0; });
    const renderWork = async action => {
      const before = await page.evaluate(() => ({ draws: window.panelDraws, elements: window.panelElements }));
      await action();
      await page.waitForFunction(draws => window.panelDraws > draws, before.draws);
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => ({ draws: window.panelDraws, elements: window.panelElements }));
      return { draws: after.draws - before.draws, elements: after.elements - before.elements };
    };
    await labels.selectOption("all");
    assert.equal(await page.locator(".orrery-planet-label").count(), 6);
    assert.deepEqual(await page.locator(".orrery-planet-label").evaluateAll(elements => Object.fromEntries(
      elements.map(element => [element.dataset.planet, getComputedStyle(element).color]))), {
      Mercury: "rgb(236, 205, 158)", Venus: "rgb(236, 205, 158)", Earth: "rgb(152, 192, 255)",
      Mars: "rgb(255, 188, 131)", Jupiter: "rgb(197, 195, 189)", Saturn: "rgb(236, 205, 158)",
    });
    await labels.selectOption("earth");
    const firstHiddenFrame = await renderWork(() => orbits.uncheck());
    const visibleFrame = await renderWork(() => orbits.check());
    const hiddenFrame = await renderWork(() => orbits.uncheck());
    assert(firstHiddenFrame.elements > 0 && hiddenFrame.elements > 0,
      "Hiding orbit tracks still renders the production scene");
    assert(visibleFrame.elements > hiddenFrame.elements,
      "Visible orbit tracks submit more production WebGL geometry than hidden tracks");
    assert.equal(await orbits.isChecked(), false, "Orbit control reflects the hidden production state");
    assert.equal(await page.locator('.orrery-planet-label[data-planet="Earth"]').count(), 1,
      "Hiding orbit tracks keeps the Earth label visible");
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.planetOrbits")), null,
      "Hiding orbit lines does not save a preference");
    await dpr.selectOption("2");
    await dpr.selectOption("1");
    await groups.selectOption("nea");
    assert.equal(await groups.inputValue(), "nea");
    await expect(groups).not.toHaveAttribute("aria-describedby", /.+/);
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.populationPreset")), null,
      "Changing groups does not persist the preset");
    const glossary = page.locator("#orrery-glossary");
    const glossaryTrigger = page.getByRole("button", { name: "About asteroids" });
    await glossaryTrigger.click();
    assert(await glossary.evaluate(el => el.open), "Asteroid information opens from its section link");
    await expect(glossary.locator("#orrery-glossary-selection")).toContainText("Showing: Near Earth. Perihelion closer than 1.3 AU.");
    assert.deepEqual(await glossary.locator("dt[data-preset]").evaluateAll(titles => titles.map(title =>
      [title.dataset.preset, title.querySelectorAll(".orrery-swatch").length, title.textContent.trim()])),
    [["nea", 1, "Near Earth"], ["hungarias", 1, "Hungarias"], ["belt", 3, "Main belt"], ["hildas", 1, "Hildas"],
      ["trojans", 1, "Jupiter Trojans"], ["distant", 1, "Distant"]], "Glossary titles carry the legend dots");
    assert.equal(await glossary.evaluate(el => getComputedStyle(el).scrollbarColor), "rgb(71, 123, 84) rgb(17, 17, 17)");
    assert.equal(await glossary.locator("dt .orrery-swatch-dots:visible").count(), 6, "Dots show while group colors are on");
    await page.keyboard.press("Escape");
    await page.getByRole("checkbox", { name: "Group colors" }).uncheck();
    await glossaryTrigger.click();
    assert.equal(await glossary.locator("dt .orrery-swatch-dots:visible").count(), 0, "Dots hide while group colors are off");
    await page.keyboard.press("Escape");
    await page.getByRole("checkbox", { name: "Group colors" }).check();
    await glossaryTrigger.click();
    assert.equal(await glossary.locator("dt .orrery-swatch-dots:visible").count(), 6, "Dots return with group colors");
    assert(await glossary.evaluate(el => el.getBoundingClientRect().width > 600), "Glossary widens on a desktop viewport");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "orrery-glossary-title");
    await page.keyboard.press("Escape");
    assert(await glossary.evaluate(el => !el.open), "Escape closes the glossary");
    assert(await panel.isVisible(), "Glossary Escape leaves Options open");
    assert(await glossaryTrigger.evaluate(el => el === document.activeElement),
      "Closing the glossary returns focus to About asteroids");
    await page.waitForFunction(() => document.querySelector("#orrery-fps").textContent === "0 FPS");
    // Choosing a group eases the camera to its frame for half a second; the
    // FPS readout counts playback frames, not that motion. Let it settle.
    for (let last = -1, now = await page.evaluate(() => window.panelDraws); now !== last;) {
      last = now; await page.waitForTimeout(250); now = await page.evaluate(() => window.panelDraws);
    }
    const draws = await page.evaluate(() => window.panelDraws);
    const date = await page.locator("#orrery-date").textContent();
    await speed.press("Enter"); await page.keyboard.press("Escape");
    assert(await panel.isHidden());
    assert.equal(await trigger.textContent(), "[+] options");
    assert(await trigger.evaluate(el => el === document.activeElement), "Escape returns focus to the trigger");
    await trigger.press("Tab");
    assert(await page.evaluate(() => !document.activeElement.closest(".orrery-options-panel")), "Tab skips closed controls");
    await trigger.focus(); await trigger.press("Space");
    assert(await panel.isVisible(), "Space opens the panel");
    assert.equal(await trigger.textContent(), "[-] options");
    assert.equal(await speed.inputValue(), "0");
    assert.equal(await dpr.inputValue(), "1");
    assert.equal(await groups.inputValue(), "nea", "Closing keeps the active group filter");
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.panelDraws), draws, "Panel toggles do not restart paused rendering");
    assert.equal(await page.locator("#orrery-date").textContent(), date);
    await page.screenshot({ path: path.join(output, `${name}-options-open-desktop.png`) });

    await trigger.click(); assert(await panel.isHidden(), "Trigger toggles the panel closed");
    assert.equal(await trigger.textContent(), "[+] options");
    await trigger.click(); await page.mouse.click(640, 400);
    assert(await panel.isHidden(), "An outside pointer closes the panel");
    assert.equal(await trigger.textContent(), "[+] options");
    await exports.openOptions(page);
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 240 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(({ width, height }) => {
        const canvas = document.querySelector("canvas");
        return canvas.clientWidth === width && canvas.clientHeight === height;
      }, viewport);
      const bounds = await panel.boundingBox();
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width
        && bounds.y + bounds.height <= viewport.height, "Options fit narrow and short viewports");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
      for (const control of [speed, labels, orbits, groups, dpr]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        assert(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width);
      }
      assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true, "Panel has no horizontal overflow");
      await checkSpacing();
      const info = page.getByRole("button", { name: "About Rendering pixel ratio", exact: true });
      await info.click();
      const tip = page.locator("#" + await info.getAttribute("aria-describedby"));
      if (await panel.evaluate(el => el.scrollHeight > el.clientHeight)) {
        await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(tip).toBeHidden();
        await expect(panel).toBeVisible();
      } else {
        await page.keyboard.press("Escape");
      }
      await page.screenshot({ path: path.join(output, `${name}-options-${viewport.width}x${viewport.height}.png`) });
    }
    // Chromium can force the reserved gutter used in CI; WebKit keeps overlay scrollbars.
    if (browser.browserType().name() === "chromium") {
      const scrollbarStyle = await page.addStyleTag({ content: `
        .orrery-options-panel { scrollbar-gutter: stable; scrollbar-width: auto; }
        .orrery-options-panel::-webkit-scrollbar { width: 15px; }
      ` });
      try {
        assert(await panel.evaluate(el => el.scrollHeight > el.clientHeight), 'Short panel needs scrolling');
        assert(await panel.evaluate(el => el.offsetWidth - el.clientWidth
          - parseFloat(getComputedStyle(el).borderLeftWidth) - parseFloat(getComputedStyle(el).borderRightWidth) > 0),
        'Exercise a scrollbar that reserves horizontal space');
        await checkSpacing();
      } finally { await scrollbarStyle.evaluate(el => el.remove()); }
    }
    await speed.fill("-1.5"); await speed.press("Enter");
    const reverseDate = await page.locator("#orrery-date").textContent();
    await trigger.click();
    await page.waitForFunction(date => document.querySelector("#orrery-date").textContent < date, reverseDate);
    await exports.openOptions(page);
    assert.equal(await speed.inputValue(), "-1.5", "Closing keeps playback settings");
    await page.reload();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
    assert(await panel.isHidden(), "Reload starts with a closed panel");
    assert.equal(await trigger.textContent(), "[+] options");
    await exports.openOptions(page);
    assert.equal(await dpr.inputValue(), "2", "Reload starts at the 2× default on a high-DPI display");
    assert.equal(await groups.inputValue(), "all", "Reload returns the group filter to All");
    assert.equal(await orbits.isChecked(), true, "Reload shows planet orbit lines again");
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.planetOrbits")), null,
      "Orbit visibility is not saved");
    assert.equal(await page.locator('.orrery-planet-label[data-planet="Earth"]').count(), 1,
      "Reload with hidden orbit tracks keeps Earth visible");
    await orbits.check();
    assert.deepEqual(errors, []);
    return { toggleAndDismissal: "passed", keyboardAndFocus: "passed", valuesAndIdle: "passed",
      desktopNarrowAndShort: "passed", reload: "passed" };
  } finally { await page.close(); }
};
