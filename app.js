// Showcase — Live feed client
// Fetches feed.json from R2 and renders the dashboard

const FEED_URL = 'https://remi-feed.vericious.workers.dev/feed.json'; // Replace with R2 URL once configured
const REFRESH_INTERVAL = 60_000; // 1 minute

let lastFeedHash = null;
let rafId = null;
let currentFilter = 'all';
let currentProject = 'all';
let currentSearch = '';
let cachedFeed = null;

async function fetchFeed() {
  try {
    const res = await fetch(FEED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feed = await res.json();
    try { localStorage.setItem('cachedFeed', JSON.stringify(feed)); } catch(e) {}
    return feed;
  } catch (err) {
    console.error('Feed fetch failed:', err);
    return null;
  }
}

function getCachedFeed() {
  try {
    const raw = localStorage.getItem('cachedFeed');
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

let staleWarningDismissed = false;

function showStaleWarning() {
  if (staleWarningDismissed) return;
  let banner = document.getElementById('staleBanner');
  if (banner) return;
  banner = document.createElement('div');
  banner.id = 'staleBanner';
  banner.className = 'stale-banner';
  banner.innerHTML = 'Showing cached data — feed unavailable <button id="dismissStale" class="stale-dismiss">dismiss</button>';
  const container = document.querySelector('.container');
  if (container) container.insertBefore(banner, container.firstChild);
  document.getElementById('dismissStale').addEventListener('click', () => {
    banner.remove();
    staleWarningDismissed = true;
  });
}

function hideStaleWarning() {
  const banner = document.getElementById('staleBanner');
  if (banner) banner.remove();
}

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatNumber(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function updateStatus(feed) {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  if (!feed) {
    dot.className = 'status-dot error';
    text.textContent = 'offline';
    return;
  }

  const lastUpdate = new Date(feed.lastUpdated);
  const ageMinutes = (Date.now() - lastUpdate.getTime()) / 60_000;

  if (ageMinutes < 60) {
    dot.className = 'status-dot live';
    text.textContent = `live · updated ${timeAgo(feed.lastUpdated)}`;
  } else if (ageMinutes < 360) {
    dot.className = 'status-dot stale';
    text.textContent = `idle · updated ${timeAgo(feed.lastUpdated)}`;
  } else {
    dot.className = 'status-dot';
    text.textContent = `sleeping · updated ${timeAgo(feed.lastUpdated)}`;
  }
}

function animateValue(el, endValue, duration) {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const startValue = parseFloat(el.dataset.animValue) || 0;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startValue + (endValue - startValue) * eased;
    el.textContent = formatNumber(Math.round(current));
    el.dataset.animValue = current;

    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      el.textContent = formatNumber(endValue);
      el.dataset.animValue = endValue;
      rafId = null;
    }
  }

  rafId = requestAnimationFrame(tick);
}

function updateMetrics(metrics) {
  if (!metrics) return;
  animateValue(document.getElementById('tasksCompleted'), metrics.tasksCompleted, 500);
  animateValue(document.getElementById('linesAdded'), metrics.linesAdded, 500);
  animateValue(document.getElementById('linesRemoved'), metrics.linesRemoved, 500);
  animateValue(document.getElementById('testsPassing'), metrics.testsPassing, 500);
  animateValue(document.getElementById('totalCommits'), metrics.totalCommits, 500);
  const activeProjectsEl = document.getElementById('activeProjects');
  activeProjectsEl.textContent = metrics.projects?.length || '—';
  activeProjectsEl.dataset.animValue = metrics.projects?.length || 0;

  // Update hero stats
  document.getElementById('heroTasks').textContent = formatNumber(metrics.tasksCompleted);
  document.getElementById('heroLines').textContent = formatNumber(metrics.linesAdded);
  document.getElementById('heroCommits').textContent = formatNumber(metrics.totalCommits);
}

function drawCommitSparkline(entries) {
  const container = document.getElementById('commitSparkline');
  if (!container || !entries) return;

  // Build count per day for last 7 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({ date: d, count: 0 });
  }

  entries.forEach(entry => {
    const d = new Date(entry.timestamp);
    d.setHours(0, 0, 0, 0);
    const slot = days.find(day => day.date.getTime() === d.getTime());
    if (slot) slot.count++;
  });

  const maxCount = Math.max(...days.map(d => d.count), 1);
  const W = 120;
  const H = 36;
  const barW = W / 7 - 2;
  const gap = 2;

  const bars = days.map((day, i) => {
    const barH = Math.max(2, (day.count / maxCount) * H);
    const x = i * (barW + gap);
    const y = H - barH;
    return `<rect class="bar" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="1"/>`;
  }).join('');

  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}</svg>`;
}

function updateWorkingOn(feed) {
  const section = document.getElementById('workingOn');
  const content = document.getElementById('workingOnContent');
  const pulse = document.getElementById('workingPulse');

  if (!feed?.feed) return;

  // Find first entry with status 'claimed' or 'in_progress'
  const active = feed.feed.find(e =>
    e.status === 'claimed' || e.status === 'in_progress'
  );

  if (active) {
    section.className = 'working-on active';
    content.innerHTML = `
      <span class="working-task-id">${esc(active.id)}</span>
      <span class="working-title">${esc(active.title)}</span>
      ${active.agent ? `<span class="working-agent">${esc(active.agent)}</span>` : ''}
    `;
    pulse.style.display = '';
  } else {
    section.className = 'working-on';
    content.innerHTML = '<span class="working-idle">idle — waiting for next cycle</span>';
    pulse.style.display = 'none';
  }
}

function renderEntry(entry, isNew) {
  const el = document.createElement('div');
  el.className = `feed-entry${isNew ? ' new' : ''}${entry.summary ? ' expandable' : ''}`;

  const statsHtml = [
    entry.additions != null ? `<span class="stat-add">+${entry.additions}</span>` : '',
    entry.deletions != null ? `<span class="stat-del">-${entry.deletions}</span>` : '',
    entry.agent ? `<span class="stat-agent">${entry.agent}</span>` : '',
    entry.model ? `<span class="stat-model">${entry.model}</span>` : '',
  ].filter(Boolean).join('');

  const hasDetails = entry.summary || statsHtml;
  el.innerHTML = `
    <div class="entry-header">
      <div>
        <span class="entry-id">${esc(entry.id)}</span>
        <span class="entry-project">${esc(entry.project)}</span>
      </div>
      <div class="entry-header-right">
        <span class="entry-time">${timeAgo(entry.timestamp)}</span>
        ${hasDetails ? '<span class="entry-chevron">▾</span>' : ''}
      </div>
    </div>
    <div class="entry-title">${esc(entry.title)}</div>
    ${entry.summary ? `<div class="entry-summary" style="display:none">${esc(entry.summary)}</div>` : ''}
    ${statsHtml ? `<div class="entry-stats" style="display:none">${statsHtml}</div>` : ''}
  `;

  if (hasDetails) {
    el.addEventListener('click', () => {
      const summary = el.querySelector('.entry-summary');
      const stats = el.querySelector('.entry-stats');
      const chevron = el.querySelector('.entry-chevron');
      const isOpen = summary && summary.style.display !== 'none';
      if (summary) summary.style.display = isOpen ? 'none' : '';
      if (stats) stats.style.display = isOpen ? 'none' : '';
      if (chevron) chevron.textContent = isOpen ? '▾' : '▴';
    });
  }

  return el;
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderFeed(entries, forceNew) {
  const container = document.getElementById('feed');

  if (!entries || entries.length === 0) {
    if (currentSearch) {
      container.innerHTML = '<div class="feed-no-results">No entries match your search.</div>';
    } else {
      container.innerHTML = '<div class="feed-loading">No activity yet — agents are warming up.</div>';
    }
    return;
  }

  container.innerHTML = '';
  entries
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .forEach((entry, i) => {
      container.appendChild(renderEntry(entry, forceNew && i === 0));
    });
}

function feedHash(feed) {
  return feed?.lastUpdated + ':' + (feed?.feed?.length || 0);
}

function filterEntries(entries) {
  if (!entries) return [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const searchLower = currentSearch.toLowerCase().trim();

  return entries.filter(entry => {
    const d = new Date(entry.timestamp);
    let timeMatch = true;
    if (currentFilter === 'today') timeMatch = d >= todayStart;
    else if (currentFilter === 'week') timeMatch = d >= weekStart;
    else if (currentFilter === 'month') timeMatch = d >= monthStart;

    const projectMatch = currentProject === 'all' || entry.project === currentProject;

    let searchMatch = true;
    if (searchLower) {
      const titleMatch = (entry.title || '').toLowerCase().includes(searchLower);
      const summaryMatch = (entry.summary || '').toLowerCase().includes(searchLower);
      searchMatch = titleMatch || summaryMatch;
    }

    return timeMatch && projectMatch && searchMatch;
  });
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === filter);
  });
  if (cachedFeed) {
    renderFeed(filterEntries(cachedFeed.feed), false);
  }
}

function setProjectFilter(project) {
  currentProject = project;
  document.querySelectorAll('.project-badge').forEach(b => {
    b.classList.toggle('active', b.dataset.project === project);
  });
  if (cachedFeed) {
    renderFeed(filterEntries(cachedFeed.feed), false);
  }
}

function initProjectFilters(entries) {
  const container = document.getElementById('projectFilters');
  if (!entries || entries.length === 0) {
    container.innerHTML = '';
    return;
  }
  const projects = [...new Set(entries.map(e => e.project))].sort();
  container.innerHTML = projects.map(p =>
    `<button class="project-badge${currentProject === p ? ' active' : ''}" data-project="${esc(p)}">${esc(p)}</button>`
  ).join('') + `<button class="project-badge${currentProject === 'all' ? ' active' : ''}" data-project="all">All Projects</button>`;
  container.querySelectorAll('.project-badge').forEach(b => {
    b.addEventListener('click', () => setProjectFilter(b.dataset.project));
  });
}

function initFilterPills() {
  document.querySelectorAll('.filter-pill').forEach(p => {
    p.addEventListener('click', () => setFilter(p.dataset.filter));
  });
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function initSearch() {
  const input = document.getElementById('feedSearch');
  const clearBtn = document.getElementById('searchClear');
  if (!input) return;

  const handleSearch = debounce(() => {
    currentSearch = input.value;
    clearBtn.style.display = currentSearch ? '' : 'none';
    if (cachedFeed) {
      renderFeed(filterEntries(cachedFeed.feed), false);
    }
  }, 300);

  input.addEventListener('keyup', handleSearch);

  clearBtn.addEventListener('click', () => {
    input.value = '';
    currentSearch = '';
    clearBtn.style.display = 'none';
    if (cachedFeed) {
      renderFeed(filterEntries(cachedFeed.feed), false);
    }
  });
}

async function refresh() {
  const feedEl = document.getElementById('feed');
  const errorEl = document.getElementById('feedError');

  const feed = await fetchFeed();
  updateStatus(feed);

  if (!feed) {
    const cached = getCachedFeed();
    if (cached) {
      cachedFeed = cached;
      showStaleWarning();
      updateMetrics(cached.metrics);
      drawCommitSparkline(cached.feed);
      updateWorkingOn(cached);
      initProjectFilters(cached.feed);
      renderFeed(filterEntries(cached.feed), false);
      const updated = document.getElementById('feedUpdated');
      if (updated) updated.textContent = 'updated ' + timeAgo(cached.lastUpdated) + ' (cached)';
    } else {
      feedEl.style.display = 'none';
      errorEl.style.display = 'block';
    }
    return;
  }

  errorEl.style.display = 'none';
  feedEl.style.display = '';
  hideStaleWarning();
  staleWarningDismissed = false;

  const hash = feedHash(feed);
  const isNew = lastFeedHash !== null && hash !== lastFeedHash;
  lastFeedHash = hash;

  cachedFeed = feed;

  // Set default filter based on whether there are entries today
  if (currentFilter === 'all') {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const hasToday = feed.feed && feed.feed.some(e => new Date(e.timestamp) >= todayStart);
    if (hasToday) {
      setFilter('today');
    } else {
      setFilter('all');
    }
  }

  updateMetrics(feed.metrics);
  drawCommitSparkline(feed.feed);
  updateWorkingOn(feed);
  initProjectFilters(feed.feed);
  renderFeed(filterEntries(feed.feed), isNew);

  const updated = document.getElementById('feedUpdated');
  updated.textContent = `updated ${timeAgo(feed.lastUpdated)}`;

  const lastRefresh = document.getElementById('lastRefresh');
  lastRefresh.textContent = `refreshes every ${REFRESH_INTERVAL / 1000}s`;
}

// Project detail panel
function showProjectPanel(projectName) {
  const panel = document.getElementById('project-panel');
  const backdrop = document.getElementById('project-backdrop');
  const titleEl = document.getElementById('panelProjectName');
  const countEl = document.getElementById('panelTaskCount');
  const listEl = document.getElementById('panelActivityList');
  const chartEl = document.getElementById('panelStatusChart');
  const additionsEl = document.getElementById('panelAdditions');
  const deletionsEl = document.getElementById('panelDeletions');
  const commitsEl = document.getElementById('panelCommitCount');

  if (!panel || !cachedFeed?.feed) return;

  const projectEntries = cachedFeed.feed.filter(e => e.project === projectName);
  const total = projectEntries.length;

  // Status breakdown
  const statusCounts = { done: 0, in_progress: 0, claimed: 0 };
  let additions = 0;
  let deletions = 0;

  projectEntries.forEach(e => {
    if (e.status === 'done') statusCounts.done++;
    else if (e.status === 'in_progress') statusCounts.in_progress++;
    else if (e.status === 'claimed') statusCounts.claimed++;
    if (e.additions != null) additions += e.additions;
    if (e.deletions != null) deletions += e.deletions;
  });

  const statusColors = {
    done: 'var(--accent)',
    in_progress: 'var(--blue)',
    claimed: 'var(--orange)',
  };

  const statusLabels = {
    done: 'Shipped',
    in_progress: 'In Progress',
    claimed: 'Claimed',
  };

  const statusRows = Object.entries(statusCounts)
    .filter(([, count]) => count > 0 || total > 0)
    .map(([status, count]) => {
      const pct = total > 0 ? (count / total) * 100 : 0;
      return `
        <div class="panel-status-row">
          <span class="panel-status-label">
            <span class="panel-status-dot" style="background:${statusColors[status]}"></span>
            ${statusLabels[status]}
          </span>
          <div class="panel-status-bar-wrap">
            <div class="panel-status-bar" style="width:${pct}%;background:${statusColors[status]}"></div>
          </div>
          <span class="panel-status-count">${count}</span>
        </div>
      `;
    }).join('');

  chartEl.innerHTML = `
    <h4 class="panel-section-title">Status Breakdown</h4>
    ${statusRows || '<span style="font-size:0.8rem;color:var(--text-dim)">No tasks yet</span>'}
  `;

  titleEl.textContent = projectName;
  countEl.textContent = `${total} total task${total !== 1 ? 's' : ''}`;
  additionsEl.textContent = formatNumber(additions);
  deletionsEl.textContent = formatNumber(deletions);
  commitsEl.textContent = total;

  // Recent activity (last 8)
  const recent = [...projectEntries]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 8);

  listEl.innerHTML = recent.length
    ? recent.map(e => `
        <li class="panel-activity-item">
          <span class="panel-activity-id">${esc(e.id)}</span>
          <span class="panel-activity-title">${esc(e.title || '—')}</span>
          <span class="panel-activity-status status-${e.status}">${e.status}</span>
          <span class="panel-activity-time">${timeAgo(e.timestamp)}</span>
        </li>
      `).join('')
    : '<li class="panel-activity-empty">No recent activity</li>';

  panel.hidden = false;
  backdrop.hidden = false;
  backdrop.style.display = '';
  panel.style.transform = '';
}

function closeProjectPanel() {
  const panel = document.getElementById('project-panel');
  const backdrop = document.getElementById('project-backdrop');
  if (panel) {
    panel.hidden = true;
    panel.style.transform = '';
  }
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }
}

function initProjectPanel() {
  const closeBtn = document.getElementById('panelClose');
  const backdrop = document.getElementById('project-backdrop');

  closeBtn?.addEventListener('click', closeProjectPanel);
  backdrop?.addEventListener('click', closeProjectPanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProjectPanel();
  });

  // Delegate click on .entry-project badges in the feed
  document.getElementById('feed')?.addEventListener('click', (e) => {
    const badge = e.target.closest('.entry-project');
    if (badge) {
      const projectName = badge.textContent.trim();
      if (projectName) showProjectPanel(projectName);
    }
  });
}

// Initial load
initProjectPanel();
initFilterPills();
initSearch();
refresh();

// Poll
setInterval(refresh, REFRESH_INTERVAL);

// Retry button
document.getElementById('feedRetryBtn')?.addEventListener('click', refresh);

// Theme toggle
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    document.documentElement.dataset.theme = 'light';
    document.getElementById('themeToggle').textContent = '🌙';
  }
}

function toggleTheme() {
  const isLight = document.documentElement.dataset.theme === 'light';
  if (isLight) {
    delete document.documentElement.dataset.theme;
    localStorage.setItem('theme', 'dark');
    document.getElementById('themeToggle').textContent = '☀️';
  } else {
    document.documentElement.dataset.theme = 'light';
    localStorage.setItem('theme', 'light');
    document.getElementById('themeToggle').textContent = '🌙';
  }
}

document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
initTheme();
