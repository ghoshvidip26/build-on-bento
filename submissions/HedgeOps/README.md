# Project name

> Copy this folder to `submissions/YourTeamName/` and fill every section below.

## Project

| Field | Your answer |
|-------|-------------|
| **Project name** | HedgeOps|
| **Tagline** | We are financializing technical debt.|
| **Team name** | HedgeOps|
| **Team members** | Mantej Singh, Vidip Ghosh|
| **Contact email** |singhmantej536@gmail.com, ghoshvidip26@gmail.com|
| **Track** (if applicable) | |

### Links

| | URL |
|---|-----|
| **Live demo** | https://hedgeops.vercel.app/|
| **Demo video** (≤2 min) or slide deck |https://docs.google.com/presentation/d/1i5XoDpsmzeVpYjLMe44AqjI0zIetbrSf-ToW1YmxxiU/edit?usp=sharing |
| **Pitch deck** (optional) | |

---

## What you built

Describe the product in 3-6 sentences: who it is for, what problem it solves, and how it uses Bento.

HedgeOps is an autonomous infrastructure hedging protocol built specifically for DevOps teams and Site Reliability Engineers (SREs). It solves the massive financial bleed caused by critical cloud outages and unpatched vulnerabilities, where enterprise SLA breaches can cost thousands of dollars per minute without any downside protection. Our AI-driven risk engine continuously monitors system fragility and developer sentiment to predict catastrophic failures in real-time. When a critical threshold is crossed, HedgeOps leverages the Bento SDK's core lifecycle modules—specifically BentoSDK.markets.create and BentoSDK.trades.place—to programmatically instantiate on-chain prediction markets. By automatically executing high-conviction short positions against the incident's recovery timeline, HedgeOps transforms Bento into an enterprise-grade technical insurance policy.

### Screenshots

Add 2-4 screenshots or GIFs under `./assets/` and embed them here.

```
<!-- ![Home](./assets/home.png) -->
```
![Demo1](./assets/Demo1.png)
![Demo2](./assets/Demo2.png)
![Demo3](./assets/Demo3.png)

---

## Bento integration

For each surface: put **Yes** or **No**. If Yes, briefly describe how (SDK methods, feature, etc.).

| Surface | Yes / No | Describe (if Yes) |
|---------|----------|-------------------|
| Markets / duels (browse, bet, create) | Yes | `sdk.user.createDuel()` to create prediction markets, `sdk.user.bets.estimateBuy()` for price quotes, `sdk.user.placeBetFromEstimate()` to place bets on YES/NO outcomes, `sdk.public.getDuelById()` to poll live odds, and direct `POST /bento/user/duels/resolve` to settle markets with a winning option. |
| Multi-outcome / parent markets | No | |
| Parlays | No | |
| Tournaments / F1 / fantasy | No | |
| Packs | No | |
| Polymarket bridge | No | |
| Agents | Yes | HedgeOps itself is an autonomous AI agent — it uses GPT-5.5 to analyze repository telemetry, compute fragility risk scores, and autonomously create/bet/resolve prediction markets on Bento without human intervention. |
| Realtime / social | No | |
| Others | Yes | `sdk.public.auth.eoaLogin()` / `eoaRegister()` for EOA wallet authentication with `jwtAuthProvider`, and `POST /bento/auto-mint/mint` faucet endpoint to mint testnet credits before trading. |


**Builder API key:** minted from [docs.bento.fun - Builder API key](https://docs.bento.fun/concepts/builder-api-key) (testnet). Do **not** commit keys.

---

## How to run

```bash
# from this folder, or link to your external repo
cp .env.example .env   # fill env vars
npm install            # or pnpm / yarn
npm run dev
```

| Env var | Required | Description |
|---------|----------|-------------|
| `BENTO_BUILDER_API_KEY` | yes | Testnet builder key |
| `BENTO_URL` | yes | Markets host (`https://internal-server.bento.fun`) |
| `PARLAY_TOURNMENT_URL` | if needed | `https://bento-fun-tournaments-backend-3nku.onrender.com` |

---

## Architecture (short)

- **Stack:**
- **Repo layout:**
- **Auth:**
- **What's on-chain vs off-chain:**

Optional: drop a simple diagram in `./assets/architecture.png`.
