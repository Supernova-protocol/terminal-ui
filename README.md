[Uploading terminal_ui_readme.md…]()
# terminal-ui# Supernova Terminal UI 🌌

**The Institutional-Grade Frontend for Supernova V2**

This repository contains the interface architecture for the Supernova V2 launchpad and trading terminal. Built for absolute speed, seamless UX, and real-time data streaming, the terminal is designed to handle high-frequency retail flow alongside institutional sizing.

## 🖥️ Tech Stack Topology

We engineered the frontend to be extremely lightweight and brutally fast, stripping away heavy framework bloat where possible.

* **Core:** Vanilla ES6 JavaScript, HTML5
* **Styling:** Tailwind CSS (configured for ultra-dark mode and custom neon UI elements)
* **Data Visualization:** TradingView Lightweight Charts (v5) for high-fidelity 1-second candlesticks, Chart.js for PnL tracking.
* **AI Integration:** Direct prompt-injection pipelines for the Supernova AI Analyst and Gemini Token Builder.
* **Animations:** Hardware-accelerated CSS keyframes and Vanilla JS intersection observers for fluid scrollytelling.

## 📂 File Structure

* `index.html`: The main Single Page Application (SPA). Contains the Start Hub, Pro Terminal, Profile HUD, and Token Deployer.
* `launchpad-flow.html`: The interactive scrollytelling component explaining the Supernova War Chest and Fee splits.
* `teaser.html`: The cinematic CSS-animated pre-launch teaser sequence.

## 🚧 Status: UI Pre-Release

**Notice:** The UI components in this repository are currently hardcoded with simulated WebSocket feeds and mock heuristics for zero-knowledge frontend testing. 

Live API endpoints (RPC integration, Jito bundle submission, and real-time DexScreener parsing) will be un-stubbed and activated synchronously with our Mainnet-Beta smart contract deployment.

*Abstracting Complexity. Engineering Liquidity.*
