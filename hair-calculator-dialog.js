/* Reuse the original tool nodes and handlers; never rebuild the analysis form. */
(function () {
  'use strict';
  function install() {
  const dialog = document.createElement('dialog');
  dialog.id = 'hair-calculator-dialog';
  dialog.setAttribute('aria-labelledby', 'hair-calculator-title');
  dialog.innerHTML = '<div class="hair-calculator-heading"><h3 id="hair-calculator-title">自由换算</h3><button type="button" data-close aria-label="关闭自由换算">关闭</button></div><div class="academy-actions"><button type="button" data-tool="calc">自由换算</button><button type="button" data-tool="cold">冷烫工具</button></div><div data-tools></div>';
  document.body.appendChild(dialog);
  const originalSwitch = window.switchPlan;
  let opener = null;
  function open(tool) {
    opener = dialog.open ? opener : document.activeElement;
    for (const id of ['plan-calc', 'plan-cold']) {
      const node = document.getElementById(id);
      if (node && !dialog.contains(node)) dialog.querySelector('[data-tools]').appendChild(node);
      if (node) node.classList.toggle('active', id === 'plan-' + tool);
    }
    dialog.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    if (!dialog.open) dialog.showModal();
  }
  window.openHairCalculator = function () { open('calc'); };
  window.switchPlan = function (name) {
    if (name === 'calc' || name === 'cold') return open(name);
    return originalSwitch(name);
  };
  dialog.addEventListener('click', function (event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-close')) dialog.close();
    if (button.dataset.tool) open(button.dataset.tool);
  });
  dialog.addEventListener('close', function () { if (opener && opener.isConnected) opener.focus(); });
  }
  if (typeof window.switchPlan === 'function') install();
  else document.addEventListener('DOMContentLoaded', install, {once:true});
})();
