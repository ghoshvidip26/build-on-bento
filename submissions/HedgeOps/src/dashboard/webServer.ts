import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import {
  Evidence,
  IncidentAnalysis,
  RiskResult,
  TransactionResult,
  SchedulerState,
  HealthStatus,
} from '../core/interfaces.js';
import { PerformanceMetrics } from './terminalDashboard.js';
import { MarketOdds } from '../infrastructure/bentoAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DashboardState {
  mode: 'LIVE' | 'HYBRID' | 'SIMULATION';
  target: string;
  currentStep: string;
  evidence: Evidence | null;
  analysis: IncidentAnalysis | null;
  risk: RiskResult | null;
  transaction: TransactionResult | null;
  performance: PerformanceMetrics;
  scheduler: SchedulerState;
  health: HealthStatus | null;
  logs: string[];
  markets: MarketOdds[];
}

// Global mutable state — updated by the engine each tick
let dashboardState: DashboardState = {
  mode: 'SIMULATION',
  target: '',
  currentStep: 'IDLE',
  evidence: null,
  analysis: null,
  risk: null,
  transaction: null,
  performance: { anakinMs: 0, brainMs: 0, riskMs: 0, storageMs: 0, bentoMs: 0, totalMs: 0 },
  scheduler: { lastRun: '', driftMs: 0, executionTimeMs: 0, status: 'PAUSED' },
  health: null,
  logs: [],
  markets: [],
};

// Live state getter — registered by the engine so API always returns current values
let liveStateGetter: (() => Partial<DashboardState>) | null = null;

/**
 * Register a function that returns the live engine state on every API call.
 */
export function setLiveStateGetter(getter: () => Partial<DashboardState>): void {
  liveStateGetter = getter;
}

// Handlers registered by the engine
let resolveHandler: ((duelId: string, winningOption: number) => Promise<boolean>) | null = null;
let schedulerStopHandler: (() => void) | null = null;
let schedulerStartHandler: (() => void) | null = null;
let triggerIncidentHandler: ((type: string) => Promise<void>) | null = null;
let oddsRefreshHandler: (() => Promise<MarketOdds[]>) | null = null;

// Odds polling interval
let oddsPollingInterval: NodeJS.Timeout | null = null;

/**
 * Register the resolve handler from the engine.
 */
export function setResolveHandler(handler: (duelId: string, winningOption: number) => Promise<boolean>): void {
  resolveHandler = handler;
}

/**
 * Register scheduler control handlers.
 */
export function setSchedulerHandlers(stop: () => void, start: () => void): void {
  schedulerStopHandler = stop;
  schedulerStartHandler = start;
}

/**
 * Register the incident trigger handler.
 */
export function setTriggerIncidentHandler(handler: (type: string) => Promise<void>): void {
  triggerIncidentHandler = handler;
}

/**
 * Register the odds refresh handler and start background polling.
 */
export function setOddsRefreshHandler(handler: () => Promise<MarketOdds[]>): void {
  oddsRefreshHandler = handler;

  // Start a 5-second interval that refreshes odds from Bento
  if (oddsPollingInterval) clearInterval(oddsPollingInterval);
  oddsPollingInterval = setInterval(async () => {
    if (!oddsRefreshHandler) return;
    try {
      const markets = await oddsRefreshHandler();
      if (markets && markets.length > 0) {
        dashboardState.markets = markets;
      }
    } catch {
      // Silently ignore polling failures
    }
  }, 5000);
}

/**
 * Update the dashboard state from the engine tick.
 */
export function updateDashboardState(state: Partial<DashboardState>): void {
  dashboardState = { ...dashboardState, ...state };
}

/**
 * Append a log entry (keeps last 50).
 */
export function addDashboardLog(entry: string): void {
  dashboardState.logs.push(entry);
  if (dashboardState.logs.length > 50) {
    dashboardState.logs = dashboardState.logs.slice(-50);
  }
}

/**
 * Start the Express web dashboard server.
 */
export function startWebDashboard(port = 3000): void {
  const app = express();
  app.use(express.json());

  // Serve static frontend
  const publicDir = path.resolve(__dirname, '../../public');
  app.use(express.static(publicDir));

  // API endpoint — returns full dashboard state as JSON (always live)
  app.get('/api/state', (_req, res) => {
    if (liveStateGetter) {
      const live = liveStateGetter();
      res.json({ ...dashboardState, ...live });
    } else {
      res.json(dashboardState);
    }
  });

  // API endpoint — stop the scheduler
  app.post('/api/scheduler/stop', (_req, res) => {
    if (schedulerStopHandler) {
      schedulerStopHandler();
      res.json({ success: true, status: 'stopped' });
    } else {
      res.status(503).json({ error: 'Scheduler handler not available' });
    }
  });

  // API endpoint — start the scheduler
  app.post('/api/scheduler/start', (_req, res) => {
    if (schedulerStartHandler) {
      schedulerStartHandler();
      res.json({ success: true, status: 'running' });
    } else {
      res.status(503).json({ error: 'Scheduler handler not available' });
    }
  });

  // API endpoint — trigger an incident (inject + execute tick)
  app.post('/api/trigger-incident', async (req, res) => {
    const { type } = req.body as { type?: string };
    const incidentType = type || 'EXPLOIT';
    if (!triggerIncidentHandler) {
      res.status(503).json({ error: 'Trigger handler not available' });
      return;
    }
    try {
      await triggerIncidentHandler(incidentType);
      res.json({ success: true, type: incidentType });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API endpoint — resolve a market
  app.post('/api/resolve', async (req, res) => {
    const { duelId, winningOption } = req.body as { duelId?: string; winningOption?: number };
    if (!duelId || winningOption == null) {
      res.status(400).json({ error: 'duelId and winningOption required' });
      return;
    }
    if (!resolveHandler) {
      res.status(503).json({ error: 'Resolve handler not available' });
      return;
    }
    const success = await resolveHandler(duelId, winningOption);
    res.json({ success });
  });

  // Fallback to index.html for SPA
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(port, () => {
    logger.info('WebDashboard', `🌐 Dashboard running at http://localhost:${port}`);
  });
}
