# UPIN Phone Demo — Universal Positioning Intelligence Network

Mobile field test application for the UPIN multi-layer positioning system. Tests GPS resilience by simulating GPS jamming and spoofing attacks while measuring how well the system maintains position using sensor fusion, moving average baselines, and competing mathematical agents.

**Live demo:** `https://digitalloto.github.io/upin-phone-demo/index-v2.html`

**Related:** Main UPIN system at [digitalloto/upin](https://github.com/digitalloto/upin)

---

## What This Demo Proves

When GPS is denied (jammed or spoofed), the UPIN system can maintain an estimated position using:

1. **Phone sensors** — accelerometer, gyroscope, magnetometer, pedometer
2. **Moving average baselines** — SMA, EMA, VWMA of speed, heading, velocity learned while GPS was active
3. **5 competing math agents** — each using different algorithms to estimate position
4. **5 strategy layers** — different indicator combinations (like trading chart indicators)
5. **6 fish schools** — parameter grid search testing different formula configurations
6. **Continuous self-learning** — formulas tune themselves every 0.5 seconds against GPS

The longer the system runs with GPS active, the more accurate it becomes when GPS is denied.

---

## System Architecture

### Layer 1: Sensor Calibration (CAL)
Learns device-specific biases by recording sensor readings while the phone is still:
- **Accelerometer bias** — what the sensor reads when stationary (should be 0,0,9.8)
- **Gyro bias** — drift rate when not rotating (should be 0,0,0)
- **Compass offset** — difference between magnetometer heading and GPS-derived heading

All subsequent sensor readings are corrected by subtracting these biases.

### Layer 2: Moving Average Baseline (MA)
While GPS is active, records rolling windows of movement data:

| Indicator | Window | Description | Trading Equivalent |
|-----------|--------|-------------|--------------------|
| SMA Speed | 20 samples | Simple moving average of speed | SMA(20) |
| EMA Heading | alpha=0.15 | Exponentially weighted heading | EMA |
| VWMA Position | confidence-weighted | Position weighted by fusion confidence | VWAP |
| Velocity SMA | 20 samples | Average lat/lon velocity components | Momentum |
| Accel EMA | alpha=0.15 | Smoothed forward acceleration | Rate of Change |

When GPS is denied, these averages predict the next position based on established movement patterns.

### Layer 3: Math Agents (5 competing algorithms)

Each agent independently estimates position. After each GPS resurface, agents that were more accurate gain higher weight in the consensus.

| Agent | Algorithm | What It Tunes | Best For |
|-------|-----------|---------------|----------|
| **Kalman** | Linear state estimation (predict/update) | `maBlend`, `friction` | Straight-line movement |
| **Particle** | 30 weighted particles with resampling | `spread` (cloud tightness) | Non-linear paths, turns |
| **Bayesian** | Prior (MA prediction) x likelihood | `priorW` (MA trust level) | High uncertainty |
| **StepNav** | Pedometer + compass heading | `strideMult` (stride calibration) | Walking |
| **Momentum** | Physics-based velocity with decay | `maBlend`, `friction` | Vehicles |

**Consensus formula:**
```
position = weighted_average(all_agent_positions, weights_based_on_accuracy)
```

### Layer 4: Strategy Layers (5 indicator combinations)

Each strategy uses a different combination of MA indicators, like stacking technical analysis on a trading chart:

| Strategy | Indicators | Equivalent |
|----------|-----------|------------|
| **Trend** | SMA(5) speed + EMA(0.25) heading | Fast crossover |
| **Smooth** | SMA(30) speed + EMA(0.05) heading | Slow MA |
| **MACD** | VelEMA(0.2) - VelEMA(0.05) momentum | MACD signal line |
| **Bollinger** | SMA(20) position + mean reversion | Bollinger bands |
| **Adaptive** | Auto-tunes alpha and window from results | Self-optimizing |

### Layer 5: Fish Schooling (6 schools as parameter grid search)

Each school runs the **same formula** with **different parameter values**:

| School | SMA Window | EMA Alpha | Blend | Role |
|--------|-----------|-----------|-------|------|
| Alpha | 5 | 0.30 | 0.90 | Very fast/aggressive |
| Bravo | 10 | 0.20 | 0.85 | Fast |
| Charlie | 20 | 0.12 | 0.80 | Medium (default) |
| Delta | 30 | 0.06 | 0.75 | Slow |
| Echo | 40 | 0.03 | 0.70 | Very slow, max smoothing |
| Foxtrot | adaptive | adaptive | adaptive | Mutates toward the best school |

After each resurface, schools are scored against GPS truth. Foxtrot copies the winning school's parameters — natural selection finding the optimal configuration.

### Layer 6: Continuous Self-Learning (LEARN)

**Micro-learning (every 0.5s):**
- Each agent/strategy predicts 0.5s ahead
- Compares prediction to actual GPS
- Makes tiny parameter adjustments (0.1-0.5% change)
- After 2 minutes: 240 micro-tunes. After 10 minutes: 1200.

**Macro-learning (every 30s):**
- Each agent/strategy predicts 30s ahead
- Compares to actual GPS
- Makes larger parameter adjustments (1-3% change)

**Auto-save:** Profile auto-saves after each macro validation so training is never lost.

### Layer 7: Final Position Blend

When GPS is denied, the final estimated position combines all layers:

```
final_position = 40% * agent_consensus
               + 30% * strategy_consensus
               + 30% * MA_baseline_projection
```

---

## Continuous Learning Flow

```
GPS Active:
  Every 0.5s tick:
    1. Record GPS position, speed, heading to MA baseline
    2. All agents predict 0.5s ahead (without seeing GPS)
    3. Compare predictions to actual GPS
    4. Micro-tune each agent's parameters
    5. All strategies predict 0.5s ahead
    6. Compare, micro-tune strategy parameters
    7. Fish schools predict with their own params
    8. Compare, micro-tune school parameters
    9. Learn compass offset from GPS vs magnetometer heading
    
  Every 30s:
    1. All agents predict 30s ahead
    2. Compare to actual GPS
    3. Larger parameter adjustments (macro-tune)
    4. Auto-save profile to localStorage

GPS Denied (Jam/Spoof):
    1. System detects GPS loss or spoofed signal
    2. Discards GPS, switches to learned parameters
    3. Agents predict using MA baseline + calibrated sensors
    4. Strategies predict using indicator combinations
    5. Fish schools predict using their grid-search parameters
    6. Triple blend produces final position estimate
    7. Drift accumulates over time (m/s tracked per formula)

Resurface (GPS restored):
    1. Compare each agent's estimated position vs actual GPS
    2. Score accuracy, update weights
    3. Grade drill (A/B/C/D based on drift rate)
    4. Score fish schools, Foxtrot mutates toward winner
    5. Adaptive strategy tunes its own parameters
    6. Update agent weights based on cumulative accuracy
    7. Save drill results for report
```

---

## User Profiles

Profiles save all learned parameters to localStorage so the system remembers per user/device:

**What's saved:**
- Agent parameters (maBlend, friction, spread, priorW, strideMult, weights)
- Strategy parameters (smaW, emaA, weights)
- Fish school parameters (smaW, emaA, blend, scores)
- Sensor calibration (accel bias, gyro bias, compass offset)
- Training stats (micro-tune count, macro-tune count)

**Usage:**
1. Type a profile name and tap Save
2. Next session: select profile from dropdown and tap Load
3. System starts with pre-tuned formulas immediately
4. Auto-saves during use

---

## Files

| File | Description |
|------|-------------|
| `index.html` | v1 — Simple demo with basic jam/spoof/resurface |
| `index-v2.html` | v2 — Full multi-agent system with learning |
| `docs/ARCHITECTURE.md` | System architecture and design decisions |
| `docs/CHANGELOG.md` | Version history and changes |
| `dashboard.html` | Development dashboard tracking work and updates |

---

## How to Use

1. Open `index-v2.html` on your phone (via GitHub Pages)
2. Tap **Calibrate** — hold phone still for 5 seconds
3. Tap **Start Drive** — drive/walk around for 2+ minutes
4. Watch the log: "Learn #1: best=Bayesian 4.2m" — formulas are training
5. When ready, tap **Jam GPS** or **Spoof GPS**
6. Walk/drive while jammed — watch the orange dead-reckoned trail vs green GPS truth
7. Tap **Resurface** — see the drift error and which agent was best
8. Repeat steps 5-7 for more drills — system gets better each time
9. Tap **End Test** — see full report with per-drill breakdown
10. **Save your profile** so next session starts pre-tuned

---

## Integration with Main UPIN System

This phone demo validates the concepts from the main [UPIN](https://github.com/digitalloto/upin) Python system:

| Main UPIN Module | Phone Demo Equivalent |
|-------------------|----------------------|
| `upin/fusion/` FusionEngine | Agent consensus + strategy blend |
| `upin/sensors/` | Phone accelerometer, gyro, magnetometer |
| `upin/calibration/` | CAL sensor calibration system |
| `upin/detection/` | GPS spoof/jam detection |
| `upin/swarm_fusion/` | Fish schooling with parameter grid search |
| `upin/agents/` | 5 math agents (Kalman, Particle, Bayesian, StepNav, Momentum) |
| `upin/intelligence/` | Continuous learning system (LEARN) |
| `upin/layers/` | 60-layer positioning → MA baseline indicators |

The phone demo proves these concepts work in a real mobile environment with real sensor data.
