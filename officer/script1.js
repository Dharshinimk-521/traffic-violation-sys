const SUPABASE_URL = 'https://abqfmubaxsglxncfriqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFicWZtdWJheHNnbHhuY2ZyaXF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNjI4MzAsImV4cCI6MjA4OTkzODgzMH0.eM6OgHv8scmYGNhWqrxeDFWrgA_HeUu0oMj-VjE5tXg';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


let currentUser = null;
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = '../login/login.html'; return; }
  currentUser = session.user;
  await initDashboard();
})();


let allViolations = [];      // fetched from Supabase violation_details view
let allVehicles = [];        // fetched from Supabase vehicles table
let currentFilter = 'all';
let currentSearch = '';
let highRiskDrivers = [];

const VIOLATION_CLASSES = {
  'No Helmet': 'v-helmet',
  'Red Light Jump': 'v-red',
  'Speeding': 'v-speed',
  'Using Phone While Driving': 'v-phone'
};
const VIOLATION_ICONS = {
  'No Helmet': '⛑',
  'Red Light Jump': '🔴',
  'Speeding': '💨',
  'Using Phone While Driving': '📱'
};

// ============================================================
// INIT — fetch everything from Supabase
// ============================================================
async function initDashboard() {
  // Set user info from sessionStorage (set during login)
  const userName = sessionStorage.getItem('tg_name') || 'Officer';
  const userRole = sessionStorage.getItem('tg_role') || 'officer';
  document.getElementById('user-name').textContent = userName;
  document.getElementById('user-role').textContent = userRole === 'admin' ? 'Station Admin' : 'Traffic Officer';
  document.getElementById('user-initials').textContent = userName.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();

  await Promise.all([fetchViolations(), fetchVehicles()]);
  checkHighRiskAlerts();
}

// ============================================================
// FETCH VIOLATIONS from Supabase violation_details view
// ============================================================
async function fetchViolations() {
  const { data, error } = await sb
    .from('violation_details')
    .select('*')
    .order('detected_at', { ascending: false });

  if (error) { showToast('Error loading violations: ' + error.message, true); return; }
  allViolations = data || [];
  renderViolations();
  updateStats();
}

// ============================================================
// FETCH VEHICLES (for risk scores) from Supabase
// ============================================================
async function fetchVehicles() {
  const { data, error } = await sb
    .from('vehicles')
    .select('*')
    .order('risk_score', { ascending: false });

  if (error) { showToast('Error loading vehicle data: ' + error.message, true); return; }
  allVehicles = data || [];
  renderRiskCards('all');
}

// ============================================================
// RENDER VIOLATIONS TABLE
// ============================================================
function renderViolations() {
  const tbody = document.getElementById('violations-tbody');
  let rows = allViolations.filter(v => {
    const matchStatus = currentFilter === 'all' || v.status === currentFilter;
    const matchSearch = !currentSearch ||
      (v.plate_number || '').toLowerCase().includes(currentSearch.toLowerCase()) ||
      (v.owner_name || '').toLowerCase().includes(currentSearch.toLowerCase());
    return matchStatus && matchSearch;
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No violations found.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(v => {
    const vClass = VIOLATION_CLASSES[v.violation_name] || 'v-helmet';
    const vIcon = VIOLATION_ICONS[v.violation_name] || '⚠';
    const dt = v.detected_at ? new Date(v.detected_at).toLocaleString('en-IN') : '—';
    return `
      <tr>
        <td><span class="plate-badge">${v.plate_number || '—'}</span></td>
        <td>
          <div style="font-size:13px;">${v.owner_name || '—'}</div>
          <div style="font-size:11px;color:var(--muted);">${v.phone_number || ''}</div>
        </td>
        <td><span class="violation-tag ${vClass}">${vIcon} ${v.violation_name || '—'}</span></td>
        <td><button class="btn-view" onclick="openModal('${v.record_id}')">📷 View</button></td>
        <td><span class="fine-amt">₹${(v.fine_amount || 0).toLocaleString()}</span></td>
        <td style="font-size:12px;color:var(--muted);">${dt}</td>
        <td><span class="status-pill s-${v.status}">${capitalize(v.status)}</span></td>
        <td>
          <div class="action-btns">
            ${v.status === 'pending' ? `
              <button class="btn-approve" onclick="approveViolation('${v.record_id}')">✓ Approve</button>
              <button class="btn-reject" onclick="rejectViolation('${v.record_id}')">✕ Reject</button>
            ` : `<span style="font-size:11px;color:var(--muted);">Processed</span>`}
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ============================================================
// STATS
// ============================================================
function updateStats() {
  const pending  = allViolations.filter(v => v.status === 'pending').length;
  const approved = allViolations.filter(v => v.status === 'approved').length;
  const fines    = allViolations.filter(v => v.status === 'approved').reduce((s,v) => s + (v.fine_amount||0), 0);
  document.getElementById('s-total').textContent = allViolations.length;
  document.getElementById('s-pending').textContent = pending;
  document.getElementById('s-approved').textContent = approved;
  document.getElementById('s-fines').textContent = fines >= 1000 ? (fines/1000).toFixed(0)+'K' : fines;
  document.getElementById('pending-count').textContent = pending;
}

// ============================================================
// APPROVE VIOLATION — calls Node.js API → updates Supabase
// ============================================================
async function approveViolation(recordId) {
  try {
    const res = await fetch('http://localhost:5000/approve-violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record_id: recordId, officer_id: currentUser?.id })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Approval failed');

    closeModal();
    showToast('✓ Violation approved. Fine issued.', false);
    await fetchViolations();
    await fetchVehicles();
    checkHighRiskAlerts();

    // Show individual warning if this driver is now high risk
    if (result.risk_category === 'High') {
      const vehicle = allVehicles.find(v => v.plate_number);
      if (vehicle) setTimeout(() => showWarningModal(vehicle), 700);
    }
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ============================================================
// REJECT VIOLATION — calls Node.js API → updates Supabase
// ============================================================
async function rejectViolation(recordId) {
  try {
    const res = await fetch('http://localhost:5000/reject-violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record_id: recordId, reason: 'Rejected by officer' })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Rejection failed');

    closeModal();
    showToast('✕ Violation rejected.', true);
    await fetchViolations();
    updateStats();
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ============================================================
// DETAIL MODAL
// ============================================================
function openModal(recordId) {
  const v = allViolations.find(x => x.record_id === recordId);
  if (!v) return;
  const vClass = VIOLATION_CLASSES[v.violation_name] || 'v-helmet';
  const vIcon = VIOLATION_ICONS[v.violation_name] || '⚠';
  document.getElementById('modal-title').textContent = `${vIcon} ${v.violation_name}`;
  document.getElementById('modal-sub').textContent = `Evidence review — ${v.detected_at ? new Date(v.detected_at).toLocaleString('en-IN') : ''}`;
  document.getElementById('modal-plate-img').textContent = v.plate_number;
  document.getElementById('modal-rows').innerHTML = `
    <div class="modal-row"><span class="modal-key">Plate Number</span><span class="modal-val"><span class="plate-badge">${v.plate_number}</span></span></div>
    <div class="modal-row"><span class="modal-key">Driver</span><span class="modal-val">${v.owner_name}</span></div>
    <div class="modal-row"><span class="modal-key">Phone</span><span class="modal-val">${v.phone_number}</span></div>
    <div class="modal-row"><span class="modal-key">Violation</span><span class="modal-val"><span class="violation-tag ${vClass}">${v.violation_name}</span></span></div>
    <div class="modal-row"><span class="modal-key">Fine Amount</span><span class="modal-val fine-amt">₹${(v.fine_amount||0).toLocaleString()}</span></div>
    <div class="modal-row"><span class="modal-key">AI Detected</span><span class="modal-val">${v.detected_by_ai ? '✅ Yes' : '⚙ Manual Entry'}</span></div>
    <div class="modal-row"><span class="modal-key">Severity</span><span class="modal-val">${'★'.repeat(v.severity_weight||0)}${'☆'.repeat(5-(v.severity_weight||0))}</span></div>
    <div class="modal-row"><span class="modal-key">Payment</span><span class="modal-val">${v.payment_status === 'paid' ? '✅ Paid' : '⏳ Unpaid'}</span></div>
    <div class="modal-row"><span class="modal-key">Current Status</span><span class="modal-val"><span class="status-pill s-${v.status}">${capitalize(v.status)}</span></span></div>
  `;
  document.getElementById('modal-actions').innerHTML = v.status === 'pending' ? `
    <button class="modal-btn-approve" onclick="approveViolation('${v.record_id}')">✓ Approve & Issue Fine</button>
    <button class="modal-btn-reject" onclick="rejectViolation('${v.record_id}')">✕ Reject</button>
  ` : `<span style="font-size:13px;color:var(--muted);">Already processed.</span>`;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

// ============================================================
// RISK CARDS — from Supabase vehicles table
// ============================================================
function renderRiskCards(riskFilter) {
  const grid = document.getElementById('risk-grid');
  let vehicles = allVehicles.filter(v => v.total_violations > 0);
  if (riskFilter && riskFilter !== 'all') vehicles = vehicles.filter(v => v.risk_category === riskFilter);

  if (!vehicles.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">No risk data for this filter.</div>`;
    return;
  }
  const maxScore = 30;
  grid.innerHTML = vehicles.map(v => {
    const pct = Math.min(Math.round(((v.risk_score||0) / maxScore) * 100), 100);
    const fillClass = v.risk_category === 'High' ? 'fill-high' : v.risk_category === 'Medium' ? 'fill-medium' : 'fill-low';
    const catClass  = v.risk_category === 'High' ? 'risk-high' : v.risk_category === 'Medium' ? 'risk-medium' : 'risk-low';
    const warning   = v.risk_category === 'High'
      ? `<div class="warning-banner" onclick="showWarningModal(${JSON.stringify(v).replace(/"/g,'&quot;')})">⚠ HIGH RISK — Click to view warning →</div>`
      : '';
    return `
      <div class="risk-card">
        <div class="risk-header">
          <div><div class="risk-plate">${v.plate_number}</div><div class="risk-name">${v.owner_name}</div></div>
          <span class="risk-cat ${catClass}">${v.risk_category}</span>
        </div>
        <div class="risk-score-wrap">
          <div class="risk-score-label"><span>Risk Score</span><span class="risk-score-val">${v.risk_score} pts (${pct}%)</span></div>
          <div class="risk-bar-bg"><div class="risk-bar-fill ${fillClass}" style="width:${pct}%"></div></div>
        </div>
        <div class="risk-violations">${v.total_violations} approved violation${v.total_violations!==1?'s':''} on record</div>
        ${warning}
      </div>`;
  }).join('');
}

function filterRisk(cat, btn) {
  document.querySelectorAll('#risk-section .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRiskCards(cat);
}

// ============================================================
// HIGH RISK ALERTS BUTTON
// ============================================================
function checkHighRiskAlerts() {
  highRiskDrivers = allVehicles.filter(v => v.risk_category === 'High');
  const btn = document.getElementById('alerts-btn');
  const count = document.getElementById('alerts-count');
  if (highRiskDrivers.length > 0) {
    btn.classList.add('visible');
    count.textContent = highRiskDrivers.length;
  } else {
    btn.classList.remove('visible');
  }
}

// ============================================================
// ALERTS MODAL — list of all high risk drivers
// ============================================================
function openAlertsModal() {
  const list = document.getElementById('alerts-list');
  if (!highRiskDrivers.length) {
    list.innerHTML = `<div class="empty-state">No high risk drivers at this time.</div>`;
  } else {
    list.innerHTML = highRiskDrivers.map(v => {
      const pct = Math.min(Math.round(((v.risk_score||0) / 30) * 100), 100);
      return `
        <div style="background:rgba(192,86,74,0.1);border:1px solid rgba(192,86,74,0.25);border-radius:6px;padding:14px 16px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div>
              <div style="font-size:14px;font-weight:600;color:var(--gold);">${v.plate_number}</div>
              <div style="font-size:12px;color:var(--muted);">${v.owner_name} · ${v.phone_number}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:var(--red);">${v.risk_score} PTS</div>
              <div style="font-size:10px;color:var(--red);font-weight:700;letter-spacing:0.1em;">HIGH RISK</div>
            </div>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin-bottom:10px;">
            <div style="height:100%;width:${pct}%;border-radius:3px;background:linear-gradient(90deg,#C0564A,#E07070);"></div>
          </div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">${v.total_violations} approved violations on record</div>
          <div style="background:rgba(255,197,112,0.08);border:1px solid rgba(255,197,112,0.18);border-radius:4px;padding:10px 12px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gold);margin-bottom:5px;">📱 Warning Message</div>
            <div style="font-size:11px;color:var(--sand);line-height:1.6;">
              ⚠ Dear ${v.owner_name}, your vehicle (${v.plate_number}) has been flagged as HIGH RISK with a score of ${v.risk_score} points based on ${v.total_violations} traffic violations. Continued violations may result in license suspension and legal action. You are strongly advised to comply with all traffic regulations immediately.
            </div>
          </div>
          <button onclick="showWarningModal(${JSON.stringify(v).replace(/"/g,'&quot;')})" style="margin-top:10px;padding:7px 14px;background:rgba(192,86,74,0.2);color:var(--red);border:1px solid rgba(192,86,74,0.35);border-radius:4px;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;transition:background 0.15s;">View Full Details →</button>
        </div>`;
    }).join('');
  }
  document.getElementById('alerts-modal-overlay').classList.add('open');
}
function closeAlertsModal() { document.getElementById('alerts-modal-overlay').classList.remove('open'); }

// ============================================================
// SINGLE DRIVER WARNING MODAL
// ============================================================
function showWarningModal(vehicle) {
  if (typeof vehicle === 'string') vehicle = JSON.parse(vehicle);
  const pct = Math.min(Math.round(((vehicle.risk_score||0) / 30) * 100), 100);
  document.getElementById('warn-driver-name').textContent = vehicle.owner_name;
  document.getElementById('warn-score').textContent = `${vehicle.risk_score} pts`;
  document.getElementById('warn-bar').style.width = pct + '%';
  document.getElementById('warn-details').innerHTML = `
    <div class="modal-row"><span class="modal-key">Plate</span><span class="modal-val"><span class="plate-badge">${vehicle.plate_number}</span></span></div>
    <div class="modal-row"><span class="modal-key">Phone</span><span class="modal-val">${vehicle.phone_number}</span></div>
    <div class="modal-row"><span class="modal-key">Violations on Record</span><span class="modal-val" style="color:var(--red);font-weight:600;">${vehicle.total_violations} approved violations</span></div>
    <div class="modal-row"><span class="modal-key">Risk Category</span><span class="modal-val"><span class="risk-cat risk-high">HIGH</span></span></div>
  `;
  document.getElementById('warn-msg').textContent =
    `⚠ Dear ${vehicle.owner_name}, your vehicle (${vehicle.plate_number}) has been flagged as HIGH RISK with a score of ${vehicle.risk_score} points based on ${vehicle.total_violations} traffic violations. Continued violations may result in license suspension and legal action. You are strongly advised to comply with all traffic regulations immediately.`;
  document.getElementById('warning-modal-overlay').classList.add('open');
}
function closeWarningModal() { document.getElementById('warning-modal-overlay').classList.remove('open'); }

// ============================================================
// SECTION SWITCHER
// ============================================================
function showSection(section, el) {
  document.getElementById('violations-section').style.display = section === 'violations' ? 'block' : 'none';
  document.getElementById('risk-section').style.display = section === 'risk' ? 'block' : 'none';
  document.getElementById('page-title-text').textContent = section === 'violations' ? 'Violation Review Queue' : 'Driver Risk Analysis';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ============================================================
// FILTER HELPERS
// ============================================================
function filterStatus(status, btn) {
  currentFilter = status;
  document.querySelectorAll('#violations-section .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderViolations();
}
function filterTable(val) { currentSearch = val; renderViolations(); }

// ============================================================
// REPORT DOWNLOAD
// ============================================================
function downloadReport() {
  const approved = allViolations.filter(v => v.status === 'approved');
  const content = `
TrafficGuard — Violation Report
Generated: ${new Date().toLocaleString()}
Officer: ${sessionStorage.getItem('tg_name') || 'Officer'}
===================================

APPROVED VIOLATIONS SUMMARY
Total: ${approved.length} violations
Fines Issued: ₹${approved.reduce((s,v) => s+(v.fine_amount||0), 0).toLocaleString()}

DETAILS:
${approved.map((v,i) => `
${i+1}. ${v.plate_number} — ${v.owner_name}
   Violation: ${v.violation_name}
   Fine: ₹${(v.fine_amount||0).toLocaleString()}
   Date: ${v.detected_at ? new Date(v.detected_at).toLocaleString('en-IN') : '—'}
   AI Detected: ${v.detected_by_ai ? 'Yes' : 'No'}
`).join('')}

RISK SCORES:
${allVehicles.map(v => `  ${v.plate_number} (${v.owner_name}): Score ${v.risk_score} — ${v.risk_category} Risk`).join('\n')}
  `;
  const blob = new Blob([content], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `TrafficGuard_Report_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  showToast('📄 Report downloaded.', false);
}

// ============================================================
// LOGOUT
// ============================================================
async function logout() {
  await sb.auth.signOut();
  sessionStorage.clear();
  window.location.href = '../login/login.html';
}

// ============================================================
// UTILITIES
// ============================================================
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '') + ' show';
  setTimeout(() => t.classList.remove('show'), 3500);
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// Clock
function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
setInterval(updateClock, 1000); updateClock();

// Modal backdrop close
document.getElementById('modal-overlay').addEventListener('click', function(e) { if (e.target === this) closeModal(); });
document.getElementById('alerts-modal-overlay').addEventListener('click', function(e) { if (e.target === this) closeAlertsModal(); });
document.getElementById('warning-modal-overlay').addEventListener('click', function(e) { if (e.target === this) closeWarningModal(); });