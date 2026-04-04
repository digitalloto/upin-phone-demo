# UPIN Phone Demo — System Architecture

## Overview

The UPIN Phone Demo is a single-file HTML/CSS/JavaScript application that runs entirely in the browser. It requires no server, no build tools, and no API keys. It uses real phone sensors (GPS, accelerometer, gyroscope, magnetometer) to demonstrate GPS-denied navigation.

## Design Principles

1. **Zero dependencies except Leaflet** — OpenStreetMap tiles, no Google Maps API needed
2. **Single HTML file** — no build step, works offline after first load
3. **Mobile-first** — designed for phone screens, touch-friendly buttons
4. **Progressive learning** — system improves with use, saves progress

## Data Flow

```
Phone Sensors
    │
    ├── GPS (navigator.geolocation)
    │     └── Position, accuracy, timestamp
    │
    ├── Accelerometer (DeviceMotionEvent)
    │     └── x, y, z acceleration
    │
    ├── Gyroscope (DeviceMotionEvent.rotationRate)
    │     └── alpha, beta, gamma rotation
    │
    └── Magnetometer (DeviceOrientationEvent)
          └── alpha (compass heading), beta, gamma
    │
    ▼
Sensor Calibration (CAL)
    │  Removes device-specific bias
    │  Learns compass offset from GPS heading
    │
    ▼
Moving Average Baseline (MA)
    │  Records rolling windows:
    │  - SMA speed (20-sample window)
    │  - EMA heading (alpha 0.15)
    │  - Velocity SMA (lat/lon components)
    │  - Accel EMA (forward acceleration)
    │  - VWMA position (confidence-weighted)
    │
    ▼
┌─────────────────────────────────────────┐
│         Parallel Processing             │
│                                         │
│  5 Math Agents    5 Strategies          │
│  ├── Kalman       ├── Trend             │
│  ├── Particle     ├── Smooth            │
│  ├── Bayesian     ├── MACD              │
│  ├── StepNav      ├── Bollinger         │
│  └── Momentum     └── Adaptive          │
│                                         │
│  6 Fish Schools (parameter grid search) │
│  ├── Alpha  (sma:5,  ema:0.30)          │
│  ├── Bravo  (sma:10, ema:0.20)          │
│  ├── Charlie(sma:20, ema:0.12)          │
│  ├── Delta  (sma:30, ema:0.06)          │
│  ├── Echo   (sma:40, ema:0.03)          │
│  └── Foxtrot(adaptive — mutates)        │
│                                         │
└─────────────────────────────────────────┘
    │
    ▼
Continuous Learning (LEARN)
    │  Micro-tune: every 0.5s tick
    │  Macro-tune: every 30s
    │  Auto-saves to profile
    │
    ▼
Final Position Blend
    │  40% agent consensus
    │  30% strategy consensus
    │  30% MA baseline projection
    │
    ▼
Map Display + Drift Tracking
```

## State Machine

```
    ┌─────┐
    │IDLE │ ──── Calibrate ──── Start Drive
    └─────┘
       │
       ▼
    ┌───────┐
    │DRIVING│ ◄──── Resurface
    └───────┘
       │    │
       │    └── End Test ──── REPORT
       ▼
    ┌───────────────┐
    │ JAMMED/SPOOFED│
    └───────────────┘
       │
       └── Resurface → Score agents → Update weights → DRIVING
```

## Performance Optimizations

| Problem | Solution |
|---------|----------|
| Trail arrays growing forever | Capped at 300 points (MAX_TRAIL) |
| DOM updates causing jank | Throttled to every 4th tick (2s intervals) |
| Particle filter too heavy | Reduced from 80 to 30 particles |
| Log entries accumulating | Capped at 50 entries |
| fusionErrors array growing | Capped at 500 entries |

## Sensor Fallback Strategy

```
Real GPS available?
  YES → Use navigator.geolocation.watchPosition()
  NO  → Simulate walking path (linear + noise)

Real IMU available?
  YES → Use DeviceMotionEvent (with iOS permission request)
  NO  → Simulate sensor noise at 200ms intervals

Real compass available?
  YES → Use DeviceOrientationEvent (with iOS permission request)
  NO  → Simulate heading with random walk
```

## Key Algorithms

### Kalman Filter Agent
```
Predict:
  velocity = MA_velocity * maBlend + current_velocity * (1 - maBlend)
  position += velocity * dt
  velocity *= friction  (decay)
  P += Q * dt  (uncertainty grows)

Update (on GPS):
  K = P / (P + R)  (Kalman gain)
  position += K * (GPS - position)
  P = (1 - K) * P  (uncertainty shrinks)
```

### MACD Strategy
```
fastEMA = EMA(velocity, alpha=0.2)
slowEMA = EMA(velocity, alpha=0.05)
MACD = fastEMA - slowEMA  (momentum signal)
predicted_position = position + (fastEMA + MACD * 0.5) * dt
```

### Fish School Grid Search
```
Each school runs:
  sma_speed = SMA(speeds, window=school.smaW)
  ema_heading = EMA(headings, alpha=school.emaA)
  heading_component = speed * cos/sin(heading) * dt
  velocity_component = MA_velocity * dt
  position += heading * blend + velocity * (1-blend)

After resurface:
  Score each school against GPS truth
  Foxtrot.params = lerp(Foxtrot.params, best_school.params, 0.3)
```

### Micro-Tuning Logic
```
Every 0.5s:
  prediction = agent.predict(0.5s ahead)
  actual = GPS position
  error = haversine(prediction, actual)
  
  if error > threshold_high:
    increase MA trust (maBlend += 0.002)
    increase smoothing (friction += 0.0005)
  elif error < threshold_low:
    decrease MA trust (allow more responsiveness)
    decrease smoothing (allow faster changes)
```

## localStorage Schema

```json
{
  "upin_profiles": {
    "username": {
      "savedAt": 1712345678000,
      "agents": [
        {"name": "Kalman", "weight": 0.25, "maBlend": 0.92, "friction": 0.985, ...},
        ...
      ],
      "strategies": [
        {"name": "Trend", "weight": 0.22, "params": {"smaW": 7, "emaA": 0.23}, ...},
        ...
      ],
      "schools": [
        {"name": "Alpha", "score": 78, "params": {"smaW": 5, "emaA": 0.28, "blend": 0.88}, ...},
        ...
      ],
      "cal": {
        "accelBias": {"x": 0.012, "y": -0.008, "z": 0.034},
        "gyroBias": {"x": 0.15, "y": -0.22, "z": 0.08},
        "compassOffset": -3.2,
        "sampleCount": 45
      },
      "microTunes": 2400,
      "macroTunes": 8
    }
  }
}
```
