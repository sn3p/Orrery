const assert = require('node:assert/strict');

// Measure the rendered Options rows: selector intent alone missed cascade conflicts.
module.exports = async panel => {
  const layout = await panel.evaluate(panel => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, height: r.height, width: r.width, centerY: r.y + r.height / 2 }; };
    const visible = el => el.getClientRects().length;
    return {
      // Client bounds exclude borders and any non-overlay scrollbar gutter.
      panelClient: { x: panel.getBoundingClientRect().x + panel.clientLeft,
        right: panel.getBoundingClientRect().x + panel.clientLeft + panel.clientWidth },
      about: [...panel.querySelectorAll('.orrery-about-row')].map(row => ({
        link: rect(row.querySelector('button')),
        padding: getComputedStyle(row).paddingTop,
      })),
      fit: panel.querySelector('.orrery-comet-summary .orrery-glossary-close')?.getClientRects().length
        ? rect(panel.querySelector('.orrery-comet-summary .orrery-glossary-close')) : null,
      rows: [...panel.querySelectorAll('.lil-controller')].filter(visible).map(row => ({
        label: rect(row.querySelector('.lil-name')),
        slider: row.querySelector('.lil-slider') && rect(row.querySelector('.lil-slider')),
        control: rect(row.querySelector('.lil-slider') || row.querySelector('select, input')),
        info: row.querySelector('.orrery-options-info') && rect(row.querySelector('.orrery-options-info')),
        select: row.querySelector('select') && rect(row.querySelector('select')),
      })),
      sections: [...panel.querySelectorAll('.orrery-options-section')].map(row => ({
        box: rect(row), label: rect(row.querySelector('h2, .lil-name')),
        bottomBorder: getComputedStyle(row).borderBottomWidth,
      })),
      actions: [...panel.querySelectorAll('.orrery-comet-actions button')].filter(visible).map(rect),
      summaries: [...panel.querySelectorAll('.orrery-comet-summary')].filter(visible).map(rect),
      overflow: panel.scrollWidth > panel.clientWidth,
    };
  });
  const first = layout.rows[0];
  const close = (a, b, message) => assert(Math.abs(a - b) < 1, `${message}: ${a} vs ${b}`);
  assert.equal(layout.about.length, 2, 'Both sections retain their About link');
  for (const about of layout.about) {
    close(about.link.x, first.label.x, 'About links share the left label inset');
    assert.equal(about.padding, '8px', 'About rows share their top spacing');
  }
  if (layout.fit) assert.equal(layout.fit.height, 28, 'Fit uses the standard row height');
  const infoColumn = layout.rows.find(row => row.info)?.info.x;
  for (const row of layout.rows) {
    assert(row.control.width >= 16 && row.control.height >= 16, 'Every control has a usable rendered area');
    if (row.slider) assert(row.slider.width >= 80, 'Speed track cannot collapse while its coordinates remain aligned');
    close(row.label.x, first.label.x, 'All labels share an inset');
    close(row.control.x, first.control.x, 'Checkboxes, slider and selects share a control column');
    close(row.label.width, 100, 'Labels use a 100px column');
    if (row.info) {
      close(row.control.centerY, row.info.centerY, 'Help icon is vertically centered on its control');
      close(row.info.x, infoColumn, 'Help icons share the right column');
    }
    if (row.select) close(row.select.right, first.select.right, 'Selects reserve the same help-icon column');
  }
  for (const section of layout.sections) {
    close(section.label.x, first.label.x, 'Heading and control labels share an inset');
    close(section.box.x, layout.panelClient.x, 'Section separator reaches the client area edge');
    close(section.box.right, layout.panelClient.right, 'Section separator reaches the opposite client area edge');
    assert.equal(section.bottomBorder, '0px', 'No row rule underneath a heading');
  }
  for (const action of layout.actions) {
    close(action.x, first.label.x, 'Action uses the content inset');
    assert.equal(action.height, 28, 'Action does not inherit the row line-height');
  }
  for (const summary of layout.summaries) close(summary.x, first.label.x, 'Summary uses the content inset');
  assert(!layout.overflow, 'Aligned controls do not cause horizontal overflow');
};
