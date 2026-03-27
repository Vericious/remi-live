const FEED_URL = '../feed/feed.json';
const DEBOUNCE_MS = 300;

let allEntries = [];
let debounceTimer = null;

// Commits hardcoded data (last 20 from drift project)
const COMMITS = [
  { hash: '77edb59', message: 'DRIFT-098: Add Protocol and ABC extractor', author: 'remi', date: '2026-03-26T14:22:00Z' },
  { hash: 'ca2f381', message: 'Update CHANGELOG with completed tasks: DRIFT-086, SITE-001-008, SITE-030', author: 'remi', date: '2026-03-25T18:05:00Z' },
  { hash: 'd637b7c', message: 'Implement incremental scan with file hash cache', author: 'remi', date: '2026-03-24T11:30:00Z' },
  { hash: 'fb809b2', message: 'feat: plugin system with entry_points-based extractor loading (DRIFT-085)', author: 'remi', date: '2026-03-23T16:45:00Z' },
  { hash: '7a039fd', message: 'DRIFT-083: Add GitHub Actions drift-check composite action', author: 'remi', date: '2026-03-22T09:15:00Z' },
  { hash: '8741c66', message: 'DRIFT-082: Add pre-commit hook integration', author: 'remi', date: '2026-03-21T13:20:00Z' },
  { hash: 'fc98f7c', message: 'DRIFT-037: Add mypy strict config and fix type errors', author: 'remi', date: '2026-03-20T10:00:00Z' },
  { hash: 'e63fb17', message: 'feat(drift-081): JSDoc extractor for JS/TS files', author: 'remi', date: '2026-03-19T15:30:00Z' },
  { hash: 'd4c695f', message: 'chore(drift): update CHANGELOG for v0.4.1', author: 'remi', date: '2026-03-18T08:45:00Z' },
  { hash: 'df45d4a', message: 'feat(drift): add decorator extractor', author: 'remi', date: '2026-03-17T14:10:00Z' },
];

let currentCommitFilter = 'all';

// DOM elements
const feedEl = document.getElementById('feed');
const commitsEl = document.getElementById('commits');
const noResultsEl = document.getElementById('noResults');
const noResultsTermEl = document.getElementById('noResultsTerm');
const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearBtn');
const feedCountEl = document.getElementById('feedCount');
const commitCountEl = document.getElementById('commitCount');
const lastUpdatedEl = document.getElementById('lastUpdated');
const feedControlsEl = document.getElementById('feedControls');
const commitControlsEl = document.getElementById('commitControls');

// Metrics elements
const metricsEls = {
  tasksCompleted: document.getElementById('tasksCompleted'),
  linesAdded: document.getElementById('linesAdded'),
  linesRemoved: document.getElementById('linesRemoved'),
  testsPassing: document.getElementById('testsPassing'),
  totalCommits: document.getElementById('totalCommits'),
};

async function loadFeed() {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderMetrics(data.metrics);
    renderLastUpdated(data.lastUpdated);
    allEntries = data.feed || [];
    renderFeed(allEntries);
  } catch (err) {
    feedEl.innerHTML = `<div class="no-results">Failed to load feed: ${err.message}</div>`;
  }
}

function renderMetrics(metrics) {
  if (!metrics) return;
  metricsEls.tasksCompleted.textContent = metrics.tasksCompleted ?? '—';
  metricsEls.linesAdded.textContent = formatNumber(metrics.linesAdded ?? 0);
  metricsEls.linesRemoved.textContent = formatNumber(metrics.linesRemoved ?? 0);
  metricsEls.testsPassing.textContent = metrics.testsPassing ?? '—';
  metricsEls.totalCommits.textContent = metrics.totalCommits ?? '—';
}

function renderLastUpdated(iso) {
  if (!iso) return;
  const date = new Date(iso);
  lastUpdatedEl.textContent = `last updated: ${date.toUTCString()}`;
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

function formatTimestamp(iso) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function renderFeed(entries) {
  if (!entries || entries.length === 0) {
    feedEl.innerHTML = '<div class="no-results">No entries yet.</div>';
    updateCount(0, 0);
    return;
  }
  feedEl.innerHTML = entries.map(entry => createCard(entry)).join('');
  updateCount(entries.length, allEntries.length);
}

function createCard(entry) {
  const title = escapeHtml(entry.title || 'Untitled');
  const id = escapeHtml(entry.id || '');
  const project = escapeHtml(entry.project || '');
  const agent = escapeHtml(entry.agent || '');
  const model = escapeHtml(entry.model || '');
  const ts = formatTimestamp(entry.timestamp);
  const additions = entry.additions ?? 0;
  const deletions = entry.deletions ?? 0;

  return `
    <article class="feed-card" data-id="${id}" data-title="${title.toLowerCase()}" data-project="${project.toLowerCase()}">
      <span class="card-id">${id}</span>
      <div class="card-body">
        <div class="card-title">${title}</div>
        <div class="card-meta">
          <span>${project}</span>
          <span>${agent}</span>
          <span>${ts}</span>
        </div>
      </div>
      <div class="card-stats">
        <span class="stat-additions">+${additions}</span>
        <span class="stat-deletions">-${deletions}</span>
      </div>
    </article>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function filterFeed(term) {
  const query = term.toLowerCase().trim();
  const cards = feedEl.querySelectorAll('.feed-card');
  let visible = 0;

  cards.forEach(card => {
    const title = card.dataset.title || '';
    const id = card.dataset.id?.toLowerCase() || '';
    const project = card.dataset.project || '';
    const matches = !query ||
      title.includes(query) ||
      id.includes(query) ||
      project.includes(query);

    if (matches) {
      card.classList.remove('hidden');
      visible++;
    } else {
      card.classList.add('hidden');
    }
  });

  if (query && visible === 0) {
    noResultsEl.style.display = 'block';
    noResultsTermEl.textContent = term;
  } else {
    noResultsEl.style.display = 'none';
  }

  updateCount(visible, allEntries.length);
}

function updateCount(visible, total) {
  if (allEntries.length === 0) {
    feedCountEl.textContent = '';
    return;
  }
  const searchActive = searchInput.value.trim().length > 0;
  feedCountEl.textContent = searchActive
    ? `showing ${visible} of ${total}`
    : `${total} entries`;
}

function handleSearchInput() {
  const term = searchInput.value;
  clearBtn.classList.toggle('visible', term.length > 0);

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    filterFeed(term);
  }, DEBOUNCE_MS);
}

function handleClear() {
  searchInput.value = '';
  clearBtn.classList.remove('visible');
  filterFeed('');
  searchInput.focus();
}

// --- Tab switching ---
function switchTab(tab) {
  const isFeed = tab === 'feed';
  feedEl.style.display = isFeed ? '' : 'none';
  commitsEl.style.display = isFeed ? 'none' : '';
  feedControlsEl.style.display = isFeed ? '' : 'none';
  commitControlsEl.style.display = isFeed ? 'none' : '';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// --- Commit rendering ---
function formatCommitDate(iso) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays < 1) return 'today';
  if (diffDays < 2) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

function renderCommits(commits) {
  if (!commits || commits.length === 0) {
    commitsEl.innerHTML = '<div class="no-results">No commits in this range.</div>';
    commitCountEl.textContent = '';
    return;
  }
  commitsEl.innerHTML = commits.map(c => `
    <article class="commit-entry">
      <span class="commit-hash">${c.hash}</span>
      <div class="commit-body">
        <div class="commit-message">${escapeHtml(c.message)}</div>
        <div class="commit-meta">
          <span>${c.author}</span>
          <span>${formatCommitDate(c.date)}</span>
        </div>
      </div>
    </article>
  `).join('');
  commitCountEl.textContent = `${commits.length} commits`;
}

function filterCommits(range) {
  currentCommitFilter = range;
  const now = new Date();
  let filtered = COMMITS;

  if (range !== 'all') {
    const days = parseInt(range);
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    filtered = COMMITS.filter(c => new Date(c.date) >= cutoff);
  }

  renderCommits(filtered);

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });
}

// Event listeners
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => filterCommits(btn.dataset.range));
});

searchInput.addEventListener('input', handleSearchInput);
clearBtn.addEventListener('click', handleClear);

// Init
loadFeed();
filterCommits('all');
