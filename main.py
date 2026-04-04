import serial
import math
import asyncio
import json
import random
import argparse
from collections import deque
from datetime import datetime
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

# ─────────────────────────────────────────────
# CONFIG — change these to match your Arduino
# ─────────────────────────────────────────────
SERIAL_PORT  = "COM3"     # Windows: COM3, COM4 | Mac/Linux: /dev/ttyUSB0
BAUD_RATE    = 115200
WINDOW_SIZE  = 5          # rolling average window
VREF         = 5.0        # ADC reference voltage
SIMULATE     = False       # Set to False when real Arduino is connected

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# MATH HELPERS (from your analytics script)
# ─────────────────────────────────────────────
def safe_float(value):
    if value is None:
        return float("nan")
    value = str(value).strip().lower()
    if value == "nan":
        return float("nan")
    return float(value)

def mean_ignore_nan(values):
    valid = [v for v in values if not math.isnan(v)]
    return sum(valid) / len(valid) if valid else float("nan")

def std_ignore_nan(values):
    valid = [v for v in values if not math.isnan(v)]
    n = len(valid)
    if n < 2:
        return float("nan")
    mu = sum(valid) / n
    return math.sqrt(sum((x - mu) ** 2 for x in valid) / n)

def rate_of_change(current, previous, dt):
    if dt <= 0 or math.isnan(current) or math.isnan(previous):
        return float("nan")
    return (current - previous) / dt

def c_to_f(temp_c):
    return float("nan") if math.isnan(temp_c) else temp_c * 9.0 / 5.0 + 32.0

def dew_point_c(temp_c, humidity_pct):
    if math.isnan(temp_c) or math.isnan(humidity_pct) or humidity_pct <= 0 or humidity_pct > 100:
        return float("nan")
    a, b = 17.62, 243.12
    gamma = math.log(humidity_pct / 100.0) + (a * temp_c) / (b + temp_c)
    return (b * gamma) / (a - gamma)

def saturation_vapor_pressure_hpa(temp_c):
    if math.isnan(temp_c):
        return float("nan")
    return 6.112 * math.exp((17.67 * temp_c) / (temp_c + 243.5))

def actual_vapor_pressure_hpa(temp_c, humidity_pct):
    if math.isnan(temp_c) or math.isnan(humidity_pct):
        return float("nan")
    return (humidity_pct / 100.0) * saturation_vapor_pressure_hpa(temp_c)

def absolute_humidity_gm3(temp_c, humidity_pct):
    if math.isnan(temp_c) or math.isnan(humidity_pct):
        return float("nan")
    return (
        6.112 * math.exp((17.67 * temp_c) / (temp_c + 243.5))
        * humidity_pct * 2.1674 / (273.15 + temp_c)
    )

def humidity_ratio(temp_c, humidity_pct, pressure_hpa=1013.25):
    e = actual_vapor_pressure_hpa(temp_c, humidity_pct)
    if math.isnan(e) or e >= pressure_hpa:
        return float("nan")
    return 0.62198 * e / (pressure_hpa - e)

def heat_index_c(temp_c, humidity_pct):
    if math.isnan(temp_c) or math.isnan(humidity_pct):
        return float("nan")
    t = c_to_f(temp_c)
    h = humidity_pct
    hi_f = (
        -42.379 + 2.04901523 * t + 10.14333127 * h
        - 0.22475541 * t * h - 0.00683783 * t * t
        - 0.05481717 * h * h + 0.00122874 * t * t * h
        + 0.00085282 * t * h * h - 0.00000199 * t * t * h * h
    )
    return (hi_f - 32.0) * 5.0 / 9.0

def adc_to_voltage(adc_value, vref=5.0):
    return float("nan") if math.isnan(adc_value) else adc_value * vref / 1023.0

def brightness_percent(light_raw):
    return float("nan") if math.isnan(light_raw) else light_raw * 100.0 / 1023.0

def minmax_norm(value, min_val, max_val):
    if math.isnan(value) or max_val <= min_val:
        return float("nan")
    return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))

def comfort_score(temp_c, humidity_pct, dew_c):
    if math.isnan(temp_c) or math.isnan(humidity_pct) or math.isnan(dew_c):
        return float("nan")
    score = (
        100.0
        - 4.0 * abs(temp_c - 22.0)
        - 0.5 * abs(humidity_pct - 45.0)
        - 2.0 * max(0.0, dew_c - 14.0)
    )
    return max(0.0, min(100.0, score))

def classify_brightness(bright_pct):
    if math.isnan(bright_pct): return "invalid"
    if bright_pct < 15:  return "dark"
    if bright_pct < 35:  return "dim"
    if bright_pct < 65:  return "moderate"
    if bright_pct < 85:  return "bright"
    return "very bright"

def classify_noise(noise_p2p):
    if math.isnan(noise_p2p): return "invalid"
    if noise_p2p < 8:   return "quiet"
    if noise_p2p < 25:  return "moderate"
    if noise_p2p < 60:  return "active"
    return "loud"

def fmt(value, digits=2):
    if value is None or math.isnan(value):
        return None
    return round(value, digits)

def parse_line(line):
    parts = [p.strip() for p in line.split(",")]
    if len(parts) != 9:
        return None
    try:
        return {
            "ms":           int(parts[0]),
            "light_raw":    float(parts[1]),
            "noise_avg":    float(parts[2]),
            "noise_p2p":    float(parts[3]),
            "temp_c":       safe_float(parts[4]),
            "humidity_pct": safe_float(parts[5]),
            "light_err":    int(parts[6]),
            "mic_err":      int(parts[7]),
            "dht_err":      int(parts[8]),
        }
    except ValueError:
        return None

# ─────────────────────────────────────────────
# ROLLING STATE
# ─────────────────────────────────────────────
light_hist = deque(maxlen=WINDOW_SIZE)
noise_hist = deque(maxlen=WINDOW_SIZE)
temp_hist  = deque(maxlen=WINDOW_SIZE)
rh_hist    = deque(maxlen=WINDOW_SIZE)

first_ms       = None
prev_time_s    = None
prev_temp_s    = float("nan")
prev_rh_s      = float("nan")
prev_light_s   = float("nan")
prev_noise_s   = float("nan")
noise_baseline = None

def compute_analytics(row):
    global first_ms, prev_time_s, prev_temp_s, prev_rh_s
    global prev_light_s, prev_noise_s, noise_baseline

    if first_ms is None:
        first_ms = row["ms"]
    time_s = (row["ms"] - first_ms) / 1000.0

    # Use NaN if sensor reported an error
    light_val = row["light_raw"]    if row["light_err"] == 0 else float("nan")
    noise_val = row["noise_p2p"]    if row["mic_err"]   == 0 else float("nan")
    temp_val  = row["temp_c"]       if row["dht_err"]   == 0 else float("nan")
    rh_val    = row["humidity_pct"] if row["dht_err"]   == 0 else float("nan")

    light_hist.append(light_val)
    noise_hist.append(noise_val)
    temp_hist.append(temp_val)
    rh_hist.append(rh_val)

    light_s = mean_ignore_nan(light_hist)
    noise_s = mean_ignore_nan(noise_hist)
    temp_s  = mean_ignore_nan(temp_hist)
    rh_s    = mean_ignore_nan(rh_hist)

    light_std = std_ignore_nan(light_hist)
    noise_std = std_ignore_nan(noise_hist)
    temp_std  = std_ignore_nan(temp_hist)
    rh_std    = std_ignore_nan(rh_hist)

    dt = (time_s - prev_time_s) if prev_time_s is not None else float("nan")
    dlight_dt  = rate_of_change(light_s, prev_light_s, dt) if not math.isnan(dt) else float("nan")
    dnoise_dt  = rate_of_change(noise_s, prev_noise_s, dt) if not math.isnan(dt) else float("nan")
    dtemp_dt   = rate_of_change(temp_s,  prev_temp_s,  dt) if not math.isnan(dt) else float("nan")
    drh_dt     = rate_of_change(rh_s,    prev_rh_s,    dt) if not math.isnan(dt) else float("nan")

    temp_f      = c_to_f(temp_s)
    dew_c       = dew_point_c(temp_s, rh_s)
    dew_f       = c_to_f(dew_c)
    sat_vp      = saturation_vapor_pressure_hpa(temp_s)
    act_vp      = actual_vapor_pressure_hpa(temp_s, rh_s)
    abs_h       = absolute_humidity_gm3(temp_s, rh_s)
    hum_ratio   = humidity_ratio(temp_s, rh_s)
    hi_c        = heat_index_c(temp_s, rh_s)
    hi_f        = c_to_f(hi_c)
    light_v     = adc_to_voltage(light_s, VREF)
    bright_pct  = brightness_percent(light_s)
    bright_lbl  = classify_brightness(bright_pct)
    noise_lbl   = classify_noise(noise_s)

    

    if noise_baseline is None and not math.isnan(noise_s) and noise_s > 0:
        noise_baseline = noise_s
    if noise_baseline and not math.isnan(noise_s) and noise_s > 0:
        noise_rel_db = 20.0 * math.log10(noise_s / noise_baseline)
    else:
        noise_rel_db = float("nan")

    light_norm = minmax_norm(bright_pct, 0.0, 100.0)
    noise_norm = minmax_norm(noise_s, 0.0, 100.0)
    ln = 0.0 if math.isnan(light_norm) else light_norm
    nn = 0.0 if math.isnan(noise_norm) else noise_norm
    occupancy = 0.4 * ln + 0.6 * nn
    comfort   = comfort_score(temp_s, rh_s, dew_c)

    # Update rolling state
    prev_time_s  = time_s
    prev_temp_s  = temp_s
    prev_rh_s    = rh_s
    prev_light_s = light_s
    prev_noise_s = noise_s

    return {
        "pc_time":          datetime.now().isoformat(timespec="seconds"),
        "time_s":           fmt(time_s, 1),
        # Raw
        "temp_c":           fmt(temp_s),
        "temp_f":           fmt(temp_f),
        "humidity_pct":     fmt(rh_s),
        "light_raw":        fmt(light_s, 0),
        "noise_p2p":        fmt(noise_s, 1),
        "noise_avg":        fmt(row["noise_avg"], 1),
        # Derived temperature
        "dew_point_c":      fmt(dew_c),
        "dew_point_f":      fmt(dew_f),
        "heat_index_c":     fmt(hi_c),
        "heat_index_f":     fmt(hi_f),
        # Derived humidity
        "abs_humidity_gm3": fmt(abs_h),
        "humidity_ratio":   fmt(hum_ratio, 4),
        "sat_vp_hpa":       fmt(sat_vp),
        "act_vp_hpa":       fmt(act_vp),
        # Light
        "brightness_pct":   fmt(bright_pct, 1),
        "brightness_label": bright_lbl,
        "light_voltage":    fmt(light_v),
        # Noise
        "noise_label":      noise_lbl,
        "noise_rel_db":     fmt(noise_rel_db, 1),
        # Rolling stats
        "temp_std":         fmt(temp_std),
        "rh_std":           fmt(rh_std),
        "light_std":        fmt(light_std),
        "noise_std":        fmt(noise_std),
        # Rates of change
        "dtemp_dt":         fmt(dtemp_dt, 3),
        "drh_dt":           fmt(drh_dt, 3),
        "dlight_dt":        fmt(dlight_dt, 3),
        "dnoise_dt":        fmt(dnoise_dt, 3),
        # Scores
        "comfort_score":    fmt(comfort, 1),
        "occupancy_score":  fmt(occupancy, 2),
        # Errors
        "light_err":        row["light_err"],
        "mic_err":          row["mic_err"],
        "dht_err":          row["dht_err"],
    }

# ─────────────────────────────────────────────
# SIMULATOR — generates realistic fake Arduino CSV rows
# ─────────────────────────────────────────────
_sim_ms    = 0
_sim_temp  = 23.0
_sim_rh    = 48.0
_sim_light = 400.0
_sim_noise = 15.0

def simulate_row():
    global _sim_ms, _sim_temp, _sim_rh, _sim_light, _sim_noise
    _sim_ms    += 1000
    _sim_temp  = max(15.0, min(40.0, _sim_temp  + random.uniform(-0.3, 0.3)))
    _sim_rh    = max(20.0, min(90.0, _sim_rh    + random.uniform(-0.5, 0.5)))
    _sim_light = max(0.0,  min(1023.0, _sim_light + random.uniform(-20, 20)))
    _sim_noise = max(2.0,  min(100.0, _sim_noise + random.uniform(-3, 3)))
    # Occasional noise spike
    if random.random() < 0.07:
        _sim_noise = random.uniform(60, 90)
    return {
        "ms":           _sim_ms,
        "light_raw":    round(_sim_light, 1),
        "noise_avg":    round(_sim_noise * 0.6, 1),
        "noise_p2p":    round(_sim_noise, 1),
        "temp_c":       round(_sim_temp, 2),
        "humidity_pct": round(_sim_rh, 2),
        "light_err": 0, "mic_err": 0, "dht_err": 0,
    }

# ─────────────────────────────────────────────
# WEBSOCKET ENDPOINT
# ─────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Frontend connected!")

    if SIMULATE:
        print("Running in SIMULATION mode.")
        try:
            while True:
                row  = simulate_row()
                data = compute_analytics(row)
                await websocket.send_text(json.dumps(data))
                print(f"[SIM] T={data['temp_c']}C RH={data['humidity_pct']}% "
                      f"light={data['brightness_pct']}% noise={data['noise_label']} "
                      f"comfort={data['comfort_score']}")
                await asyncio.sleep(1)
        except Exception as e:
            print(f"WebSocket closed: {e}")
    else:
        print(f"Connecting to Arduino on {SERIAL_PORT} at {BAUD_RATE} baud...")
        try:
            ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
            while True:
                raw_line = ser.readline().decode("utf-8", errors="replace").strip()
                if not raw_line or raw_line.startswith("ms,"):
                    continue
                row = parse_line(raw_line)
                if row is None:
                    print(f"Skipping malformed: {raw_line}")
                    continue
                data = compute_analytics(row)
                await websocket.send_text(json.dumps(data))
                await asyncio.sleep(0)
        except serial.SerialException as e:
            print(f"Serial error: {e}")
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception as e:
            print(f"WebSocket closed: {e}")
        finally:
            if 'ser' in locals() and ser.is_open:
                ser.close()