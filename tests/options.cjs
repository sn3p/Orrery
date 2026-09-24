const assert = require("node:assert/strict");
const path = require("node:path");
const { expect } = require("playwright/test");

exports.openOptions = async page => {
  const trigger = page.getByRole("button", { name: "Options", exact: true });
  if (await trigger.getAttribute("aria-expanded") === "false") await trigger.click();
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
    const spacing = await panel.evaluate(el => {
      const label = document.createRange();
      label.selectNodeContents(el.querySelector("input[aria-label='Playback speed']").closest("li").querySelector(".property-name"));
      const hint = el.querySelector("select[aria-label='Rendering pixel ratio']").getAttribute("aria-describedby");
      const text = document.getElementById(hint).firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      const lines = [...range.getClientRects()];
      range.setStart(text, text.textContent.lastIndexOf("GPU"));
      return {
        unified: !!document.querySelector(".orrery-footer"),
        gap: el.querySelector(".slider").getBoundingClientRect().left - label.getBoundingClientRect().right,
        lines: lines.length,
        lastLineTop: lines.at(-1)?.top,
        lastWordTop: range.getBoundingClientRect().top,
      };
    });
    assert(spacing.gap >= 8, "Speed label keeps at least 8px of visible space before the slider");
    assert.equal(spacing.lines, 2, "DPR help wraps compactly within the panel at its UI font size");
    assert(Math.abs(spacing.lastWordTop - spacing.lastLineTop) < 1, "Help text remains within the expected last line");
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
        labelSize: parseFloat(getComputedStyle(document.querySelector(".dg .property-name")).fontSize),
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
    await trigger.press("Tab");
    assert(await panel.evaluate(el => el.querySelector("select[aria-label='Renderer']") === document.activeElement
      || (!el.querySelector("select[aria-label='Renderer']") && el.querySelector("input") === document.activeElement)),
    "Tab reaches the first revealed control");
    await expect(renderer).toHaveAccessibleDescription("Change renderer; time and options persist.");
    await expect(speed).toHaveAccessibleDescription("Time scale: 1 = 60 days/s; 0 pauses; negative reverses.");
    await expect(labels).toHaveAccessibleDescription("Show labels for Earth, all planets, or none.");
    await expect(orbits).toHaveAccessibleDescription("Show or hide planetary orbit lines.");
    await expect(groups).toHaveAccessibleDescription("Numbered minor planets with known discovery dates. Most are in the main belt.");
    assert.deepEqual(await labels.locator("option").allTextContents(), ["Off", "Earth only", "All planets"]);
    assert.equal(await labels.inputValue(), "earth");
    assert(await orbits.isChecked(), "Planet orbits start visible");
    assert.deepEqual(await groups.locator("option").allTextContents(),
      ["All", "Near Earth", "Hungarias", "Main belt", "Inner belt", "Middle belt", "Outer belt", "Hildas",
        "Jupiter Trojans", "Distant", "Without the belt"]);
    assert.equal(await groups.inputValue(), "all", "Group filter starts at All");
    assert.equal(await page.getByRole("button", { name: "What is this?" }).count(), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.populationPreset")), null,
      "The All default does not invent a saved population preference");
    assert.deepEqual(await orbits.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }), { width: 16, height: 16 }, "Orbit checkbox keeps a compact native control");
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.planetOrbits")), null,
      "The visible default does not invent a saved orbit preference");
    const dprHelp = await page.locator("#" + await dpr.getAttribute("aria-describedby")).textContent();
    assert.equal(dprHelp, "Pixel density: 2× is sharper but uses more GPU.");
    assert.equal(await dpr.getAttribute("title"), dprHelp);
    const styles = await panel.evaluate(el => ({
      background: getComputedStyle(el).backgroundColor,
      hints: [...el.querySelectorAll(".orrery-options-hint")].map(hint => ({
        help: getComputedStyle(hint).color,
        label: getComputedStyle(hint.closest("li").querySelector(".property-name")).color,
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
      const help = luminance(hint.help), background = luminance(styles.background);
      assert((luminance(hint.label) + 0.05) / (help + 0.05) >= 1.5,
        "Labels remain visibly brighter than help text");
      const contrast = (Math.max(help, background) + 0.05) / (Math.min(help, background) + 0.05);
      assert(contrast >= 4.5, `Help text contrast is at least 4.5:1 (actual ${contrast.toFixed(2)}:1)`);
    }
    assert(styles.select, "DPR select has a visible border on every side");
    await checkSpacing();
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
    await expect(groups).toHaveAccessibleDescription("Perihelion closer than 1.3 AU. Sparse at 1980; this numbered catalog is a sample.");
    assert.equal(await page.evaluate(() => localStorage.getItem("orrery.populationPreset")), null,
      "Changing groups does not persist the preset");
    const glossary = page.locator("#orrery-glossary");
    const glossaryTrigger = page.getByRole("button", { name: "What is this?" });
    await glossaryTrigger.click();
    assert(await glossary.evaluate(el => el.open), "Glossary opens from the groups control");
    assert.deepEqual(await glossary.locator("dt[data-preset]").evaluateAll(titles => titles.map(title =>
      [title.dataset.preset, title.querySelectorAll(".orrery-swatch").length, title.textContent.trim()])),
    [["nea", 1, "Near Earth"], ["hungarias", 1, "Hungarias"], ["belt", 3, "Main belt"], ["hildas", 1, "Hildas"],
      ["trojans", 1, "Jupiter Trojans"], ["distant", 1, "Distant"]], "Glossary titles carry the legend dots");
    assert.equal(await glossary.evaluate(el => getComputedStyle(el).scrollbarColor), "rgb(71, 123, 84) rgb(17, 17, 17)");
    assert(await glossary.evaluate(el => el.getBoundingClientRect().width > 600), "Glossary widens on a desktop viewport");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "orrery-glossary-title");
    await page.keyboard.press("Escape");
    assert(await glossary.evaluate(el => !el.open), "Escape closes the glossary");
    assert(await panel.isVisible(), "Glossary Escape leaves Options open");
    assert(await glossaryTrigger.evaluate(el => el === document.activeElement),
      "Closing the glossary returns focus to What is this?");
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
      await page.screenshot({ path: path.join(output, `${name}-options-${viewport.width}x${viewport.height}.png`) });
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
