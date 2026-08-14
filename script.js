// ============================================================
// BLOOM BOARD — script.js
// Auto-detection, storage, rendering, charts, export/import
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

// ============================================================
// AUTO-DETECTION ENGINE
// ============================================================

// ── Detect job title ──
// Strategy: look for labeled fields first ("Job Title:", "Position:"),
// then fall back to finding a short, plausible title line near the top.
function detectTitle(text) {
  // Priority 1: labeled field patterns
  const labeled = text.match(/(?:job\s*title|position|role)\s*[:\-–]\s*(.+)/i);
  if (labeled) return labeled[1].trim().slice(0, 100);

  // Priority 2: "We're hiring a [title]" / "Looking for a [title]"
  const hiring = text.match(/(?:we(?:'re| are) hiring|looking for|seeking)\s+(?:a|an)?\s+(.{5,60}?)(?:\s+to|\s+who|\s+at|\.|,|!)/i);
  if (hiring) return hiring[1].trim();

  // Priority 3: first short non-noise line
  const noiseWords = /^(about|we are|we're|join|apply|overview|summary|description|responsibilities|requirements|qualifications|benefits|company|posted|full-time|part-time|contract|permanent|location|salary|compensation|who we are|what you)/i;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length >= 5 && line.length <= 80 && !noiseWords.test(line) && !/^\d/.test(line)) {
      return line;
    }
  }
  return '';
}

// ── Detect company name ──
// Strategy: look for "About [Company]", "at [Company]", "[Company] is hiring", etc.
function detectCompany(text) {
  // Priority 1: "About [Company]" — very common in JDs
  const about = text.match(/about\s+([A-Z][A-Za-z0-9\s&.,'-]{2,40}?)(?:\n|\.|\s{2,}|,)/);
  if (about && about[1].trim().length > 1) return about[1].trim();

  // Priority 2: "[Company] is hiring / is looking / is seeking"
  const isHiring = text.match(/^([A-Z][A-Za-z0-9\s&.'-]{2,40}?)\s+(?:is hiring|is looking|is seeking|is a)/m);
  if (isHiring) return isHiring[1].trim();

  // Priority 3: "Join [Company]" or "at [Company]"
  const join = text.match(/(?:join|at)\s+([A-Z][A-Za-z0-9\s&.'-]{2,40}?)(?:\s+as|\s+and|\s+to|[.,!]|\n)/);
  if (join) return join[1].trim();

  // Priority 4: "Company: [name]" or "Employer: [name]"
  const labeled = text.match(/(?:company|employer|organization)\s*[:\-–]\s*(.{2,50})/i);
  if (labeled) return labeled[1].trim();

  // Fallback: short line after the title that looks like a company name
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const noiseWords = /^(job|role|position|location|salary|remote|hybrid|about|we are|responsibilities|requirements|full-time|part-time)/i;
  for (const line of lines.slice(1, 7)) {
    if (line.length >= 2 && line.length <= 50 && !noiseWords.test(line) && /[A-Z]/.test(line[0])) {
      return line;
    }
  }
  return '';
}

// ── Detect location ──
// Supports: Remote/Hybrid/On-site, Canadian cities, US cities, "City, Province/State"
function detectLocation(text) {
  const t = text.toLowerCase();

  // Work type — check first
  const isRemote = /\bremote\b/.test(t);
  const isHybrid = /\bhybrid\b/.test(t);
  const isOnsite = /\b(on[\s-]?site|in[\s-]?office|in[\s-]?person)\b/.test(t);

  // "Location:" labeled field — most reliable
  const labeled = text.match(/location\s*[:\-–]\s*(.{3,60}?)(?:\n|$)/i);
  if (labeled) {
    const loc = labeled[1].trim();
    if (isRemote && !loc.toLowerCase().includes('remote')) return loc + ' (Remote)';
    return loc;
  }

  // City, Province/State pattern — e.g. "Toronto, ON" or "Austin, TX"
  const cityProvince = text.match(/([A-Z][a-zA-Z\s]{2,20}),\s*(?:ON|BC|AB|QC|MB|SK|NS|NB|PE|NL|NT|YT|NU|CA|NY|TX|WA|MA|CO|IL|GA|FL|OR|AZ|MI|MN|OH|NC|VA|PA|NJ|MD|CT|TN|MO|IN|WI|KY|LA|AL|SC|OK|AR|UT|NV|ID|NM|WV|HI|NH|ME|RI|MT|ND|SD|WY|AK|DE|DC)\b/);
  if (cityProvince) {
    const loc = cityProvince[0].trim();
    if (isRemote) return loc + ' (Remote)';
    if (isHybrid) return loc + ' (Hybrid)';
    return loc;
  }

  // Canadian cities
  const caCities = ['toronto', 'scarborough', 'mississauga', 'brampton', 'north york', 'etobicoke', 'markham', 'richmond hill', 'vaughan', 'oakville', 'hamilton', 'london', 'ottawa', 'montreal', 'vancouver', 'calgary', 'edmonton', 'winnipeg', 'kitchener', 'waterloo'];
  for (const city of caCities) {
    if (t.includes(city)) {
      const name = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (isRemote) return name + ' (Remote)';
      if (isHybrid) return name + ' (Hybrid)';
      return name + ', ON';
    }
  }

  // US cities
  const usCities = ['new york', 'san francisco', 'los angeles', 'chicago', 'houston', 'denver', 'seattle', 'boston', 'austin', 'portland', 'atlanta', 'miami', 'minneapolis', 'detroit', 'phoenix', 'san diego', 'dallas', 'nashville', 'raleigh', 'charlotte', 'san jose', 'washington dc'];
  for (const city of usCities) {
    if (t.includes(city)) {
      const name = city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (isRemote) return name + ' (Remote)';
      if (isHybrid) return name + ' (Hybrid)';
      return name;
    }
  }

  // Just work type
  if (isRemote) return 'Remote';
  if (isHybrid) return 'Hybrid';
  if (isOnsite) return 'On-site';
  return '';
}

// ── Detect salary ──
// Catches: $80k, $80,000, $80,000 - $100,000, CAD 90k, 80-100k/year, etc.
function detectSalary(text) {
  // Range with currency symbol: $80,000 - $100,000 or $80k-$100k
  const rangeMatch = text.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*[kK]?\s*[-–to]+\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*[kK]?/);
  if (rangeMatch) {
    const lo = rangeMatch[1].replace(/,/g, '');
    const hi = rangeMatch[2].replace(/,/g, '');
    const fmt = n => parseFloat(n) < 1000 ? `$${n}k` : `$${parseInt(n).toLocaleString()}`;
    return `${fmt(lo)} – ${fmt(hi)}`;
  }

  // CAD / USD labeled
  const cadMatch = text.match(/(?:CAD|USD|CA\$|C\$)\s*(\d[\d,]*)\s*[kK]?\s*[-–]?\s*(?:CAD|USD|CA\$|C\$)?\s*(\d[\d,]*)?/i);
  if (cadMatch) {
    const currency = cadMatch[0].startsWith('C') ? 'CAD' : 'USD';
    return `${currency} ${cadMatch[0].trim()}`;
  }

  // Single salary: $90k or $90,000
  const singleMatch = text.match(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*[kK]?(?:\s*\/?\s*(?:year|yr|annual|annually))?/);
  if (singleMatch) {
    const raw = singleMatch[1].replace(/,/g, '');
    const val = parseFloat(raw);
    const formatted = val < 1000 ? `$${raw}k/yr` : `$${parseInt(raw).toLocaleString()}/yr`;
    return formatted;
  }

  // "Salary:" labeled
  const labeled = text.match(/(?:salary|compensation|pay|wage)\s*[:\-–]\s*(.{3,40})/i);
  if (labeled) return labeled[1].trim();

  return '';
}

// ── Detect job type ──
function detectJobType(text) {
  const t = text.toLowerCase();
  if (/\bcontract\b/.test(t)) return 'Contract';
  if (/\bpart[\s-]time\b/.test(t)) return 'Part-time';
  if (/\bfull[\s-]time\b/.test(t)) return 'Full-time';
  if (/\bfull[\s-]time|permanent\b/.test(t)) return 'Full-time';
  if (/\binternship|intern\b/.test(t)) return 'Internship';
  if (/\bfreelance\b/.test(t)) return 'Freelance';
  return '';
}

// ── Detect source from URL ──
function detectSource(link) {
  const patterns = [
    [/ziprecruiter/i, 'ZipRecruiter'], [/indeed/i, 'Indeed'], [/linkedin/i, 'LinkedIn'],
    [/glassdoor/i, 'Glassdoor'], [/workday/i, 'Workday'], [/greenhouse/i, 'Greenhouse'],
    [/lever/i, 'Lever'], [/icims/i, 'iCIMS'], [/careers\.|\/careers|jobs\./i, 'Company Site']
  ];
  for (const [re, name] of patterns) if (re.test(link)) return name;
  return link ? 'Company Site' : '—';
}

// ── Master parse function: runs all detectors on JD text ──
function parseJD(text) {
  return {
    title:    detectTitle(text),
    company:  detectCompany(text),
    location: detectLocation(text),
    salary:   detectSalary(text),
    jobType:  detectJobType(text)
  };
}

// ── JD textarea live parsing ──
document.getElementById('jdtext').addEventListener('input', (e) => {
  const text = e.target.value;
  const preview = document.getElementById('preview');
  if (!text.trim()) { preview.classList.remove('show'); return; }

  const { title, company, location, salary, jobType } = parseJD(text);

  // Only auto-fill if the field is currently empty (don't overwrite user's edits)
  if (title)    document.getElementById('titleOverride').value    = title;
  if (company)  document.getElementById('companyOverride').value  = company;
  if (location) document.getElementById('location').value         = location;
  if (salary)   document.getElementById('salary').value           = salary;
  if (jobType)  document.getElementById('jobType').value          = jobType;

  const parts = [title || '—', company ? `at ${company}` : '', location, salary].filter(Boolean);
  document.getElementById('preview-text').textContent = 'Found: ' + parts.join(' · ');
  preview.classList.add('show');
});

// ── Toggle advanced fields ──
function toggleAdvanced() {
  const adv = document.getElementById('advFields');
  const chevron = document.getElementById('advChevron');
  adv.classList.toggle('show');
  chevron.classList.toggle('ti-chevron-down');
  chevron.classList.toggle('ti-chevron-up');
}

// ── Resume upload handler ──
// Stores the filename as the resume version label; previews the file name
document.addEventListener('DOMContentLoaded', () => {
  const resumeInput = document.getElementById('resumeUpload');
  if (resumeInput) {
    resumeInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Extract a clean version name from filename (e.g. "Resume_BusinessAnalyst_v2.pdf" → "Business Analyst v2")
      const raw = file.name.replace(/\.(pdf|doc|docx)$/i, '').replace(/[_-]/g, ' ').replace(/resume|cv/gi, '').trim();
      document.getElementById('resumeVersion').value = raw || file.name;
      document.getElementById('resumeLabel').textContent = `📎 ${file.name}`;
    });
  }
});

// ============================================================
// JOB MANAGEMENT
// ============================================================

async function addJob() {
  const title = document.getElementById('titleOverride').value.trim();
  const company = document.getElementById('companyOverride').value.trim();

  // Validation: must have at least a title or company
  if (!title && !company) {
    ['titleOverride', 'companyOverride'].forEach(id => {
      const el = document.getElementById(id);
      el.style.borderColor = '#E0709A';
      el.style.boxShadow = '0 0 0 4px rgba(224,112,154,0.2)';
      el.placeholder = '⚠ Required';
      setTimeout(() => {
        el.style.borderColor = '';
        el.style.boxShadow = '';
        el.placeholder = 'Auto-detected';
      }, 2500);
    });
    document.querySelector('.add-panel').style.boxShadow = '0 0 0 3px rgba(224,112,154,0.5)';
    setTimeout(() => document.querySelector('.add-panel').style.boxShadow = '', 1500);
    return;
  }

  jobs.push({
    id: Date.now().toString(),
    title:         title || 'Untitled',
    company:       company || 'Unknown',
    location:      document.getElementById('location').value.trim(),
    link:          document.getElementById('link').value.trim(),
    salary:        document.getElementById('salary').value.trim(),
    jobType:       document.getElementById('jobType').value.trim(),
    hrName:        document.getElementById('hrName').value.trim(),
    hrEmail:       document.getElementById('hrEmail').value.trim(),
    hrPhone:       document.getElementById('hrPhone').value.trim(),
    notes:         document.getElementById('notesField').value.trim(),
    followupDate:  document.getElementById('followupDate').value,
    resumeVersion: document.getElementById('resumeVersion').value.trim(),
    status:        'applied',
    starred:       false,
    dateAdded:     new Date().toISOString()
  });

  await save();

  // Clear all fields
  ['link','jdtext','titleOverride','companyOverride','location','salary','jobType','hrName','hrEmail','hrPhone','notesField','followupDate','resumeVersion'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const resumeLabel = document.getElementById('resumeLabel');
  if (resumeLabel) resumeLabel.textContent = 'No file chosen';
  const resumeUpload = document.getElementById('resumeUpload');
  if (resumeUpload) resumeUpload.value = '';

  document.getElementById('preview').classList.remove('show');
  document.getElementById('advFields').classList.remove('show');
  const chevron = document.getElementById('advChevron');
  if (chevron) { chevron.classList.add('ti-chevron-down'); chevron.classList.remove('ti-chevron-up'); }

  render();
}

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

async function clearAllJobs() {
  if (!confirm('🌸 Remove all jobs from your garden?')) return;
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

// ── XSS safety ──
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ============================================================
// RENDERING
// ============================================================

function render() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const today = new Date(); today.setHours(0,0,0,0);

  let filtered = jobs.filter(j => {
    if (search && ![j.title, j.company, j.location, j.resumeVersion].some(f => (f||'').toLowerCase().includes(search))) return false;
    if (activeFilter === 'starred' && !j.starred) return false;
    if (activeFilter === 'followup' && !(j.followupDate && new Date(j.followupDate) <= today)) return false;
    return true;
  });

  const cols = { applied: [], interview: [], rejected: [] };
  filtered.forEach(j => { if (cols[j.status]) cols[j.status].push(j); });

  // Stats
  const applied    = jobs.filter(j => j.status === 'applied').length;
  const interviewed = jobs.filter(j => j.status === 'interview').length;
  const rejected   = jobs.filter(j => j.status === 'rejected').length;
  const rate = applied > 0 ? Math.round((interviewed / applied) * 100) : 0;

  document.getElementById('stat-applied').textContent   = applied;
  document.getElementById('stat-interview').textContent = interviewed;
  document.getElementById('stat-rejected').textContent  = rejected;
  document.getElementById('stat-rate').textContent      = rate + '%';

  // Clear all button visibility
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
            <div style="flex:1; min-width:0;">
              <p class="title">${escapeHtml(j.title)}</p>
              <p class="company">${escapeHtml(j.company)}</p>
            </div>
            <button class="star ${j.starred ? 'active' : ''}" onclick="toggleStar('${j.id}')" aria-label="Priority">${j.starred ? '★' : '☆'}</button>
          </div>

          <div class="card-badges">
            <span class="source-badge">${escapeHtml(detectSource(j.link))}</span>
            ${j.jobType ? `<span class="type-badge">${escapeHtml(j.jobType)}</span>` : ''}
          </div>

          <div class="card-meta-grid">
            ${j.location ? `<div class="meta-item location"><i class="ti ti-map-pin"></i><span>${escapeHtml(j.location)}</span></div>` : ''}
            ${j.salary   ? `<div class="meta-item salary"><i class="ti ti-currency-dollar"></i><span>${escapeHtml(j.salary)}</span></div>` : ''}
            ${j.hrName   ? `<div class="meta-item contact"><i class="ti ti-user"></i><span>${escapeHtml(j.hrName)}</span></div>` : ''}
            ${j.hrEmail  ? `<div class="meta-item contact"><i class="ti ti-mail"></i><a href="mailto:${escapeHtml(j.hrEmail)}" style="color:inherit;text-decoration:none;">${escapeHtml(j.hrEmail)}</a></div>` : ''}
            ${j.hrPhone  ? `<div class="meta-item contact"><i class="ti ti-phone"></i><span>${escapeHtml(j.hrPhone)}</span></div>` : ''}
            ${j.resumeVersion ? `<div class="meta-item resume"><i class="ti ti-file-cv"></i><span>${escapeHtml(j.resumeVersion)}</span></div>` : ''}
            ${j.followupDate  ? `<div class="meta-item followup"><i class="ti ti-calendar-event"></i><span>Follow up ${new Date(j.followupDate).toLocaleDateString()}</span></div>` : ''}
          </div>

          ${j.notes ? `<p class="notes">${escapeHtml(j.notes)}</p>` : ''}
          ${j.link  ? `<a class="view-link" href="${escapeHtml(j.link)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>View posting</a>` : ''}

          <div class="actions">
            <select onchange="updateStatus('${j.id}', this.value)">
              <option value="applied"   ${j.status==='applied'   ?'selected':''}>Applied</option>
              <option value="interview" ${j.status==='interview' ?'selected':''}>Interview</option>
              <option value="rejected"  ${j.status==='rejected'  ?'selected':''}>Rejected</option>
            </select>
            <button class="del" onclick="deleteJob('${j.id}')" aria-label="Remove"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <div class="card-decoration">✿ 🤍</div>
      `;
      container.appendChild(card);
    });
  });
}

// ============================================================
// CHARTS
// ============================================================

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

  const applied     = jobs.filter(j => j.status === 'applied').length;
  const interviewed = jobs.filter(j => j.status === 'interview').length;
  const rejected    = jobs.filter(j => j.status === 'rejected').length;

  const locData = {};
  jobs.forEach(j => { if (j.location) locData[j.location] = (locData[j.location] || 0) + 1; });
  const topLocs = Object.entries(locData).sort((a,b) => b[1]-a[1]).slice(0,5);

  if (charts.weekly)    charts.weekly.destroy();
  if (charts.funnel)    charts.funnel.destroy();
  if (charts.locations) charts.locations.destroy();
  if (charts.status)    charts.status.destroy();

  charts.weekly = new Chart(document.getElementById('weeklyChart').getContext('2d'), {
    type: 'bar',
    data: { labels: Object.keys(weekData), datasets: [{ label: 'Applications', data: Object.values(weekData), backgroundColor: '#E0709A', borderRadius: 8, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: Math.max(...Object.values(weekData), 5) } } }
  });

  charts.funnel = new Chart(document.getElementById('funnelChart').getContext('2d'), {
    type: 'bar',
    data: { labels: ['Applied','Interview'], datasets: [{ data: [applied, interviewed], backgroundColor: ['#E0709A','#7A9159'], borderRadius: 8 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
  });

  charts.locations = new Chart(document.getElementById('locationsChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: topLocs.map(l=>l[0]), datasets: [{ data: topLocs.map(l=>l[1]), backgroundColor: ['#E0709A','#7A9159','#C08A2E','#F4C245','#C9A6E0'], borderWidth: 2, borderColor: darkMode ? '#1a1a1a' : '#FFFBF4' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });

  charts.status = new Chart(document.getElementById('statusChart').getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['Applied','Interview','Rejected'], datasets: [{ data: [applied, interviewed, rejected], backgroundColor: ['#F4C245','#A8C08A','#E0709A'], borderWidth: 2, borderColor: darkMode ? '#1a1a1a' : '#FFFBF4' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

// ============================================================
// EXPORT / IMPORT
// ============================================================

function exportData() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' }));
  a.download = `bloom-board-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

function exportCSV() {
  const headers = ['Title','Company','Location','Status','Job Type','Salary','Resume Version','HR Name','HR Email','HR Phone','Applied Date','Notes'];
  const rows = jobs.map(j => [j.title, j.company, j.location, j.status, j.jobType, j.salary, j.resumeVersion, j.hrName, j.hrEmail, j.hrPhone, new Date(j.dateAdded).toLocaleDateString(), j.notes]);
  let csv = headers.join(',') + '\n';
  rows.forEach(row => { csv += row.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',') + '\n'; });
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
  } catch(e) { alert('Failed to import — please use a valid Bloom Board JSON file.'); }
  event.target.value = '';
}

// ============================================================
// INIT
// ============================================================

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

// Keyboard shortcut: Cmd/Ctrl+Shift+N → focus JD textarea
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
    e.preventDefault();
    document.getElementById('jdtext').focus();
  }
});

initDarkMode();
load();