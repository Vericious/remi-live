// projects.js — Project cards page for Remi showcase
// Fetches feed.json and renders per-project summary cards

const FEED_URL = 'https://remi-feed.vericious.workers.dev/feed.json';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchFeed() {
  const delays = [1000, 2000, 4000];
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      const res = await fetch(FEED_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < delays.length - 1) await sleep(delays[attempt]);
    }
  }
  console.error('Feed fetch failed after 3 attempts:', lastError);
  return null;
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

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function projectGithubUrl(projectName) {
  const known = {
    drift: 'https://github.com/Vericious/drift',
    showcase: 'https://github.com/Vericious/remi-live',
  };
  return known[projectName] || `https://github.com/Vericious/${projectName}`;
}

function buildProjectStats(feed) {
  const byProject = {};
  feed.feed.forEach(entry => {
    const p = entry.project;
    if (!byProject[p]) {
      byProject[p] = { entries: [], additions: 0, deletions: 0 };
    }
    byProject[p].entries.push(entry);
    if (entry.additions != null) byProject[p].additions += entry.additions;
    if (entry.deletions != null) byProject[p].deletions += entry.deletions;
  });

  return Object.entries(byProject).map(([name, data]) => {
    const sorted = [...data.entries].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    return {
      name,
      taskCount: data.entries.length,
      additions: data.additions,
      deletions: data.deletions,
      lastActivity: sorted[0]?.timestamp || null,
      recentEntries: sorted.slice(0, 5),
    };
  }).sort((a, b) => b.taskCount - a.taskCount);
}

function renderProjectCard(project) {
  const githubUrl = projectGithubUrl(project.name);
  const lastActive = project.lastActivity ? timeAgo(project.lastActivity) : '—';

  const recentHtml = project.recentEntries.length
    ? project.recentEntries.map(e => `
        <li class="project-recent-item">
          <span class="project-recent-id">${esc(e.id)}</span>
          <span class="project-recent-title">${esc(e.title || '—')}</span>
          <span class="project-recent-time">${timeAgo(e.timestamp)}</span>
        </li>
      `).join('')
    : '<li class="project-recent-empty">No recent activity</li>';

  const projectClass = project.name === 'drift' ? 'project-card-drift'
    : project.name === 'showcase' ? 'project-card-showcase'
    : '';

  return `
    <article class="project-card ${projectClass}">
      <div class="project-card-header">
        <div>
          <h2 class="project-card-name">${esc(project.name)}</h2>
          <span class="project-card-updated">last active ${lastActive}</span>
        </div>
        <a href="${esc(githubUrl)}" class="project-github-link" target="_blank" rel="noopener" aria-label="View ${esc(project.name)} on GitHub">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          GitHub
        </a>
      </div>

      <div class="project-card-metrics">
        <div class="project-metric">
          <span class="project-metric-value">${project.taskCount}</span>
          <span class="project-metric-label">tasks</span>
        </div>
        <div class="project-metric">
          <span class="project-metric-value stat-additions">+${formatNumber(project.additions)}</span>
          <span class="project-metric-label">added</span>
        </div>
        <div class="project-metric">
          <span class="project-metric-value stat-deletions">-${formatNumber(project.deletions)}</span>
          <span class="project-metric-label">removed</span>
        </div>
      </div>

      <div class="project-card-recent">
        <h3 class="project-recent-title-bar">Recent Activity</h3>
        <ul class="project-recent-list">
          ${recentHtml}
        </ul>
      </div>
    </article>
  `;
}

function renderProjects(projects) {
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  if (!projects || projects.length === 0) {
    grid.innerHTML = '<div class="feed-loading">No projects found.</div>';
    return;
  }

  grid.innerHTML = projects.map(renderProjectCard).join('');
}

function updateHeroStats(feed) {
  const metrics = feed.metrics || {};
  const el = document.getElementById('heroProjects');
  const tel = document.getElementById('heroTasks');
  const lel = document.getElementById('heroLines');
  if (el) el.textContent = metrics.projects?.length || '—';
  if (tel) tel.textContent = formatNumber(metrics.tasksCompleted);
  if (lel) lel.textContent = formatNumber(metrics.linesAdded);
}

async function refresh() {
  const grid = document.getElementById('projectsGrid');
  const errorEl = document.getElementById('feedError');

  const feed = await fetchFeed();
  if (!feed) {
    if (grid) grid.style.display = 'none';
    if (errorEl) errorEl.style.display = 'block';
    return;
  }

  if (errorEl) errorEl.style.display = 'none';
  if (grid) grid.style.display = '';

  updateHeroStats(feed);
  const projects = buildProjectStats(feed);
  renderProjects(projects);

  const lastRefresh = document.getElementById('lastRefresh');
  if (lastRefresh) lastRefresh.textContent = `updated ${timeAgo(feed.lastUpdated)}`;
}

// Theme
function initTheme() {
  const saved = localStorage.getItem('theme');
  const toggle = document.getElementById('themeToggle');
  if (saved === 'light') {
    document.documentElement.dataset.theme = 'light';
    if (toggle) toggle.textContent = '🌙';
  }
}

function toggleTheme() {
  const isLight = document.documentElement.dataset.theme === 'light';
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  if (isLight) {
    delete document.documentElement.dataset.theme;
    localStorage.setItem('theme', 'dark');
    toggle.textContent = '☀️';
  } else {
    document.documentElement.dataset.theme = 'light';
    localStorage.setItem('theme', 'light');
    toggle.textContent = '🌙';
  }
}

document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
initTheme();

// Retry
document.getElementById('feedRetryBtn')?.addEventListener('click', refresh);

// Init
refresh();
setInterval(refresh, 60_000);
