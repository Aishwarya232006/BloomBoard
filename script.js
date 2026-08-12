// ============================================================
// BLOOM BOARD - Job Application Tracker
// Clean, simplified, and well-documented JavaScript
// ============================================================

// ============================================================
// STATE MANAGEMENT
// ============================================================
let jobs = [];              // Array of job objects
let activeFilter = 'all';   // Current filter state
let darkMode = false;       // Dark mode toggle
let charts = {};            // Chart.js instances

// ============================================================
// STORAGE FUNCTIONS
// ============================================================

// Get data from localStorage or Claude's artifact storage
async function storageGet(key) {
  // Try Claude artifact storage first
  if (typeof window !== 'undefined' && window.storage) {
    try {
      return await window.storage.get(key);
    } catch (e) {
      return null;
    }
  }
  // Fallback to localStorage
  const raw = localStorage.getItem(key);
  return raw ? { value: raw } : null;
}

// Save data to storage
async function storageSet(key, value) {
  if (typeof window !== 'undefined' && window.storage) {
    try {
      return await window.storage.set(key, value);
    } catch (e) {
      return null;
    }
  }
  localStorage.setItem(key, value);
  return { value };
}

// ============================================================
// INITIALIZATION
// ============================================================

// Load jobs from storage and render on page load
async function load() {
  try {
    const res = await storageGet('bloom-jobs');
    jobs = res ? JSON.parse(res.value) : [];
  } catch (e) {
    jobs = [];
  }
  render();
}

// Save jobs to storage
async function save() {
  try {
    await storageSet('bloom-jobs', JSON.stringify(jobs));
  } catch (e) {
    console.error('Save failed', e);
  }
}

// Initialize dark mode from localStorage
async function initDarkMode() {
  darkMode = localStorage.getItem('bloomDarkMode') === 'true';
  if (darkMode) {
    document.body.classList.add('dark-mode');
    document.getElementById('modeIcon').textContent = '☀️';
  }
}

// ============================================================
// DARK MODE
// ============================================================

function toggleDarkMode() {
  darkMode = !darkMode;
  localStorage.setItem('bloomDarkMode', darkMode);
  document.body.classList.toggle('dark-mode', darkMode);
  document.getElementById('modeIcon').textContent = darkMode ? '☀️' : '🌙';
  
  // Redraw charts in new theme
  if (Object.keys(charts).length > 0) {
    Object.values(charts).forEach(c => {
      if (c && c.destroy) c.destroy();
    });
    charts = {};
  }
}

// ============================================================
// VIEW MANAGEMENT
// ============================================================

// Switch between Board and Analytics views
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
    // Delay to ensure canvas is visible before rendering charts
    setTimeout(() => renderCharts(), 50);
  }
}

// ============================================================
// FORM HELPERS
// ============================================================

// Toggle visibility of advanced job fields
function toggleAdvanced() {
  const advFields = document.getElementById('advancedFields');
  advFields.style.display = advFields.style.display === 'none' ? 'block' : 'none';
}

// ============================================================
// DATA PARSING AND DETECTION
// ============================================================

// Detect job source from URL
function detectSource(link) {
  const patterns = [
    [/ziprecruiter/i, 'ZipRecruiter'],
    [/indeed/i, 'Indeed'],
    [/linkedin/i, 'LinkedIn'],
    [/glassdoor/i, 'Glassdoor'],
    [/workday/i, 'Workday'],
    [/greenhouse/i, 'Greenhouse'],
    [/lever/i, 'Lever'],
    [/icims/i, 'iCIMS'],
    [/careers\.|\/careers|jobs\./i, 'Company Site']
  ];
  for (const [re, name] of patterns) {
    if (re.test(link)) return name;
  }
  return 'Company Site';
}

// Detect location from job description text
function detectLocation(text) {
  const locations = [
    'remote', 'onsite', 'on-site', 'hybrid',
    'new york', 'san francisco', 'los angeles', 'chicago', 'houston',
    'denver', 'seattle', 'boston', 'austin', 'portland', 'atlanta'
  ];
  
  const t = text.toLowerCase();
  for (const keyword of locations) {
    if (t.includes(keyword)) {
      if (keyword === 'remote') return 'Remote';
      if (keyword === 'onsite' || keyword === 'on-site') return 'On-site';
      if (keyword === 'hybrid') return 'Hybrid';
      return keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }
  return '';
}

// Parse job description to extract title and company
function parseJD(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let title = '', company = '';
  
  // First line is usually the title
  if (lines.length > 0) title = lines[0].slice(0, 100);
  
  // Look for company name in next few lines
  for (let i = 1; i < Math.min(lines.length, 6); i++) {
    const l = lines[i];
    if (l.length < 60 && !/^(job description|responsibilities|requirements|about|posted|full-time|part-time)/i.test(l)) {
      company = l.slice(0, 60);
      break;
    }
  }
  
  return { title, company };
}

// ============================================================
// JOB MANAGEMENT
// ============================================================

// Add new job from form inputs
async function addJobFromDesc() {
  const title = document.getElementById('titleInput').value.trim() || 'Untitled';
  const company = document.getElementById('companyInput').value.trim() || 'Unknown';
  const location = document.getElementById('locationInput').value.trim() || '';
  const link = document.getElementById('linkInput').value.trim();
  const salary = document.getElementById('salaryInput').value.trim();
  const followupDate = document.getElementById('followUpInput').value;
  const notes = document.getElementById('notesInput').value.trim();

  if (!title && !company) return;

  // Create job object
  jobs.push({
    id: Date.now().toString(),
    title,
    company,
    location,
    link,
    salary,
    notes,
    followupDate,
    status: 'applied',
    starred: false,
    dateAdded: new Date().toISOString()
  });

  await save();
  clearForm();
  render();
}

// Clear form after job is added
function clearForm() {
  document.getElementById('titleInput').value = '';
  document.getElementById('companyInput').value = '';
  document.getElementById('locationInput').value = '';
  document.getElementById('linkInput').value = '';
  document.getElementById('salaryInput').value = '';
  document.getElementById('notesInput').value = '';
  document.getElementById('followUpInput').value = '';
  document.getElementById('jobDescInput').value = '';
  document.getElementById('advancedFields').style.display = 'none';
  document.getElementById('parsePreview').classList.remove('show');
}

// Update job status
async function updateStatus(id, status) {
  const job = jobs.find(j => j.id === id);
  if (job) job.status = status;
  await save();
  render();
}

// Toggle job as starred/priority
async function toggleStar(id) {
  const job = jobs.find(j => j.id === id);
  if (job) job.starred = !job.starred;
  await save();
  render();
}

// Delete job
async function deleteJob(id) {
  jobs = jobs.filter(j => j.id !== id);
  await save();
  render();
}

// ============================================================
// FILTERING AND SEARCHING
// ============================================================

// Apply filter based on user selection
function filterJobs(filter) {
  if (filter) {
    activeFilter = filter;
    // Update filter button states
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
  }
  render();
}

// ============================================================
// RENDERING
// ============================================================

// Escape HTML to prevent XSS
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Main render function - displays jobs organized by status
function render() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter jobs based on search and active filters
  let filtered = jobs.filter(j => {
    // Search filter
    if (search && !(j.title.toLowerCase().includes(search) || j.company.toLowerCase().includes(search) || j.location.toLowerCase().includes(search))) {
      return false;
    }
    // Priority filter
    if (activeFilter === 'priority' && !j.starred) return false;
    // Follow-up filter
    if (activeFilter === 'followup' && !(j.followupDate && new Date(j.followupDate) <= today)) return false;
    return true;
  });

  // Organize filtered jobs by status
  const cols = { applied: [], interview: [], rejected: [] };
  filtered.forEach(j => {
    if (cols[j.status]) cols[j.status].push(j);
  });

  // Calculate statistics
  const applied = jobs.filter(j => j.status === 'applied').length;
  const interviewed = jobs.filter(j => j.status === 'interview').length;
  const rejected = jobs.filter(j => j.status === 'rejected').length;
  const rate = applied > 0 ? Math.round((interviewed / applied) * 100) : 0;

  // Update stats display
  document.getElementById('stat-applied').textContent = applied;
  document.getElementById('stat-interview').textContent = interviewed;
  document.getElementById('stat-rejected').textContent = rejected;
  document.getElementById('stat-rate').textContent = rate + '%';

  // Render each column
  Object.keys(cols).forEach(status => {
    const container = document.getElementById('col-' + status);
    const countEl = document.getElementById('count-' + status);
    countEl.textContent = cols[status].length;

    // Show empty state if no jobs
    if (cols[status].length === 0) {
      container.innerHTML = '<div class="empty">Nothing planted here yet.</div>';
      return;
    }

    container.innerHTML = '';

    // Render each job card
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
          ${j.followupDate ? `<p class="followup"><i class="ti ti-calendar-event" aria-hidden="true"></i>Follow up ${new Date(j.followupDate).toLocaleDateString()}</p>` : ''}
          ${j.link ? `<a href="${escapeHtml(j.link)}" target="_blank"><i class="ti ti-external-link" aria-hidden="true"></i>View posting</a>` : ''}
          <div class="actions">
            <select onchange="updateStatus('${j.id}', this.value)">
              <option value="applied" ${j.status === 'applied' ? 'selected' : ''}>Applied</option>
              <option value="interview" ${j.status === 'interview' ? 'selected' : ''}>Interview</option>
              <option value="rejected" ${j.status === 'rejected' ? 'selected' : ''}>Rejected</option>
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

// ============================================================
// CHARTS & ANALYTICS
// ============================================================

function renderCharts() {
  // Weekly applications chart
  renderWeeklyChart();
  // Funnel chart (applied vs interviewed)
  renderFunnelChart();
  // Top locations pie chart
  renderLocationsChart();
  // Status breakdown pie chart
  renderStatusChart();
}

// Weekly bar chart showing applications per day
function renderWeeklyChart() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekData = {};
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Initialize week data
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = days[d.getDay()];
    weekData[key] = 0;
  }

  // Count jobs by day
  jobs.forEach(j => {
    const d = new Date(j.dateAdded);
    if (d >= weekAgo) {
      const key = days[d.getDay()];
      if (key) weekData[key]++;
    }
  });

  const weeklyCtx = document.getElementById('weeklyChart').getContext('2d');
  if (charts.weekly) charts.weekly.destroy();
  charts.weekly = new Chart(weeklyCtx, {
    type: 'bar',
    data: {
      labels: Object.keys(weekData),
      datasets: [{
        label: 'Applications',
        data: Object.values(weekData),
        backgroundColor: '#E0709A',
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

// Funnel chart showing applied vs interviewed
function renderFunnelChart() {
  const applied = jobs.filter(j => j.status === 'applied').length;
  const interviewed = jobs.filter(j => j.status === 'interview').length;

  const funnelCtx = document.getElementById('funnelChart').getContext('2d');
  if (charts.funnel) charts.funnel.destroy();
  charts.funnel = new Chart(funnelCtx, {
    type: 'bar',
    data: {
      labels: ['Applied', 'Interview'],
      datasets: [{
        label: 'Count',
        data: [applied, interviewed],
        backgroundColor: ['#E0709A', '#7A9159'],
        borderRadius: 8
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } }
    }
  });
}

// Doughnut chart showing top 5 locations
function renderLocationsChart() {
  const locData = {};
  jobs.forEach(j => {
    if (j.location) {
      locData[j.location] = (locData[j.location] || 0) + 1;
    }
  });
  const topLocs = Object.entries(locData).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const locCtx = document.getElementById('locationsChart').getContext('2d');
  if (charts.locations) charts.locations.destroy();
  charts.locations = new Chart(locCtx, {
    type: 'doughnut',
    data: {
      labels: topLocs.map(l => l[0]),
      datasets: [{
        data: topLocs.map(l => l[1]),
        backgroundColor: ['#E0709A', '#7A9159', '#C08A2E', '#F4C245', '#C9A6E0']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// Doughnut chart showing status breakdown
function renderStatusChart() {
  const applied = jobs.filter(j => j.status === 'applied').length;
  const interviewed = jobs.filter(j => j.status === 'interview').length;
  const rejected = jobs.filter(j => j.status === 'rejected').length;

  const statusCtx = document.getElementById('statusChart').getContext('2d');
  if (charts.status) charts.status.destroy();
  charts.status = new Chart(statusCtx, {
    type: 'doughnut',
    data: {
      labels: ['Applied', 'Interview', 'Rejected'],
      datasets: [{
        data: [applied, interviewed, rejected],
        backgroundColor: ['#F4C245', '#A8C08A', '#E0709A']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// ============================================================
// EXPORT/IMPORT
// ============================================================

// Export jobs as JSON file
function exportData() {
  const data = JSON.stringify(jobs, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bloom-board-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
}

// Export jobs as CSV file
function exportCSV() {
  const headers = ['Title', 'Company', 'Location', 'Status', 'Salary', 'Applied Date', 'Notes'];
  const rows = jobs.map(j => [
    j.title,
    j.company,
    j.location,
    j.status,
    j.salary,
    new Date(j.dateAdded).toLocaleDateString(),
    j.notes
  ]);

  let csv = headers.join(',') + '\n';
  rows.forEach(row => {
    csv += row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bloom-board-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

// Import jobs from JSON file
async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  try {
    const imported = JSON.parse(text);
    if (Array.isArray(imported)) {
      jobs = [...jobs, ...imported];
      await save();
      render();
      alert(`✓ Imported ${imported.length} jobs!`);
    }
  } catch (e) {
    alert('Failed to import. Make sure the file is valid JSON.');
  }
  event.target.value = '';
}

// ============================================================
// JOB DESCRIPTION INPUT HANDLER
// ============================================================

// Listen for paste events in job description textarea
document.addEventListener('DOMContentLoaded', () => {
  const jobDescInput = document.getElementById('jobDescInput');
  if (jobDescInput) {
    jobDescInput.addEventListener('input', (e) => {
      const text = e.target.value;
      const preview = document.getElementById('parsePreview');
      
      if (!text.trim()) {
        preview.classList.remove('show');
        return;
      }

      // Auto-detect title and company
      const { title, company } = parseJD(text);
      document.getElementById('titleInput').value = title;
      document.getElementById('companyInput').value = company;

      // Auto-detect location
      const detectedLocation = detectLocation(text);
      document.getElementById('locationInput').value = detectedLocation;

      // Show preview
      preview.classList.add('show');
      preview.textContent = 'Found: ' + (title || '—') + (company ? ' at ' + company : '') + (detectedLocation ? ' · ' + detectedLocation : '');
    });
  }
});

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

// Cmd/Ctrl + Shift + N to focus job description input
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
    e.preventDefault();
    document.getElementById('jobDescInput').focus();
  }
});

// ============================================================
// STARTUP
// ============================================================

initDarkMode();
load();
