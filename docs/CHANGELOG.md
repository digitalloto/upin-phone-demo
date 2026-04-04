# UPIN Phone Demo — Changelog

## v2.5 — Continuous Self-Learning + User Profiles (2026-04-04)

### Added
- **Continuous micro-learning**: every 0.5s tick, all agents/strategies predict ahead and auto-tune parameters against GPS truth
- **Macro-learning**: every 30s, larger parameter adjustments with 30s-ahead predictions
- **User profiles**: save/load all learned parameters to localStorage per user
- **Profile auto-save**: auto-saves after each macro validation so training is never lost
- **microTune()** method on all agents: Kalman (maBlend/friction), Particle (spread), Bayesian (priorW), StepNav (strideMult), Momentum (maBlend/friction)
- **microTune()** on all strategies: smaW and emaA per-tick adjustments
- **Fish school micro-tuning**: schools tune their own parameters every tick
- **Profile UI**: name input, save/load buttons, profile selector dropdown

### Changed
- Formulas never stop learning — even during normal driving, every GPS reading is a training opportunity
- Profile selector shows tune count per profile
- Boot sequence loads profile list from localStorage

---

## v2.4 — Online Learning: Background Validation + Sensor Calibration + Fish Grid Search (2026-04-04)

### Added
- **Background validation (VALIDATOR)**: while GPS active, agents predict 30s ahead without GPS, then compare to actual position and auto-tune
- **Sensor calibration (CAL)**: learns device-specific accelerometer bias, gyroscope drift, and compass offset during calibrate phase
- **Compass offset learning**: during driving, learns difference between magnetometer and GPS-derived heading
- **CAL.correct()**: all agents now use calibrated sensor data instead of raw readings
- **Fish school grid search**: each of 6 schools runs same formula with different parameters (smaW: 5-40, emaA: 0.03-0.30)
- **Foxtrot mutation**: Foxtrot school copies parameters from the best-performing school after each resurface
- **tuneFromError()** on all agents: Kalman adjusts maBlend/friction, Particle adjusts spread, Bayesian adjusts priorW, StepNav adjusts strideMult, Momentum adjusts maBlend/friction
- **tuneFromError()** on all strategies: adjusts smaW and emaA based on validation error

### Changed
- Agents use calibrated sensors via `CAL.correct()` instead of raw accel/gyro
- StepNav falls back to MA velocity when no steps detected
- Calibrate button now records 50 sensor samples over 5 seconds for bias calculation
- Report includes validation results, calibration values, and school parameters

---

## v2.3 — Strategy Layers + Drift Curves (2026-04-04)

### Added
- **5 strategy layers**: Trend (fast SMA/EMA), Smooth (slow SMA/EMA), MACD (velocity momentum), Bollinger (mean reversion), Adaptive (self-tuning)
- **Drift curve tracking**: each strategy records drift-over-time during blind periods
- **Strategy consensus**: weighted average of all strategy positions
- **Triple blend**: final position = 40% agents + 30% strategies + 30% MA prediction
- **Strategy cards in UI**: shows each strategy's weight and drift rate
- **Report includes strategy performance**: drift rates, weights, Adaptive tuned params
- **CSV export includes strategy data**

---

## v2.2 — Moving Average Baseline (2026-04-04)

### Added
- **Moving Average Baseline (MA)**: records rolling windows of speed, heading, velocity, acceleration while GPS active
- **SMA Speed**: 20-point simple moving average
- **EMA Heading**: exponentially weighted heading (alpha 0.15)
- **VWMA Position**: confidence-weighted position average
- **Velocity SMA**: lat/lon velocity components
- **Accel EMA**: smoothed forward acceleration
- **MA prediction**: when GPS denied, MA.predict() projects position using learned averages
- **MA indicator cards in UI**: shows all 6 baseline indicators
- **Agents use MA baseline**: Kalman uses MA velocity, Particle guided by MA.predict(), Bayesian uses MA as prior, StepNav uses EMA heading, Momentum uses MA velocity

### Fixed
- **Freeze fix**: trail arrays capped at 300 points
- **Particle count reduced**: 80 → 30 particles
- **UI throttled**: DOM updates every 4th tick (2s intervals)
- **Arrays capped**: fusionErrors/Confs at 500, log at 50 entries

---

## v2.1 — Multi-Agent Positioning (2026-04-04)

### Added
- **5 math agents**: Kalman, Particle, Bayesian, StepNav, Momentum
- **6 fish schools**: Alpha-Foxtrot with different lead agents
- **Agent consensus**: weighted average of all agent positions
- **Agent weight updates**: after resurface, accurate agents gain weight
- **Step detection**: from accelerometer peaks (threshold-based pedometer)
- **Configurable drill timing**: manual or auto-cycle (10s/20s/30s)
- **Accuracy grading**: A/B/C/D per drill based on drift rate (m/s)
- **Replay**: animated playback of GPS truth vs dead-reckoned path
- **Agent cards in UI**: shows each agent's weight, confidence, last error
- **Fish school cards**: shows scores and leader assignments
- **Full report**: per-drill agent breakdown, fish scores, learned weights
- **CSV export**: drill + agent + school data

---

## v2.0 — Field Test UI Overhaul (2026-04-04)

### Changed
- Complete UI rebuild matching field test app style
- **Header with status badge**: IDLE / DRIVING / JAMMED / SPOOFED
- **Map loading fix**: invalidateSize() called after init
- **3x2 metric cards**: fusion error, confidence, speed, distance, drift rate, elapsed
- **Positioning layers grid**: GPS, IMU, Compass, Step DR, Heading, Fish AI with status dots
- **Contextual buttons**: phase-appropriate (Calibrate → Jam/Spoof → Resurface)
- **Manual jam/spoof**: tap to start, tap Resurface to stop (no auto-cycling)
- **Event log**: timestamped entries
- **Full test report**: test summary, normal driving stats, per-drill breakdown

---

## v1.0 — GPS Deny/Resurface Demo (2026-04-04)

### Added
- Initial phone demo with GPS positioning
- GPS jamming simulation with dead reckoning
- GPS spoofing simulation with fake signal rejection
- Resurface to compare dead-reckoned vs actual GPS position
- Dual trails on map: green (GPS truth) vs orange (dead reckoned)
- Interval jam mode (auto-cycle)
- Purple resurface markers with drift measurement
- Drift comparison card

---

## v0.1 — Initial Demo (2026-04-04)

### Added
- Single HTML file with Leaflet/OpenStreetMap
- Basic map display with GPS position
- Kalman/Particle/Fish-schooling fusion (simulated)
- GPS spoof/jam buttons
- Mahalanobis-based threat detection
- Mobile-responsive layout
