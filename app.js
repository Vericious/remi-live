// Remi — Live Build Log
// Fetches feed.json and renders dashboard

const FEED_URL = 'https://remi-feed.vericious.workers.dev/feed.json';
const REFRESH_MS = 60_000;

let feed = null;
let filter = 'all';

// ── Fetch ───────────────────────────────────────────────────────────────

async function fetchFeed() {
  const delays = [1000, 2000, 4000];
  for (let i = 0; i < delays.length; i++) {
    try {
      const res = await fetch(FEED_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i < delays.length - 1) await new Promise(r => setTimeout(r, delays[i]));
      else console.error('Feed fetch failed:', err);
    }
  }
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Status ──────────────────────────────────────────────────────────────

function updateStatus(data) {
  const el = document.getElementById('status');
  if (!el) return;
  const dot = el.querySelector('.status-dot');
  const text = el.querySelector('.status-text');

  if (!data) {
    dot.className = 'status-dot offline';
    text.textContent = 'offline';
    return;
  }

  const mins = (Date.now() - new Date(data.lastUpdated).getTime()) / 60_000;
  if (mins < 60) {
    dot.className = 'status-dot live';
    text.textContent = `live · ${timeAgo(data.lastUpdated)}`;
  } else if (mins < 360) {
    dot.className = 'status-dot idle';
    text.textContent = `idle · ${timeAgo(data.lastUpdated)}`;
  } else {
    dot.className = 'status-dot';
    text.textContent = `sleeping · ${timeAgo(data.lastUpdated)}`;
  }
}

// ── Stats ───────────────────────────────────────────────────────────────

function updateStats(metrics) {
  if (!metrics) return;

  // Aggregate from perProject if top-level is zero
  let tasks = metrics.tasksCompleted || 0;
  let added = metrics.linesAdded || 0;
  let commits = metrics.totalCommits || 0;

  if (metrics.perProject) {
    const pp = Object.values(metrics.perProject);
    if (!tasks) tasks = pp.reduce((s, p) => s + (p.tasks || 0), 0);
    if (!added) added = pp.reduce((s, p) => s + (p.additions || 0), 0);
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmt(val);
  };

  set('statTasks', tasks);
  set('statAdded', added);
  set('statCommits', commits || tasks); // fallback to tasks if no commit count
}

// ── Sparkline ───────────────────────────────────────────────────────────

function drawSparkline(entries) {
  const el = document.getElementById('sparkline');
  if (!el) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ date: d, count: 0 });
  }

  if (entries) {
    entries.forEach(e => {
      const d = new Date(e.timestamp);
      d.setHours(0, 0, 0, 0);
      const slot = days.find(day => day.date.getTime() === d.getTime());
      if (slot) slot.count++;
    });
  }

  const max = Math.max(...days.map(d => d.count), 1);
  const W = 100;
  const H = 32;
  const gap = 3;
  const barW = (W - gap * 6) / 7;

  const bars = days.map((day, i) => {
    const h = Math.max(2, (day.count / max) * H);
    const x = i * (barW + gap);
    return `<rect class="bar" x="${x}" y="${H - h}" width="${barW}" height="${h}" rx="2"/>`;
  }).join('');

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>`;
}

// ── Working On ──────────────────────────────────────────────────────────

function updateWorkingOn(data) {
  const section = document.getElementById('workingOn');
  const text = document.getElementById('workingText');
  if (!section || !text || !data?.feed) return;

  const active = data.feed.find(e => e.status === 'claimed' || e.status === 'in_progress');

  if (active) {
    section.hidden = false;
    text.innerHTML = `
      <span class="working-id">${esc(active.id)}</span>
      ${esc(active.title)}
      ${active.agent ? `<span class="working-agent">${esc(active.agent)}</span>` : ''}
    `;
  } else {
    section.hidden = true;
  }
}

// ── Feed ────────────────────────────────────────────────────────────────

function filterEntries(entries) {
  if (!entries) return [];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  return entries
    .filter(e => {
      if (filter === 'all') return true;
      const d = new Date(e.timestamp);
      if (filter === 'today') return d >= todayStart;
      if (filter === 'week') return d >= weekStart;
      return true;
    })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function renderEntry(entry) {
  const el = document.createElement('div');
  el.className = 'entry';

  const hasDetail = entry.summary || entry.additions != null;

  const statsHtml = [
    entry.additions != null ? `<span class="entry-add">+${entry.additions}</span>` : '',
    entry.deletions != null ? `<span class="entry-del">-${entry.deletions}</span>` : '',
    entry.agent ? `<span class="entry-agent">${esc(entry.agent)}</span>` : '',
  ].filter(Boolean).join('');

  el.innerHTML = `
    <div class="entry-top">
      <span class="entry-id">${esc(entry.id)}</span>
      <span class="entry-project" data-project="${esc(entry.project)}">${esc(entry.project)}</span>
      <span class="entry-time">${timeAgo(entry.timestamp)}</span>
    </div>
    <div class="entry-title">${esc(entry.title)}</div>
    ${hasDetail ? `<div class="entry-detail">
      ${entry.summary ? `<div class="entry-summary">${esc(entry.summary)}</div>` : ''}
      ${statsHtml ? `<div class="entry-stats">${statsHtml}</div>` : ''}
    </div>` : ''}
  `;

  if (hasDetail) {
    el.addEventListener('click', () => el.classList.toggle('open'));
  } else {
    el.style.cursor = 'default';
  }

  return el;
}

function renderFeed(entries) {
  const container = document.getElementById('feed');
  if (!container) return;

  if (!entries || entries.length === 0) {
    container.innerHTML = `<div class="feed-empty">${
      filter !== 'all' ? 'No activity in this period.' : 'No activity yet — agents are warming up.'
    }</div>`;
    // Reset to single element, not using gap-based list
    container.style.background = 'transparent';
    return;
  }

  container.style.background = '';
  container.innerHTML = '';
  entries.forEach(e => container.appendChild(renderEntry(e)));
}

// ── Filters ─────────────────────────────────────────────────────────────

function initFilters() {
  document.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      document.querySelectorAll('.filter').forEach(b => b.classList.toggle('active', b === btn));
      if (feed) renderFeed(filterEntries(feed.feed));
    });
  });
}

// ── Refresh ─────────────────────────────────────────────────────────────

async function refresh() {
  const data = await fetchFeed();
  updateStatus(data);

  if (!data) {
    document.getElementById('feed').innerHTML =
      '<div class="feed-empty">Feed unavailable — Remi might be sleeping. Try again in a minute.</div>';
    return;
  }

  feed = data;
  updateStats(data.metrics);
  drawSparkline(data.feed);
  updateWorkingOn(data);
  renderFeed(filterEntries(data.feed));
}

// ── Init ────────────────────────────────────────────────────────────────

initFilters();
refresh();
setInterval(refresh, REFRESH_MS);
