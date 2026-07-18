/**
 * HedgeOps Dashboard — Client-side state poller & renderer.
 * Polls /api/state every 2 seconds and updates the DOM.
 */

const POLL_INTERVAL = 2000;

// ─── Utility Helpers ─────────────────────────────────────────────────

function formatMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatUptime(ms) {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function setBadgeClass(el, value) {
  // Remove all badge-related classes
  el.className = el.className.replace(/\b(excellent|average|poor|active|stalled|frustrated|high|medium|low|critical|dependency|outage|exploit|success|failed|running|paused|execute|short|monitor|warn|none|poll)\b/g, '').trim();
  if (value) {
    el.classList.add(value.toLowerCase());
  }
}

function setStepDot(step) {
  const dot = document.querySelector('.step-dot');
  dot.className = 'step-dot';
  if (step === 'ERROR') dot.classList.add('error');
  else if (step === 'EXECUTING') dot.classList.add('executing');
  else if (['CRAWLING', 'PARSING', 'CALCULATING'].includes(step)) dot.classList.add('crawling');
}

// ─── Main Render Function ────────────────────────────────────────────

function render(state) {
  // Header
  const modePill = document.getElementById('modePill');
  const modeText = document.getElementById('modeText');
  modeText.textContent = state.mode;
  modePill.className = 'status-pill';
  if (state.mode === 'LIVE') modePill.classList.add('live');
  else if (state.mode === 'HYBRID') modePill.classList.add('hybrid');

  document.getElementById('targetRepo').textContent = state.target || '—';
  document.getElementById('stepText').textContent = state.currentStep;
  setStepDot(state.currentStep);

  // Top Metrics
  const risk = state.risk;
  const fragility = risk ? (risk.probability * 100).toFixed(1) + '%' : '—';
  const fragilityNum = risk ? risk.probability * 100 : 0;
  document.getElementById('fragility').textContent = fragility;
  const fragilityBar = document.getElementById('fragilityBar');
  fragilityBar.style.width = `${fragilityNum}%`;
  fragilityBar.className = 'metric-bar-fill';
  if (fragilityNum >= 75) fragilityBar.classList.add('danger');

  const conf = risk ? (risk.confidence * 100).toFixed(0) + '%' : '—';
  const confNum = risk ? risk.confidence * 100 : 0;
  document.getElementById('confidence').textContent = conf;
  document.getElementById('confidenceBar').style.width = `${confNum}%`;

  const action = risk ? (risk.action === 'EXECUTE' ? 'SHORT' : risk.action) : '—';
  const actionEl = document.getElementById('action');
  actionEl.textContent = action;
  actionEl.className = 'metric-value action-value';
  if (action === 'SHORT' || action === 'EXECUTE') actionEl.style.color = 'var(--accent-red)';
  else if (action === 'WARN') actionEl.style.color = 'var(--accent-yellow)';
  else if (action === 'POLL') actionEl.style.color = 'var(--accent-blue)';
  else actionEl.style.color = 'var(--accent-green)';

  document.getElementById('recommendation').textContent = risk ? `Rec: ${risk.recommendation}` : '—';

  const perf = state.performance;
  document.getElementById('totalLatency').textContent = perf ? formatMs(perf.totalMs) : '—';
  document.getElementById('latencyBreakdown').textContent = perf
    ? `Anakin ${perf.anakinMs}ms · Brain ${perf.brainMs}ms`
    : '—';

  // Evidence Panel
  const ev = state.evidence;
  if (ev) {
    const healthEl = document.getElementById('repoHealth');
    healthEl.textContent = ev.repositoryHealth;
    healthEl.className = 'data-value badge';
    setBadgeClass(healthEl, ev.repositoryHealth);

    document.getElementById('openIssues').textContent = `${ev.openIssueCount} (${ev.issueVelocity})`;
    document.getElementById('issueVelocity').textContent = ev.issueVelocity;

    const secEl = document.getElementById('securityAdvisories');
    secEl.textContent = ev.securityAdvisories;
    secEl.className = 'data-value badge';
    setBadgeClass(secEl, ev.securityAdvisories);

    document.getElementById('commitFrequency').textContent = `${ev.commitFrequencyPerWeek}/week`;
    document.getElementById('maintainerResponse').textContent = formatMs(ev.maintainerResponseTimeMs);
  }

  // Analysis Panel
  const an = state.analysis;
  if (an) {
    const incEl = document.getElementById('incidentType');
    incEl.textContent = an.incidentType;
    incEl.className = 'data-value badge';
    setBadgeClass(incEl, an.incidentType);

    const sevEl = document.getElementById('severity');
    sevEl.textContent = an.severity;
    sevEl.className = 'data-value badge';
    setBadgeClass(sevEl, an.severity);

    const sentEl = document.getElementById('sentiment');
    sentEl.textContent = an.sentiment;
    sentEl.className = 'data-value badge';
    setBadgeClass(sentEl, an.sentiment);

    document.getElementById('daysStagnant').textContent = `${an.daysStagnant} days`;
    document.getElementById('analysisConfidence').textContent = `${(an.confidence * 100).toFixed(0)}%`;
  }

  if (risk) {
    document.getElementById('catastrophic').textContent = risk.catastrophic ? '⚠️ YES' : '✓ NO';
    document.getElementById('catastrophic').style.color = risk.catastrophic ? 'var(--accent-red)' : 'var(--accent-green)';
  }

  // Transaction Panel — now handled by renderMarkets
  // (old txGrid rendering removed)

  // Health Panel
  const h = state.health;
  if (h) {
    document.getElementById('uptime').textContent = formatUptime(h.uptimeMs);
    document.getElementById('memory').textContent = `${h.memoryUsageMb.toFixed(1)} MB`;
    document.getElementById('cpuLoad').textContent = `${h.cpuUsagePercent.toFixed(1)}%`;
    document.getElementById('apiSuccess').textContent = `${(h.apiSuccessRate * 100).toFixed(1)}%`;
  }

  const sched = state.scheduler;
  if (sched) {
    document.getElementById('schedulerDrift').textContent = `${sched.driftMs.toFixed(1)}ms`;

    const schedStatusEl = document.getElementById('schedulerStatus');
    schedStatusEl.textContent = sched.status;
    schedStatusEl.className = 'data-value badge';
    setBadgeClass(schedStatusEl, sched.status);
  }

  // AI Stats
  if (h) {
    document.getElementById('aiRequests').textContent = h.totalAiRequests;
    document.getElementById('aiSuccess').textContent = h.successfulAiRequests;
    document.getElementById('aiFailed').textContent = h.failedAiRequests;
    document.getElementById('aiLatency').textContent = `${h.avgAiLatencyMs.toFixed(0)}ms`;
    document.getElementById('aiTokens').textContent = h.totalTokensUsed.toLocaleString();
    document.getElementById('aiCost').textContent = `$${h.estimatedAiCostUsd.toFixed(4)}`;
  }

  // Logs
  const logsContainer = document.getElementById('logsContainer');
  if (state.logs && state.logs.length > 0) {
    logsContainer.innerHTML = state.logs.map(log => {
      let cls = '';
      if (log.includes('SUCCESS') || log.includes('✅')) cls = 'success';
      else if (log.includes('ERROR') || log.includes('❌')) cls = 'error';
      else if (log.includes('WARN') || log.includes('⚠')) cls = 'warn';
      return `<div class="log-entry ${cls}">${escapeHtml(log)}</div>`;
    }).join('');
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  // Live Market Odds
  renderMarkets(state);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ─── Market Odds Rendering (all markets in Bento panel) ─────────────

let marketsData = [];

function renderMarkets(state) {
  const container = document.getElementById('marketsListContainer');
  const noMsg = document.getElementById('noMarketsMsg');
  const countEl = document.getElementById('marketCount');
  const markets = state.markets || [];

  marketsData = markets;

  if (markets.length === 0) {
    noMsg.style.display = 'block';
    countEl.textContent = '';
    // Clear any existing market cards
    const cards = container.querySelectorAll('.market-card');
    cards.forEach(c => c.remove());
    return;
  }

  noMsg.style.display = 'none';
  countEl.textContent = `${markets.length} active`;

  // Build HTML for all markets
  let html = '';
  markets.forEach((m, idx) => {
    const yesPercent = (m.yesPrice * 100).toFixed(1);
    const noPercent = (m.noPrice * 100).toFixed(1);
    const isReal = m.duelId && !m.duelId.startsWith('mkt-');
    const statusClass = m.resolved ? 'resolved' : 'active';
    const link = isReal ? `https://testnet.bento.fun/market/${m.duelId}` : '';

    html += `
      <div class="market-card ${statusClass}">
        <div class="market-card-header">
          <span class="market-card-question">${escapeHtml(m.question)}</span>
          ${m.resolved ? `<span class="market-resolved-badge">✅ ${m.winningOption || 'Resolved'}</span>` : ''}
        </div>
        <div class="market-card-odds">
          <div class="market-odd yes">
            <span class="market-odd-label">YES</span>
            <span class="market-odd-value">${yesPercent}%</span>
            <div class="market-odd-bar"><div class="market-odd-fill yes-fill" style="width: ${yesPercent}%"></div></div>
          </div>
          <div class="market-odd no">
            <span class="market-odd-label">NO</span>
            <span class="market-odd-value">${noPercent}%</span>
            <div class="market-odd-bar"><div class="market-odd-fill no-fill" style="width: ${noPercent}%"></div></div>
          </div>
        </div>
        <div class="market-card-footer">
          <span class="market-card-meta">${m.status.toUpperCase()} · Vol: ${m.totalVolume ? m.totalVolume.toFixed(1) : '0'}</span>
          <div class="market-card-actions">
            ${isReal ? `<a class="market-card-link" href="${link}" target="_blank" rel="noopener noreferrer">🔗 View on Bento</a>` : ''}
            ${!m.resolved ? `
              <button class="market-card-resolve" onclick="resolveMarket('${m.duelId}', 0)">YES wins</button>
              <button class="market-card-resolve" onclick="resolveMarket('${m.duelId}', 1)">NO wins</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  });

  // Replace content (keep noMsg element)
  const existingCards = container.querySelectorAll('.market-card');
  existingCards.forEach(c => c.remove());
  container.insertAdjacentHTML('beforeend', html);
}

// ─── Resolve Market Handler ──────────────────────────────────────────

async function resolveMarket(duelId, winningOption) {
  // If called with just winningOption (old pattern), use window.__activeDuelId
  if (typeof duelId === 'number') {
    winningOption = duelId;
    duelId = window.__activeDuelId;
  }
  if (!duelId) return;

  try {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duelId, winningOption }),
    });
    const data = await res.json();
    if (data.success) {
      // Force immediate refresh
      await poll();
    }
  } catch (err) {
    // Silently fail
  }
}

window.resolveMarket = resolveMarket;

// ─── Scheduler Control ───────────────────────────────────────────────

let schedulerRunning = true;

async function toggleScheduler() {
  const btn = document.getElementById('schedulerToggle');
  btn.disabled = true;

  try {
    if (schedulerRunning) {
      const res = await fetch('/api/scheduler/stop', { method: 'POST' });
      if ((await res.json()).success) {
        schedulerRunning = false;
      }
    } else {
      const res = await fetch('/api/scheduler/start', { method: 'POST' });
      if ((await res.json()).success) {
        schedulerRunning = true;
      }
    }
  } catch (err) {
    // Silently fail
  }

  updateSchedulerButton();
  btn.disabled = false;
}

function updateSchedulerButton() {
  const btn = document.getElementById('schedulerToggle');
  const icon = document.getElementById('schedulerIcon');
  const text = document.getElementById('schedulerBtnText');

  if (schedulerRunning) {
    btn.className = 'ctrl-btn scheduler-btn running';
    icon.textContent = '⏸';
    text.textContent = 'Stop Scheduler';
  } else {
    btn.className = 'ctrl-btn scheduler-btn stopped';
    icon.textContent = '▶️';
    text.textContent = 'Start Scheduler';
  }
}

window.toggleScheduler = toggleScheduler;

// ─── Incident Trigger ────────────────────────────────────────────────

async function triggerIncident(type, evt) {
  const btn = evt.currentTarget;
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    await fetch('/api/trigger-incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
  } catch (err) {
    // Silently fail
  }

  // Poll immediately to get fresh state
  await poll();

  btn.classList.remove('loading');
  btn.disabled = false;
}

window.triggerIncident = triggerIncident;

// ─── Polling Loop ────────────────────────────────────────────────────

async function poll() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const state = await res.json();
      render(state);

      // Sync scheduler state from server
      if (state.scheduler) {
        schedulerRunning = state.scheduler.status === 'RUNNING';
        updateSchedulerButton();
      }
    }
  } catch (err) {
    // Silently retry on next interval
  }
}

// Start polling
poll();
setInterval(poll, POLL_INTERVAL);
