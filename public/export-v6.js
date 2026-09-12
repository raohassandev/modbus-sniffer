'use strict';

(()=>{
  const reports=document.getElementById('page-reports');
  if(!reports)return;
  const outputPanel=[...reports.querySelectorAll('article.panel')].find(p=>p.querySelector('h2')?.textContent.trim()==='Outputs');
  const stack=outputPanel?.querySelector('.action-stack');
  if(!stack)return;

  const style=document.createElement('style');
  style.textContent=`
    .export-results{position:relative}.export-results summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;border-radius:8px;background:#1976d2;color:#fff;font-weight:700;user-select:none}.export-results summary::-webkit-details-marker{display:none}.export-results[open] summary{border-radius:8px 8px 0 0}.export-results-menu{border:1px solid rgba(120,140,160,.28);border-top:0;border-radius:0 0 8px 8px;overflow:hidden;background:var(--panel,#111b24)}.export-results-menu a{display:flex;justify-content:space-between;gap:14px;padding:12px 14px;text-decoration:none;border-top:1px solid rgba(120,140,160,.18)}.export-results-menu a:first-child{border-top:0}.export-results-menu a:hover{background:rgba(25,118,210,.12)}.export-results-menu strong{display:block}.export-results-menu small{display:block;opacity:.72;margin-top:2px}.export-results-menu code{white-space:nowrap;align-self:center}.export-quick{margin-top:10px}.export-quick summary{cursor:pointer;font-size:12px;opacity:.78}.export-quick-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}`;
  document.head.appendChild(style);

  stack.innerHTML=`
    <details class="export-results">
      <summary><span>Export Results</span><span>▾</span></summary>
      <div class="export-results-menu">
        <a href="/api/export/results.xlsx"><span><strong>Excel Workbook</strong><small>Summary, devices, polling groups, registers, engineering values, timeouts, exceptions, traffic and history</small></span><code>.xlsx</code></a>
        <a href="/api/export/report.pdf"><span><strong>Engineering Report</strong><small>Formatted diagnostic report ready to share or archive</small></span><code>.pdf</code></a>
        <a href="/api/capture/export.mbcap"><span><strong>Raw Capture</strong><small>Replayable Modbus session with the current project metadata</small></span><code>.mbcap</code></a>
        <a href="/api/export/project.zip"><span><strong>Complete Project Backup</strong><small>Excel, PDF, HTML, capture, diagnostics, project/workspace data, history and CSV data in one archive</small></span><code>.zip</code></a>
      </div>
    </details>
    <details class="export-quick">
      <summary>Individual CSV / JSON exports</summary>
      <div class="export-quick-links">
        <a class="button secondary" href="/api/export/devices.csv">Devices CSV</a>
        <a class="button secondary" href="/api/export/polls.csv">Polling CSV</a>
        <a class="button secondary" href="/api/export/registers.csv">Registers CSV</a>
        <a class="button secondary" href="/api/export/engineering.csv">Engineering CSV</a>
        <a class="button secondary" href="/api/export/transactions.csv">Traffic CSV</a>
        <a class="button secondary" href="/api/workspace/export.json">Workspace JSON</a>
        <a class="button secondary" href="/api/report.html" target="_blank">Printable HTML</a>
      </div>
    </details>`;
})();
