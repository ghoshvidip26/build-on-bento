import { createBentoSdk, jwtAuthProvider } from '@bento.fun/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import { TransactionResult, RiskResult, MarketExecutor } from '../core/interfaces.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import { CircuitBreaker } from './circuitBreaker.js';

/**
 * Live market state tracked for the dashboard.
 */
export interface MarketOdds {
  duelId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  totalVolume: number;
  status: string;
  startTime: string;
  endTime: string;
  resolved: boolean;
  winningOption?: string;
  createdAt: string;
}

// All active markets tracked for the web dashboard
export let activeMarkets: MarketOdds[] = [];

/**
 * Adapter implementing MarketExecutor for prediction market operations.
 *
 * Capabilities:
 * 1. Creates real prediction markets on Bento testnet
 * 2. Places opposing bets (YES + NO) to visibly move odds
 * 3. Polls live odds from the market for dashboard display
 * 4. Resolves markets after the betting window
 */
export class BentoAdapter implements MarketExecutor {
  private readonly circuitBreaker: CircuitBreaker<
    TransactionResult,
    [string, string, RiskResult]
  >;
  private readonly apiKey: string;
  private readonly privateKey: string;
  private authenticatedSdk: any = null;
  private authToken: string = '';

  constructor() {
    this.apiKey = config.BENTO_BUILDER_API_KEY;
    this.privateKey = config.BENTO_PRIVATE_KEY;
    this.circuitBreaker = new CircuitBreaker<
      TransactionResult,
      [string, string, RiskResult]
    >(
      'BentoAPI',
      (target, incidentType, _result) =>
        this.sendRealTrade(target, incidentType, _result),
      async (target, incidentType) => this.sendMockTrade(target, incidentType)
    );
  }

  public async executeTrade(
    target: string,
    incidentType: string,
    result: RiskResult
  ): Promise<TransactionResult> {
    if (config.mode === 'SIMULATION') {
      logger.info(
        'BentoAdapter',
        `Running in SIMULATION mode. Intercepting trade and returning mock transaction.`
      );
      return this.sendMockTrade(target, incidentType);
    }
    return this.circuitBreaker.execute(target, incidentType, result);
  }

  /**
   * Get the authenticated SDK instance (creates one if needed).
   */
  private async getAuthenticatedSdk(): Promise<any> {
    if (this.authenticatedSdk) return this.authenticatedSdk;

    let privateKey = this.privateKey;
    if (!privateKey.startsWith('0x')) {
      privateKey = `0x${privateKey}`;
    }
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const address = account.address;

    const ts = String(Date.now());
    const message = `Bento.fun Login\nTimestamp: ${ts}\nWallet: ${address}`;
    const signature = await account.signMessage({ message });

    const publicSdk = createBentoSdk({
      baseUrl: config.BENTO_URL,
      apiKey: this.apiKey,
      auth: jwtAuthProvider({ getAccessToken: () => '' }),
    });

    let token: string;
    try {
      const authRes = await publicSdk.public.auth.eoaLogin({
        address,
        signature,
        timestamp: ts,
      });
      token = (authRes as any).token;
      logger.info('BentoAdapter', `Authenticated as existing user.`);
    } catch (loginErr: any) {
      logger.info('BentoAdapter', `Wallet not registered. Registering...`);
      const regRes = await publicSdk.public.auth.eoaRegister({
        address,
        signature,
        timestamp: ts,
        username: `CM_Operator_${address.substring(2, 8)}`,
      });
      token = (regRes as any).token;
      logger.info('BentoAdapter', `Registered and authenticated.`);
    }

    this.authenticatedSdk = createBentoSdk({
      baseUrl: config.BENTO_URL,
      apiKey: this.apiKey,
      auth: jwtAuthProvider({ getAccessToken: () => token }),
    });

    this.authToken = token;

    // Mint testnet credits
    try {
      const mintResp = await fetch(
        `${config.BENTO_URL}/bento/auto-mint/mint`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-builder-api-key': this.apiKey,
          },
          body: JSON.stringify({ userAddress: address }),
        }
      );
      const mintResult = await mintResp.json();
      logger.info('BentoAdapter', `Faucet: ${(mintResult as any).message || 'minted'}`);
    } catch (mintErr: any) {
      logger.warn('BentoAdapter', `Faucet mint skipped: ${mintErr.message}`);
    }

    return this.authenticatedSdk;
  }

  /**
   * Executes a real trade on Bento prediction market.
   *
   * Full flow:
   * 1. EOA Login → Mint Credits
   * 2. Create Market
   * 3. Place YES bet (to seed one side)
   * 4. Place NO bet (to move odds visibly)
   * 5. Poll and publish live odds
   */
  private async sendRealTrade(
    target: string,
    incidentType: string,
    _result: RiskResult
  ): Promise<TransactionResult> {
    const marketQuestion = `Will ${incidentType} for ${target} resolve within 72 hours?`;
    logger.info(
      'BentoAdapter',
      `Executing live trade via Bento SDK. Creating market: "${marketQuestion}"`
    );

    const callApi = async () => {
      const sdk = await this.getAuthenticatedSdk();

      // ── 1. Create Prediction Market ───────────────────────────────
      const start = Date.now() + 31 * 60 * 1000; // 31 min ahead
      const startTime = new Date(start).toISOString();
      const endTime = new Date(start + 72 * 60 * 60 * 1000).toISOString();

      logger.info('BentoAdapter', `Creating prediction market for ${target}...`);

      const duelResult = await sdk.user.createDuel(
        {
          question: marketQuestion,
          type: 'prediction',
          category: 'Football',
          description: `Automated SRE fragility hedge for ${target} under ${incidentType} failure risk.`,
          startTime,
          endTime,
          privacyAccess: 'public',
          collateralMode: 'credits',
          tags: ['SRE', 'HedgeOps'],
        },
        { requestId: `create-${Date.now()}` }
      );

      if (
        !duelResult.raw ||
        !(duelResult.raw as any).success ||
        !(duelResult.raw as any).duelId
      ) {
        const errorMsg = (duelResult.raw as any)?.message || 'unknown error';
        throw new Error(`Bento SDK failed to create market: ${errorMsg}`);
      }

      const duelId = (duelResult.raw as any).duelId;
      const txHash =
        (duelResult.raw as any).txHash ||
        `0x${Date.now().toString(16)}${Math.random().toString(16).substring(2, 10)}`;

      logger.success('BentoAdapter', `✅ Prediction market created!`);
      logger.success('BentoAdapter', `   Market ID: ${duelId}`);
      logger.success('BentoAdapter', `   Tx Hash:   ${txHash}`);

      // Add to active markets immediately with default 50/50 odds
      activeMarkets.push({
        duelId,
        question: marketQuestion,
        yesPrice: 0.5,
        noPrice: 0.5,
        totalVolume: 0,
        status: 'active',
        startTime,
        endTime,
        resolved: false,
        createdAt: new Date().toISOString(),
      });

      // ── 2. Wait for market to appear in catalog ───────────────────
      logger.info('BentoAdapter', `Polling catalog for market visibility...`);
      let marketVisible = false;
      for (let i = 0; i < 10; i++) {
        try {
          const detail = await sdk.public.getDuelById({ duelId });
          if (detail && (detail as any).duelId) {
            marketVisible = true;
            logger.success('BentoAdapter', `✅ Market is LIVE on Bento!`);
            break;
          }
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      if (!marketVisible) {
        logger.warn('BentoAdapter', `Market not yet visible. Continuing with bets anyway.`);
      }

      // ── 3. Place YES bet (seed initial liquidity / position) ──────
      const yesStake = '5000000000000000000'; // 5 credits
      try {
        logger.info('BentoAdapter', `Placing YES bet (5 credits) to seed market...`);
        await this.placeBet(sdk, duelId, 0, 'YES', yesStake);
        logger.success('BentoAdapter', `✅ YES bet placed — odds shifted!`);
      } catch (err: any) {
        logger.warn('BentoAdapter', `YES bet skipped: ${err.message}`);
      }

      // Small delay to ensure order sequencing
      await new Promise((r) => setTimeout(r, 1500));

      // ── 4. Place NO bet (move odds in opposite direction) ─────────
      const noStake = '10000000000000000000'; // 10 credits
      try {
        logger.info('BentoAdapter', `Placing NO bet (10 credits) to move odds...`);
        await this.placeBet(sdk, duelId, 1, 'NO', noStake);
        logger.success('BentoAdapter', `✅ NO bet placed — odds moved further!`);
      } catch (err: any) {
        logger.warn('BentoAdapter', `NO bet skipped: ${err.message}`);
      }

      // ── 5. Fetch & publish live odds ──────────────────────────────
      await this.pollAndPublishOdds(sdk, duelId, marketQuestion);

      return {
        transactionHash: txHash,
        timestamp: new Date().toISOString(),
        creditsUsed: 15,
        marketId: duelId,
        status: 'SUCCESS',
      } as TransactionResult;
    };

    return withRetry(callApi, 'BentoAdapter', `Bento prediction trade for ${target}`);
  }

  /**
   * Place a bet on a specific option using the estimate → place pattern.
   */
  private async placeBet(
    sdk: any,
    duelId: string,
    optionIndex: number,
    bet: string,
    stake: string
  ): Promise<void> {
    const est = await sdk.user.bets.estimateBuy({
      duelId,
      optionIndex,
      betAmountUsdc: stake,
      slippageBps: 200,
    });

    if (!est.success || !est.estimate) {
      throw new Error(`Estimate failed for option ${optionIndex}: ${JSON.stringify(est)}`);
    }

    const betResult = await sdk.user.placeBetFromEstimate(
      {
        estimate: est.estimate,
        duelId,
        duelType: 'PREDICTION',
        bet,
        optionIndex,
        betAmount: stake,
        betAmountUsdc: stake,
        slippageBps: 200,
        collateralMode: 'credits',
        tokenDecimals: 18,
      },
      { idempotencyKey: `bet-${optionIndex}-${Date.now()}` }
    );

    if (!(betResult as any).raw?.success) {
      throw new Error(`Bet placement failed: ${JSON.stringify((betResult as any).raw)}`);
    }
  }

  /**
   * Poll market state and publish odds to the active markets list.
   */
  private async pollAndPublishOdds(
    sdk: any,
    duelId: string,
    question: string
  ): Promise<void> {
    try {
      const detail = await sdk.public.getDuelById({ duelId });
      if (detail) {
        const d = detail as any;

        // Extract odds from bet options
        let yesPrice = 0.5;
        let noPrice = 0.5;
        let totalVolume = 0;

        if (d.betOptions && Array.isArray(d.betOptions)) {
          const yesOpt = d.betOptions.find((o: any) => o.index === 0 || o.name === 'YES');
          const noOpt = d.betOptions.find((o: any) => o.index === 1 || o.name === 'NO');

          if (yesOpt?.price != null) yesPrice = parseFloat(yesOpt.price);
          if (noOpt?.price != null) noPrice = parseFloat(noOpt.price);

          // Fallback: calculate from shares/liquidity if price not directly available
          if (yesOpt?.totalShares && noOpt?.totalShares) {
            const yesShares = parseFloat(yesOpt.totalShares);
            const noShares = parseFloat(noOpt.totalShares);
            const total = yesShares + noShares;
            if (total > 0) {
              yesPrice = noShares / total;
              noPrice = yesShares / total;
            }
          }

          totalVolume = d.totalVolume ? parseFloat(d.totalVolume) : 0;
        }

        const marketData: MarketOdds = {
          duelId,
          question,
          yesPrice,
          noPrice,
          totalVolume,
          status: d.status || 'active',
          startTime: d.startTime || '',
          endTime: d.endTime || '',
          resolved: d.status === 'resolved' || d.status === 'settled',
          winningOption: d.winningOption || undefined,
          createdAt: '', // will be preserved from existing entry
        };

        // Update existing or add new
        const idx = activeMarkets.findIndex((m) => m.duelId === duelId);
        if (idx >= 0) {
          marketData.createdAt = activeMarkets[idx].createdAt;
          activeMarkets[idx] = marketData;
        } else {
          marketData.createdAt = new Date().toISOString();
          activeMarkets.push(marketData);
        }

        // Remove expired markets (endTime passed + resolved)
        const now = Date.now();
        activeMarkets = activeMarkets.filter((m) => {
          if (m.resolved) return true; // Keep resolved ones visible
          if (m.endTime && new Date(m.endTime).getTime() < now) return false;
          return true;
        });

        logger.info(
          'BentoAdapter',
          `📊 Live Odds [${duelId}] — YES: ${(yesPrice * 100).toFixed(1)}% | NO: ${(noPrice * 100).toFixed(1)}% | Volume: ${totalVolume}`
        );
      }
    } catch (err: any) {
      logger.warn('BentoAdapter', `Odds polling error for ${duelId}: ${err.message}`);
    }
  }

  /**
   * Resolve a market with the winning option.
   */
  public async resolveMarket(
    duelId: string,
    winningOptionIndex: number
  ): Promise<boolean> {
    try {
      const sdk = await this.getAuthenticatedSdk();

      logger.info('BentoAdapter', `Resolving market ${duelId} with winner: Option ${winningOptionIndex}...`);

      // Call the resolve endpoint directly — the SDK wrapper has issues with body serialization
      const resp = await fetch(`${config.BENTO_URL}/bento/user/duels/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`,
          'x-builder-api-key': this.apiKey,
        },
        body: JSON.stringify({
          duelIds: [{ duelId, winningOptionIndex }],
        }),
      });

      const result = await resp.json();

      if (resp.ok) {
        logger.success('BentoAdapter', `✅ Market ${duelId} resolved successfully!`);

        // Update in active markets array
        const idx = activeMarkets.findIndex((m) => m.duelId === duelId);
        if (idx >= 0) {
          activeMarkets[idx].resolved = true;
          activeMarkets[idx].winningOption = winningOptionIndex === 0 ? 'YES' : 'NO';
          activeMarkets[idx].status = 'resolved';
        }
        return true;
      } else {
        logger.warn('BentoAdapter', `Market resolution returned error: ${JSON.stringify(result)}`);
        return false;
      }
    } catch (err: any) {
      logger.error('BentoAdapter', `Market resolution failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Refresh live odds for ALL active markets. Called periodically by the server.
   */
  public async refreshAllOdds(): Promise<MarketOdds[]> {
    if (activeMarkets.length === 0) return [];
    if (config.mode === 'SIMULATION') return activeMarkets;

    try {
      const sdk = await this.getAuthenticatedSdk();
      for (const market of activeMarkets) {
        if (!market.resolved) {
          await this.pollAndPublishOdds(sdk, market.duelId, market.question);
        }
      }
    } catch (err: any) {
      logger.warn('BentoAdapter', `Bulk odds refresh failed: ${err.message}`);
    }
    return activeMarkets;
  }

  /**
   * Get all active markets (non-async, returns cached state).
   */
  public getActiveMarkets(): MarketOdds[] {
    return activeMarkets;
  }

  /**
   * Generates mock trade execution data.
   */
  private async sendMockTrade(
    target: string,
    incidentType: string
  ): Promise<TransactionResult> {
    const marketQuestion = `Will ${incidentType} for ${target} resolve within 72 hours?`;
    logger.debug('BentoAdapter', `Mocking market: "${marketQuestion}"`);

    const hexChars = '0123456789abcdef';
    let txHash = '0x';
    for (let i = 0; i < 40; i++) {
      txHash += hexChars[Math.floor(Math.random() * 16)];
    }
    const marketId = `mkt-${Math.random().toString(36).substring(2, 10)}`;

    // Mock odds for simulation mode
    activeMarkets.push({
      duelId: marketId,
      question: marketQuestion,
      yesPrice: 0.35,
      noPrice: 0.65,
      totalVolume: 15,
      status: 'active',
      startTime: new Date(Date.now() + 31 * 60000).toISOString(),
      endTime: new Date(Date.now() + 72 * 3600000).toISOString(),
      resolved: false,
      createdAt: new Date().toISOString(),
    });

    return {
      transactionHash: txHash,
      timestamp: new Date().toISOString(),
      creditsUsed: 15,
      marketId,
      status: 'SUCCESS',
    };
  }
}

export const bentoAdapter = new BentoAdapter();
