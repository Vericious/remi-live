// test_projects.js — Tests for showcase/projects.js
// Run with: node test/test_projects.js

import { fetchFeed, buildProjectStats, renderProjects, renderProjectCard, projectGithubUrl, esc, timeAgo, formatNumber } from '../showcase/projects.js';

// ── Mock feed data ───────────────────────────────────────────────────────────

const MOCK_FEED = {
  lastUpdated: '2026-03-29T10:00:00Z',
  metrics: {
    tasksCompleted: 47,
    linesAdded: 28566,
    linesRemoved: 331,
    testsPassing: 0,
    totalCommits: 83,
    projects: ['drift', 'showcase'],
  },
  feed: [
    {
      id: 'DRIFT-147',
      timestamp: '2026-03-29T09:12:34Z',
      project: 'drift',
      title: 'add --update-baseline flag to drift scan',
      summary: null,
      agent: 'coder',
      model: 'MiniMax-M2.7',
      additions: 135,
      deletions: 0,
    },
    {
      id: 'SITE-056',
      timestamp: '2026-03-29T00:32:28Z',
      project: 'showcase',
      title: 'add noscript fallback message to index.html',
      summary: null,
      agent: 'coder',
      model: 'MiniMax-M2.7',
      additions: 34,
      deletions: 0,
    },
    {
      id: 'DRIFT-150',
      timestamp: '2026-03-28T23:09:07Z',
      project: 'drift',
      title: 'add get_changed_lines() to git_utils.py',
      summary: null,
      agent: 'coder',
      model: 'MiniMax-M2.7',
      additions: 128,
      deletions: 0,
    },
    {
      id: 'SITE-040',
      timestamp: '2026-03-28T23:58:21Z',
      project: 'showcase',
      title: 'add project detail slide-in panel CSS',
      summary: null,
      agent: 'coder',
      model: 'MiniMax-M2.7',
      additions: 222,
      deletions: 0,
    },
  ],
};

// ── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function test_projects_js_fetches_feed() {
  console.log('\ntest_projects_js_fetches_feed');
  const result = await fetchFeed('https://example.com/nonexistent.json');
  assert(result === null, 'fetchFeed returns null for unreachable URL after retries');
}

function test_project_github_url() {
  console.log('\ntest_project_github_url');
  assert(
    projectGithubUrl('drift') === 'https://github.com/Vericious/drift',
    'drift maps to correct GitHub URL'
  );
  assert(
    projectGithubUrl('showcase') === 'https://github.com/Vericious/remi-live',
    'showcase maps to correct GitHub URL'
  );
  assert(
    projectGithubUrl('unknown') === 'https://github.com/Vericious/unknown',
    'unknown project gets default GitHub URL'
  );
}

function test_build_project_stats() {
  console.log('\ntest_build_project_stats');
  const stats = buildProjectStats(MOCK_FEED);

  assert(Array.isArray(stats), 'buildProjectStats returns an array');

  const drift = stats.find(s => s.name === 'drift');
  const showcase = stats.find(s => s.name === 'showcase');

  assert(drift !== undefined, 'drift project is present');
  assert(showcase !== undefined, 'showcase project is present');

  assert(drift.taskCount === 2, `drift has 2 tasks (got ${drift.taskCount})`);
  assert(drift.additions === 263, `drift has 263 additions (got ${drift.additions})`);
  assert(drift.deletions === 0, `drift has 0 deletions (got ${drift.deletions})`);
  assert(Array.isArray(drift.recentEntries), 'drift has recentEntries array');
  assert(drift.recentEntries.length === 2, `drift recentEntries has 2 entries`);

  assert(showcase.taskCount === 2, `showcase has 2 tasks (got ${showcase.taskCount})`);
  assert(showcase.additions === 256, `showcase has 256 additions (got ${showcase.additions})`);
  assert(showcase.deletions === 0, `showcase has 0 deletions (got ${showcase.deletions})`);

  // Stats should be sorted by taskCount descending
  assert(stats[0].name === 'drift', 'drift is first (tied but consistent sort)');
}

async function test_project_cards_render_drift() {
  console.log('\ntest_project_cards_render_drift');
  const stats = buildProjectStats(MOCK_FEED);
  const drift = stats.find(s => s.name === 'drift');

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="projectsGrid"></div></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  renderProjects(stats);

  const cards = document.querySelectorAll('.project-card');
  assert(cards.length === 2, `renders 2 project cards (got ${cards.length})`);

  const driftCard = document.querySelector('.project-card-drift');
  assert(driftCard !== null, 'drift card has project-card-drift class');

  const nameEl = driftCard.querySelector('.project-card-name');
  assert(nameEl && nameEl.textContent === 'drift', 'drift card shows correct name');

  const metrics = driftCard.querySelectorAll('.project-metric');
  assert(metrics.length === 3, `drift card has 3 metrics (tasks/added/removed)`);
}

async function test_project_cards_render_showcase() {
  console.log('\ntest_project_cards_render_showcase');
  const stats = buildProjectStats(MOCK_FEED);

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="projectsGrid"></div></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  renderProjects(stats);

  const showcaseCard = document.querySelector('.project-card-showcase');
  assert(showcaseCard !== null, 'showcase card has project-card-showcase class');

  const nameEl = showcaseCard.querySelector('.project-card-name');
  assert(nameEl && nameEl.textContent === 'showcase', 'showcase card shows correct name');

  const recentSection = showcaseCard.querySelector('.project-card-recent');
  assert(recentSection !== null, 'showcase card has recent activity section');
}

async function test_project_card_has_github_link() {
  console.log('\ntest_project_card_has_github_link');
  const stats = buildProjectStats(MOCK_FEED);

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="projectsGrid"></div></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  renderProjects(stats);

  const cards = document.querySelectorAll('.project-card');
  let githubLinksFound = 0;

  cards.forEach(card => {
    const link = card.querySelector('.project-github-link');
    if (link) {
      const href = link.getAttribute('href');
      assert(
        href !== null && href.startsWith('https://github.com/'),
        `GitHub link found on ${card.className}: ${href}`
      );
      githubLinksFound++;
    }
  });

  assert(githubLinksFound === cards.length, `all ${cards.length} cards have GitHub links (found ${githubLinksFound})`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Running showcase/projects.js tests...');

  try {
    await test_projects_js_fetches_feed();
    test_project_github_url();
    test_build_project_stats();
    await test_project_cards_render_drift();
    await test_project_cards_render_showcase();
    await test_project_card_has_github_link();
  } catch (err) {
    console.error('Test error:', err.message);
    failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
