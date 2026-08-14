// ============================================================
// BLOOM BOARD — script.js
// Handles storage, parsing, rendering, charts, export/import
// ============================================================

// ── Storage (Claude artifact storage + localStorage fallback) ──
const hasClaudeStorage = typeof window !== 'undefined' && window.storage;

async function storageGet(key) {
  if (hasClaudeStorage) {
    try { return await window.storage.get(key); } catch(e) { return null; }
  }
  const raw = localStorage.getItem(key);
  return raw ? { value: raw } : null;
}

async function storageSet(key, value) {
  if (hasClaudeStorage) {
    try { return await window.storage.set(key, value); } catch(e) { return null; }
  }
  localStorage.setItem(key, value);
  return { value };
}

// ── State ──
let jobs = [];
let activeFilter = 'all';
let darkMode = false;
let charts = {};

// ── Dark Mode ──
function toggleDarkMode() {
  darkMode = !darkMode;
  localStorage.setItem('bloomDarkMode', darkMode);
  document.body.classList.toggle('dark-mode', darkMode);
  document.getElementById('modeIcon').textContent = darkMode ? '☀️' : '🌙';
  if (Object.keys(charts).length > 0) {
    Object.values(charts).forEach(c => { if (c && c.destroy) c.destroy(); });
    charts = {};
  }
}

async function initDarkMode() {
  darkMode = localStorage.getItem('bloomDarkMode') === 'true';
  if (darkMode) {
    document.body.classList.add('dark-mode');
    document.getElementById('modeIcon').textContent = '☀️';
  }
}

// ── View Switching ──
function switchView(view) {
  const boardView = document.getElementById('boardView');
  const analyticsView = document.getElementById('analyticsView');
  const btns = document.querySelectorAll('.view-btn');
  if (view === 'board') {
    boardView.classList.add('active');
    analyticsView.classList.remove('active');
    btns[0].classList.add('active');
    btns[1].classList.remove('active');
  } else {
    boardView.classList.remove('active');
    analyticsView.classList.add('active');
    btns[0].classList.remove('active');
    btns[1].classList.add('active');
    setTimeout(() => renderCharts(), 50);
  }
}

// ── Auto-detection: location from JD text ──
function detectLocation(text) {
  const keywords = [
    'remote', 'onsite', 'on-site', 'hybrid',
    'new york', 'san francisco', 'los angeles', 'chicago', 'houston',
    'denver', 'seattle', 'boston', 'austin', 'portland', 'atlanta',
    'miami', 'minneapolis', 'detroit', 'phoenix', 'san diego', 'dallas'
  ];
  const t = text.toLowerCase();
  for (const kw of keywords) {
    if (t.includes(kw)) {
      if (kw === 'remote') return 'Remote';
      if (kw === 'onsite' || kw === 'on-site') return 'On-site';
      if (kw === 'hybrid') return 'Hybrid';
      return kw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }
  return '';
}

// ── Auto-detection: title + company from JD text ──
function parseJD(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let title = '', company = '';
  if (lines.length > 0) title = lines[0].slice(0, 100);
  for (let i = 1; i < Math.min(lines.length, 6); i++) {
    const l = lines[i];
    if (l.length < 60 && !/^(job description|responsibilities|requirements|about|posted|full-time|part-time)/i.test(l)) {
      company = l.slice(0, 60); break;
    }
  }
  return { title, company };
}

// ── JD textarea: live parsing ──
document.getElementById('jdtext').addEventListener('input', (e) => {
  const text = e.target.value;
  const preview = document.getElementById('preview');
  if (!text.trim()) { preview.classList.remove('show'); return; }
  const { title, company } = parseJD(text);
  document.getElementById('titleOverride').value = title;
  document.getElementById('companyOverride').value = company;
  const loc = detectLocation(text);
  document.getElementById('location').value = loc;
  preview.classList.add('show');
  document.getElementById('preview-text').textContent =
    'Found: ' + (title || '—') + (company ? ' at ' + company : '') + (loc ? ' · ' + loc : '');
});

// ── Toggle advanced fields ──
function toggleAdvanced() {
  const adv = document.getElementById('advFields');
  const chevron = document.getElementById('advChevron');
  adv.classList.toggle('show');
  chevron.classList.toggle('ti-chevron-down');
  chevron.classList.toggle('ti-chevron-up');
}

// ── Source detection from URL ──
function detectSource(link) {
  const patterns = [
    [/ziprecruiter/i, 'ZipRecruiter'], [/indeed/i, 'Indeed'], [/linkedin/i, 'LinkedIn'],
    [/glassdoor/i, 'Glassdoor'], [/workday/i, 'Workday'], [/greenhouse/i, 'Greenhouse'],
    [/lever/i, 'Lever'], [/icims/i, 'iCIMS'], [/careers\.|\/careers|jobs\./i, 'Company Site']
  ];
  for (const [re, name] of patterns) if (re.test(link)) return name;
  return link ? 'Company Site' : '—';
}

// ── Add Job (with validation: requires at least title or company) ──
async function addJob() {
  const title = document.getElementById('titleOverride').value.trim();
  const company = document.getElementById('companyOverride').value.trim();

  // Validation: at least one field must be filled
  if (!title && !company) {
    const panel = document.querySelector('.add-panel');
    panel.style.boxShadow = '0 0 0 3px rgba(224,112,154,0.6)';
    setTimeout(() => panel.style.boxShadow = '', 1500);
    // Shake the title and company inputs to indicate error
    ['titleOverride','companyOverride'].forEach(id => {
      const el = document.getElementById(id);
      el.style.borderColor = '#E0709A';
      el.placeholder = id === 'titleOverride' ? '⚠ Role required' : '⚠ Company required';
      setTimeout(() => {
        el.style.borderColor = '';
        el.placeholder = 'Auto-detected';
      }, 2000);
    });
    return;
  }

  jobs.push({
    id: Date.now().toString(),
    title: title || 'Untitled',
    company: company || 'Unknown',
    location: document.getElementById('location').value.trim(),
    link: document.getElementById('link').value.trim(),
    salary: document.getElementById('salary').value.trim(),
    notes: document.getElementById('notesField').value.trim(),
    followupDate: document.getElementById('followupDate').value,
    status: 'applied',
    starred: false,
    dateAdded: new Date().toISOString()
  });

  await save();

  // Clear all form fields
  ['link','jdtext','titleOverride','companyOverride','location','salary','notesField','followupDate']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('preview').classList.remove('show');
  document.getElementById('advFields').classList.remove('show');
  const chevron = document.getElementById('advChevron');
  chevron.classList.add('ti-chevron-down');
  chevron.classList.remove('ti-chevron-up');

  render();
}

// ── Job actions ──
async function updateStatus(id, status) {
  const job = jobs.find(j => j.id === id);
  if (job) job.status = status;
  await save(); render();
}

async function toggleStar(id) {
  const job = jobs.find(j => j.id === id);
  if (job) job.starred = !job.starred;
  await save(); render();
}

async function deleteJob(id) {
  jobs = jobs.filter(j => j.id !== id);
  await save(); render();
}

// ── Delete ALL jobs (clear listing) ──
async function clearAllJobs() {
  if (!confirm('🌸 Are you sure you want to remove all jobs from your garden?')) return;
  jobs = [];
  await save(); render();
}

// ── Filter ──
function setFilter(f, el) {
  activeFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  render();
}

// ── XSS protection ──
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ── Main render ──
function render() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const today = new Date(); today.setHours(0,0,0,0);

  let filtered = jobs.filter(j => {
    if (search && !(j.title.toLowerCase().includes(search) || j.company.toLowerCase().includes(search) || (j.location||'').toLowerCase().includes(search))) return false;
    if (activeFilter === 'starred' && !j.starred) return false;
    if (activeFilter === 'followup' && !(j.followupDate && new Date(j.followupDate) <= today)) return false;
    return true;
  });

  const cols = { applied: [], interview: [], rejected: [] };
  filtered.forEach(j => { if (cols[j.status]) cols[j.status].push(j); });

  // Update stats
  const applied = jobs.filter(j => j.status === 'applied').length;
  const interviewed = jobs.filter(j => j.status === 'interview').length;
  const rejected = jobs.filter(j => j.status === 'rejected').length;
  const rate = applied > 0 ? Math.round((interviewed / applied) * 100) : 0;

  document.getElementById('stat-applied').textContent = applied;
  document.getElementById('stat-interview').textContent = interviewed;
  document.getElementById('stat-rejected').textContent = rejected;
  document.getElementById('stat-rate').textContent = rate + '%';

  // Show/hide clear all button
  const clearBtn = document.getElementById('clearAllBtn');
  if (clearBtn) clearBtn.style.display = jobs.length > 0 ? 'inline-flex' : 'none';

  // Render each column
  Object.keys(cols).forEach(status => {
    const container = document.getElementById('col-' + status);
    document.getElementById('count-' + status).textContent = cols[status].length;

    if (cols[status].length === 0) {
      container.innerHTML = '<div class="empty">Nothing planted here yet.</div>';
      return;
    }

    container.innerHTML = '';
    cols[status].forEach(j => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-inner">
          <div class="top-row">
            <div>
              <p class="title">${escapeHtml(j.title)}</p>
              <p class="company">${escapeHtml(j.company)}</p>
            </div>
            <button class="star ${j.starred ? 'active' : ''}" onclick="toggleStar('${j.id}')" aria-label="Priority">${j.starred ? '★' : '☆'}</button>
          </div>
          <p class="meta">
            <span class="source-badge">${escapeHtml(detectSource(j.link))}</span>
          </p>
          ${j.location ? `<p class="location"><i class="ti ti-map-pin" aria-hidden="true"></i>${escapeHtml(j.location)}</p>` : ''}
          ${j.salary ? `<p class="salary"><i class="ti ti-currency-dollar" aria-hidden="true"></i>${escapeHtml(j.salary)}</p>` : ''}
          ${j.notes ? `<p class="notes">${escapeHtml(j.notes)}</p>` : ''}
          ${j.resumeVersion ? `<p style="font-size: 11.5px; color: #7A9159; margin: 4px 0; display: flex; align-items: center; gap: 5px;"><i class="ti ti-file-cv" aria-hidden="true"></i>Resume: ${escapeHtml(j.resumeVersion)}</p>` : ''}
          ${j.followupDate ? `<p class="followup"><i class="ti ti-calendar-event" aria-hidden="true"></i>Follow up ${new Date(j.followupDate).toLocaleDateString()}</p>` : ''}
          ${j.link ? `<a href="${escapeHtml(j.link)}" target="_blank" rel="noopener"><i class="ti ti-external-link" aria-hidden="true"></i>View posting</a>` : ''}
          <div class="actions">
            <select onchange="updateStatus('${j.id}', this.value)">
              <option value="applied" ${j.status==='applied'?'selected':''}>Applied</option>
              <option value="interview" ${j.status==='interview'?'selected':''}>Interview</option>
              <option value="rejected" ${j.status==='rejected'?'selected':''}>Rejected</option>
            </select>
            <button class="del" onclick="deleteJob('${j.id}')" aria-label="Remove"><i class="ti ti-trash" aria-hidden="true"></i></button>
          </div>
        </div>
        <div class="card-decoration">✿ 🤍</div>
      `;
      container.appendChild(card);
    });
  });
}

// ── Charts ──
function renderCharts() {
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekData = {};
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - (6-i));
    weekData[days[d.getDay()]] = 0;
  }
  jobs.forEach(j => {
    const d = new Date(j.dateAdded);
    if (d >= weekAgo) { const k = days[d.getDay()]; if (k in weekData) weekData[k]++; }
  });

  const applied = jobs.filter(j => j.status === 'applied').length;
  const interviewed = jobs.filter(j => j.status === 'interview').length;
  const rejected = jobs.filter(j => j.status === 'rejected').length;

  const locData = {};
  jobs.forEach(j => { if (j.location) locData[j.location] = (locData[j.location] || 0) + 1; });
  const topLocs = Object.entries(locData).sort((a,b) => b[1]-a[1]).slice(0,5);

  if (charts.weekly) charts.weekly.destroy();
  charts.weekly = new Chart(document.getElementById('weeklyChart').getContext('2d'), {
    type: 'bar',
    data: { labels: Object.keys(weekData), datasets: [{ label: 'Applications', data: Object.values(weekData), backgroundColor: '#E0709A', borderRadius: 8, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  if (charts.funnel) charts.funnel.destroy();
  charts.funnel = new Chart(document.getElementById('funnelChart').getContext('2d'), {
    type: 'bar',
    data: { labels: ['Applied','Interview'], datasets: [{ data: [applied, interviewed], backgroundColor: ['#E0709A','#7A9159'], borderRadius: 8 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
  });

  if (charts.locations) charts.locations.destroy();
  charts.locations = new Chart(document.getElementById('locationsChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: topLocs.map(l=>l[0]), datasets: [{ data: topLocs.map(l=>l[1]), backgroundColor: ['#E0709A','#7A9159','#C08A2E','#F4C245','#C9A6E0'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });

  if (charts.status) charts.status.destroy();
  charts.status = new Chart(document.getElementById('statusChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['Applied','Interview','Rejected'], datasets: [{ data: [applied, interviewed, rejected], backgroundColor: ['#F4C245','#A8C08A','#E0709A'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

// ── Export / Import ──
function exportData() {
  const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-board-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

function exportCSV() {
  const headers = ['Title','Company','Location','Status','Salary','Applied Date','Notes'];
  const rows = jobs.map(j => [j.title, j.company, j.location, j.status, j.salary, new Date(j.dateAdded).toLocaleDateString(), j.notes]);
  let csv = headers.join(',') + '\n';
  rows.forEach(row => { csv += row.map(cell => `"${(cell||'').toString().replace(/"/g,'""')}"`).join(',') + '\n'; });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `bloom-board-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (Array.isArray(imported)) {
      jobs = [...jobs, ...imported];
      await save(); render();
      alert(`✓ Imported ${imported.length} jobs!`);
    }
  } catch(e) { alert('Failed to import. Make sure the file is valid JSON.'); }
  event.target.value = '';
}

// ── Load / Save ──
async function load() {
  try {
    const res = await storageGet('bloom-jobs');
    jobs = res ? JSON.parse(res.value) : [];
  } catch(e) { jobs = []; }
  render();
}

async function save() {
  try { await storageSet('bloom-jobs', JSON.stringify(jobs)); }
  catch(e) { console.error('Save failed', e); }
}

// ── Keyboard shortcut: Cmd/Ctrl+Shift+N → focus JD textarea ──
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
    e.preventDefault();
    document.getElementById('jdtext').focus();
  }
});

// ── Init ──
initDarkMode();
load();