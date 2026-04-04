import serial
import math
import asyncio
import json
import random
from collections import deque
from datetime import datetime
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

# ============================================================
# CONFIG — adjust for your Arduino / environment
# ============================================================
SERIAL_PORT = "COM3"
BAUD_RATE = 115200
WINDOW_SIZE = 5
VREF = 5.0
SIMULATE = False

# Relative sensor calibration windows (NOT lux / NOT dBA)
# Tune these from your own room after observing real values.
LIGHT_MIN_RAW = 650.0      # typical darkest observed value in your room
LIGHT_MAX_RAW = 1023.0     # typical brightest observed value in your room
NOISE_MIN_P2P = 5.0        # quiet baseline-ish mic p2p
NOISE_MAX_P2P = 80.0       # loud but common upper bound in your room

# ============================================================
# SCIENCE-BASED / DEFENSIBLE TARGETS
# ------------------------------------------------------------
# Temperature:
#   OSHA workstation / indoor comfort guidance commonly points to
#   about 68–76 F (20.0–24.4 C) as a broadly comfortable range.
# Humidity:
#   EPA guidance commonly recommends 30–50% RH ideally,
#   with <60% preferred to reduce moisture-related issues.
# Dew point:
#   Weather-service dew point comfort guidance: <=55 F (~12.8 C)
#   feels dry/comfortable; 55–65 F becomes sticky/muggy.
# ------------------------------------------------------------
TEMP_IDEAL_MIN_C = 20.0
TEMP_IDEAL_MAX_C = 24.4
TEMP_MIN_C = 16.0
TEMP_MAX_C = 28.0

RH_IDEAL_MIN = 30.0
RH_IDEAL_MAX = 50.0
RH_MIN = 20.0
RH_MAX = 60.0

DEW_COMFY_C = 12.8
DEW_MUGGY_START_C = 16.0
DEW_STICKY_C = 18.3
DEW_OPPRESSIVE_C = 21.0

# Weights for overall room score.
# Heavy emphasis on physically meaningful thermal/moisture comfort.
ROOM_SCORE_WEIGHTS = {
    "temp": 0.35,
    "rh": 0.20,
    "dew": 0.15,
    "stability": 0.10,
    "noise": 0.10,
    "light": 0.10,
}

# Purpose-specific weights
RELAX_WEIGHTS = {
    "temp": 0.30,
    "moisture": 0.20,
    "noise": 0.25,
    "light": 0.15,
    "stability": 0.10,
}

PRODUCTIVITY_WEIGHTS = {
    "temp": 0.30,
    "moisture": 0.20,
    "noise": 0.20,
    "light": 0.20,
    "stability": 0.10,
}

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# BASIC HELPERS
# ============================================================
def safe_float(value):
    if value is None:
        return float("nan")
    value = str(value).strip().lower()
    if value == "nan":
        return float("nan")
    return float(value)


def fmt(value, digits=2):
    if value is None:
        return None
    try:
        if math.isnan(value):
            return None
    except TypeError:
        pass
    return round(value, digits) if isinstance(value, (int, float)) else value


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


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


def adc_to_voltage(adc_value, vref=5.0):
    return float("nan") if math.isnan(adc_value) else adc_value * vref / 1023.0


def minmax_norm(value, min_val, max_val):
    if math.isnan(value) or max_val <= min_val:
        return float("nan")
    return clamp((value - min_val) / (max_val - min_val), 0.0, 1.0)


def linear_score_inside_band(x, ideal_min, ideal_max, hard_min, hard_max):
    """
    Score 100 inside ideal band.
    Linearly taper to 0 at hard bounds.
    """
    if math.isnan(x):
        return float("nan")
    if x < hard_min or x > hard_max:
        return 0.0
    if ideal_min <= x <= ideal_max:
        return 100.0
    if x < ideal_min:
        return 100.0 * (x - hard_min) / (ideal_min - hard_min)
    return 100.0 * (hard_max - x) / (hard_max - ideal_max)


def inverse_band_score(x, ideal_low, ideal_high, bad_low, bad_high):
    """
    100 inside [ideal_low, ideal_high], tapering to 0 toward bad_low/bad_high.
    Useful for relative variables like noise and light target bands.
    """
    if math.isnan(x):
        return float("nan")
    if x <= bad_low or x >= bad_high:
        return 0.0
    if ideal_low <= x <= ideal_high:
        return 100.0
    if x < ideal_low:
        return 100.0 * (x - bad_low) / (ideal_low - bad_low)
    return 100.0 * (bad_high - x) / (bad_high - ideal_high)

# ============================================================
# PHYSICAL / ATMOSPHERIC DERIVED METRICS
# ============================================================
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

# ============================================================
# COMPONENT SCORES
# ============================================================
def temperature_score(temp_c):
    return linear_score_inside_band(
        temp_c,
        TEMP_IDEAL_MIN_C,
        TEMP_IDEAL_MAX_C,
        TEMP_MIN_C,
        TEMP_MAX_C,
    )


def humidity_score(rh_pct):
    return linear_score_inside_band(
        rh_pct,
        RH_IDEAL_MIN,
        RH_IDEAL_MAX,
        RH_MIN,
        RH_MAX,
    )


def dew_point_score(dew_c):
    if math.isnan(dew_c):
        return float("nan")
    if dew_c <= DEW_COMFY_C:
        return 100.0
    if dew_c <= DEW_MUGGY_START_C:
        return 100.0 * (DEW_MUGGY_START_C - dew_c) / (DEW_MUGGY_START_C - DEW_COMFY_C)
    if dew_c <= DEW_STICKY_C:
        return 70.0 * (DEW_STICKY_C - dew_c) / (DEW_STICKY_C - DEW_MUGGY_START_C)
    if dew_c <= DEW_OPPRESSIVE_C:
        return 30.0 * (DEW_OPPRESSIVE_C - dew_c) / (DEW_OPPRESSIVE_C - DEW_STICKY_C)
    return 0.0


def stability_subscore_from_std(value_std, ideal_max, hard_max):
    if math.isnan(value_std):
        return float("nan")
    if value_std <= ideal_max:
        return 100.0
    if value_std >= hard_max:
        return 0.0
    return 100.0 * (hard_max - value_std) / (hard_max - ideal_max)


def stability_subscore_from_rate(abs_rate, ideal_max, hard_max):
    if math.isnan(abs_rate):
        return float("nan")
    if abs_rate <= ideal_max:
        return 100.0
    if abs_rate >= hard_max:
        return 0.0
    return 100.0 * (hard_max - abs_rate) / (hard_max - ideal_max)


def stability_score(temp_std, rh_std, dtemp_dt, drh_dt):
    parts = [
        stability_subscore_from_std(temp_std, 0.15, 1.00),
        stability_subscore_from_std(rh_std, 1.5, 8.0),
        stability_subscore_from_rate(abs(dtemp_dt) if not math.isnan(dtemp_dt) else float("nan"), 0.01, 0.30),
        stability_subscore_from_rate(abs(drh_dt) if not math.isnan(drh_dt) else float("nan"), 0.05, 2.00),
    ]
    vals = [p for p in parts if not math.isnan(p)]
    return sum(vals) / len(vals) if vals else float("nan")


def relative_noise_level(noise_p2p):
    # 0 = very quiet compared to your room, 1 = loud compared to your room
    return minmax_norm(noise_p2p, NOISE_MIN_P2P, NOISE_MAX_P2P)


def relative_light_level(light_raw):
    # 0 = dark side of your room history, 1 = bright side of your room history
    return minmax_norm(light_raw, LIGHT_MIN_RAW, LIGHT_MAX_RAW)


def noise_calmness_score(noise_rel):
    if math.isnan(noise_rel):
        return float("nan")
    # Calm rooms are better for general comfort.
    return 100.0 * (1.0 - noise_rel)


def general_light_suitability_score(light_rel):
    if math.isnan(light_rel):
        return float("nan")
    # For general room comfort, extreme darkness or extreme glare are both not ideal.
    # Favor moderate light.
    return inverse_band_score(light_rel, 0.30, 0.65, 0.00, 1.00)


def relax_light_score(light_rel):
    if math.isnan(light_rel):
        return float("nan")
    # Relaxation is usually best in dim-to-moderate light.
    return inverse_band_score(light_rel, 0.15, 0.45, 0.00, 0.85)


def productivity_light_score(light_rel):
    if math.isnan(light_rel):
        return float("nan")
    # Productivity usually benefits from moderate-to-bright light, not very dim.
    return inverse_band_score(light_rel, 0.45, 0.80, 0.10, 1.00)


def moisture_score(rh_score, dew_score):
    vals = [v for v in [rh_score, dew_score] if not math.isnan(v)]
    return sum(vals) / len(vals) if vals else float("nan")

# ============================================================
# COMPOSITE SCORES
# ============================================================
def weighted_mean(score_map, weight_map):
    total = 0.0
    used_w = 0.0
    for key, w in weight_map.items():
        val = score_map.get(key, float("nan"))
        if not math.isnan(val):
            total += val * w
            used_w += w
    return total / used_w if used_w > 0 else float("nan")


def room_score(temp_s, rh_s, dew_s, stability_s, noise_s, light_s):
    return weighted_mean(
        {
            "temp": temp_s,
            "rh": rh_s,
            "dew": dew_s,
            "stability": stability_s,
            "noise": noise_s,
            "light": light_s,
        },
        ROOM_SCORE_WEIGHTS,
    )


def relaxation_score(temp_s, moisture_s, noise_s, relax_light_s, stability_s):
    return weighted_mean(
        {
            "temp": temp_s,
            "moisture": moisture_s,
            "noise": noise_s,
            "light": relax_light_s,
            "stability": stability_s,
        },
        RELAX_WEIGHTS,
    )


def productivity_score(temp_s, moisture_s, noise_s, prod_light_s, stability_s):
    return weighted_mean(
        {
            "temp": temp_s,
            "moisture": moisture_s,
            "noise": noise_s,
            "light": prod_light_s,
            "stability": stability_s,
        },
        PRODUCTIVITY_WEIGHTS,
    )


def overstimulation_risk(noise_calm_s, relax_light_s, temp_s, moisture_s, stability_s):
    # Higher means greater chance the room feels overstimulating.
    parts = {
        "noise_load": 100.0 - noise_calm_s if not math.isnan(noise_calm_s) else float("nan"),
        "light_load": 100.0 - relax_light_s if not math.isnan(relax_light_s) else float("nan"),
        "thermal_load": 100.0 - temp_s if not math.isnan(temp_s) else float("nan"),
        "moisture_load": 100.0 - moisture_s if not math.isnan(moisture_s) else float("nan"),
        "instability_load": 100.0 - stability_s if not math.isnan(stability_s) else float("nan"),
    }
    return weighted_mean(
        parts,
        {
            "noise_load": 0.35,
            "light_load": 0.25,
            "thermal_load": 0.20,
            "moisture_load": 0.10,
            "instability_load": 0.10,
        },
    )

# ============================================================
# INTERPRETATION / LABELS
# ============================================================
def label_score(score):
    if math.isnan(score):
        return "unknown"
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 55:
        return "fair"
    if score >= 40:
        return "poor"
    return "bad"


def light_state(light_rel):
    if math.isnan(light_rel):
        return "unknown light"
    if light_rel < 0.15:
        return "very dim"
    if light_rel < 0.35:
        return "dim"
    if light_rel < 0.65:
        return "moderately lit"
    if light_rel < 0.85:
        return "bright"
    return "very bright"


def noise_state(noise_rel):
    if math.isnan(noise_rel):
        return "unknown noise"
    if noise_rel < 0.15:
        return "very quiet"
    if noise_rel < 0.35:
        return "quiet"
    if noise_rel < 0.60:
        return "moderately active"
    if noise_rel < 0.80:
        return "noisy"
    return "very noisy"


def moisture_state(dew_c, rh_pct):
    if math.isnan(dew_c) and math.isnan(rh_pct):
        return "unknown moisture"
    if not math.isnan(dew_c):
        if dew_c <= DEW_COMFY_C:
            return "dry-comfortable"
        if dew_c <= DEW_STICKY_C:
            return "slightly muggy"
        return "muggy"
    if not math.isnan(rh_pct):
        if rh_pct < RH_IDEAL_MIN:
            return "dry"
        if rh_pct <= RH_IDEAL_MAX:
            return "comfortable humidity"
        return "humid"
    return "unknown moisture"


def thermal_state(temp_c, temp_score_val):
    if math.isnan(temp_c):
        return "unknown temperature"
    if temp_score_val >= 85:
        return "thermally comfortable"
    if temp_c < TEMP_IDEAL_MIN_C:
        return "cool"
    if temp_c > TEMP_IDEAL_MAX_C:
        return "warm"
    return "slightly off-comfort"


def infer_room_state(room_score_val, relax_score_val, prod_score_val,
                     overstim_risk_val, light_rel, noise_rel,
                     temp_score_val, moisture_score_val):
    lstate = light_state(light_rel)
    nstate = noise_state(noise_rel)

    if not math.isnan(overstim_risk_val) and overstim_risk_val >= 70:
        return f"overstimulating ({lstate}, {nstate})"

    if not math.isnan(relax_score_val) and relax_score_val >= 75 and not math.isnan(prod_score_val) and prod_score_val < 70:
        return f"calm / restful ({lstate}, {nstate})"

    if not math.isnan(prod_score_val) and prod_score_val >= 75 and not math.isnan(relax_score_val) and relax_score_val >= 60:
        return f"focused / productive ({lstate}, {nstate})"

    if not math.isnan(room_score_val) and room_score_val < 55:
        if not math.isnan(temp_score_val) and temp_score_val < 50:
            return f"thermally uncomfortable ({lstate}, {nstate})"
        if not math.isnan(moisture_score_val) and moisture_score_val < 50:
            return f"stuffy / moisture-uncomfortable ({lstate}, {nstate})"

    if nstate in ["very quiet", "quiet"] and lstate in ["very dim", "dim"]:
        return f"dim and quiet"

    if nstate in ["very quiet", "quiet"] and lstate in ["bright", "very bright"]:
        return f"bright but calm"

    return f"mixed / neutral ({lstate}, {nstate})"


def make_conclusion(room_score_val, relax_score_val, prod_score_val, overstim_risk_val, state_label):
    room_label = label_score(room_score_val)
    relax_label = label_score(relax_score_val)
    prod_label = label_score(prod_score_val)

    if math.isnan(room_score_val):
        return "Insufficient valid sensor data to assess the room."

    summary = (
        f"Overall room quality is {room_label}. "
        f"The room currently appears {state_label}. "
        f"Relaxation suitability is {relax_label}, productivity suitability is {prod_label}."
    )

    if not math.isnan(overstim_risk_val):
        if overstim_risk_val >= 70:
            summary += " Overstimulation risk is high."
        elif overstim_risk_val >= 45:
            summary += " Overstimulation risk is moderate."
        else:
            summary += " Overstimulation risk is low."

    return summary

# ============================================================
# INPUT PARSING
# ============================================================
def parse_line(line):
    parts = [p.strip() for p in line.split(",")]
    if len(parts) != 9:
        return None
    try:
        return {
            "ms": int(parts[0]),
            "light_raw": float(parts[1]),
            "noise_avg": float(parts[2]),
            "noise_p2p": float(parts[3]),
            "temp_c": safe_float(parts[4]),
            "humidity_pct": safe_float(parts[5]),
            "light_err": int(parts[6]),
            "mic_err": int(parts[7]),
            "dht_err": int(parts[8]),
        }
    except ValueError:
        return None

# ============================================================
# ROLLING STATE
# ============================================================
light_hist = deque(maxlen=WINDOW_SIZE)
noise_hist = deque(maxlen=WINDOW_SIZE)
temp_hist = deque(maxlen=WINDOW_SIZE)
rh_hist = deque(maxlen=WINDOW_SIZE)

first_ms = None
prev_time_s = None
prev_temp_s = float("nan")
prev_rh_s = float("nan")
prev_light_s = float("nan")
prev_noise_s = float("nan")

# ============================================================
# MAIN ANALYTICS
# ============================================================
def compute_analytics(row):
    global first_ms, prev_time_s, prev_temp_s, prev_rh_s, prev_light_s, prev_noise_s

    if first_ms is None:
        first_ms = row["ms"]
    time_s = (row["ms"] - first_ms) / 1000.0

    # Respect sensor error flags
    light_val = row["light_raw"] if row["light_err"] == 0 else float("nan")
    noise_val = row["noise_p2p"] if row["mic_err"] == 0 else float("nan")
    temp_val = row["temp_c"] if row["dht_err"] == 0 else float("nan")
    rh_val = row["humidity_pct"] if row["dht_err"] == 0 else float("nan")

    # Rolling histories
    light_hist.append(light_val)
    noise_hist.append(noise_val)
    temp_hist.append(temp_val)
    rh_hist.append(rh_val)

    # Smoothed values
    light_s = mean_ignore_nan(light_hist)
    noise_s = mean_ignore_nan(noise_hist)
    temp_s = mean_ignore_nan(temp_hist)
    rh_s = mean_ignore_nan(rh_hist)

    # Variability
    light_std = std_ignore_nan(light_hist)
    noise_std = std_ignore_nan(noise_hist)
    temp_std = std_ignore_nan(temp_hist)
    rh_std = std_ignore_nan(rh_hist)

    # Rates
    dt = (time_s - prev_time_s) if prev_time_s is not None else float("nan")
    dlight_dt = rate_of_change(light_s, prev_light_s, dt) if not math.isnan(dt) else float("nan")
    dnoise_dt = rate_of_change(noise_s, prev_noise_s, dt) if not math.isnan(dt) else float("nan")
    dtemp_dt = rate_of_change(temp_s, prev_temp_s, dt) if not math.isnan(dt) else float("nan")
    drh_dt = rate_of_change(rh_s, prev_rh_s, dt) if not math.isnan(dt) else float("nan")

    # Derived physical metrics
    temp_f = c_to_f(temp_s)
    dew_c = dew_point_c(temp_s, rh_s)
    dew_f = c_to_f(dew_c)
    sat_vp = saturation_vapor_pressure_hpa(temp_s)
    act_vp = actual_vapor_pressure_hpa(temp_s, rh_s)
    abs_h = absolute_humidity_gm3(temp_s, rh_s)
    hum_ratio = humidity_ratio(temp_s, rh_s)
    light_v = adc_to_voltage(light_s, VREF)

    # Relative sensor levels (not absolute lux / dBA)
    light_rel = relative_light_level(light_s)
    noise_rel = relative_noise_level(noise_s)

    # Component scores
    temp_score_val = temperature_score(temp_s)
    rh_score_val = humidity_score(rh_s)
    dew_score_val = dew_point_score(dew_c)
    stability_score_val = stability_score(temp_std, rh_std, dtemp_dt, drh_dt)
    noise_calm_score_val = noise_calmness_score(noise_rel)
    general_light_score_val = general_light_suitability_score(light_rel)
    relax_light_score_val = relax_light_score(light_rel)
    productivity_light_score_val = productivity_light_score(light_rel)
    moisture_score_val = moisture_score(rh_score_val, dew_score_val)

    # Composite scores
    room_score_val = room_score(
        temp_score_val,
        rh_score_val,
        dew_score_val,
        stability_score_val,
        noise_calm_score_val,
        general_light_score_val,
    )
    relaxation_score_val = relaxation_score(
        temp_score_val,
        moisture_score_val,
        noise_calm_score_val,
        relax_light_score_val,
        stability_score_val,
    )
    productivity_score_val = productivity_score(
        temp_score_val,
        moisture_score_val,
        noise_calm_score_val,
        productivity_light_score_val,
        stability_score_val,
    )
    overstimulation_risk_val = overstimulation_risk(
        noise_calm_score_val,
        relax_light_score_val,
        temp_score_val,
        moisture_score_val,
        stability_score_val,
    )

    # Inference labels
    room_state_label = infer_room_state(
        room_score_val,
        relaxation_score_val,
        productivity_score_val,
        overstimulation_risk_val,
        light_rel,
        noise_rel,
        temp_score_val,
        moisture_score_val,
    )
    thermal_label = thermal_state(temp_s, temp_score_val)
    moisture_label = moisture_state(dew_c, rh_s)
    light_label = light_state(light_rel)
    noise_label = noise_state(noise_rel)
    conclusion = make_conclusion(
        room_score_val,
        relaxation_score_val,
        productivity_score_val,
        overstimulation_risk_val,
        room_state_label,
    )

    # Update rolling state
    prev_time_s = time_s
    prev_temp_s = temp_s
    prev_rh_s = rh_s
    prev_light_s = light_s
    prev_noise_s = noise_s

    return {
        "pc_time": datetime.now().isoformat(timespec="seconds"),
        "time_s": fmt(time_s, 1),

        # Smoothed measured values
        "temp_c": fmt(temp_s),
        "temp_f": fmt(temp_f),
        "humidity_pct": fmt(rh_s),
        "light_raw": fmt(light_s, 0),
        "noise_p2p": fmt(noise_s, 1),
        "noise_avg": fmt(row["noise_avg"], 1),
        "light_voltage": fmt(light_v, 3),

        # Derived physical metrics
        "dew_point_c": fmt(dew_c),
        "dew_point_f": fmt(dew_f),
        "abs_humidity_gm3": fmt(abs_h),
        "humidity_ratio": fmt(hum_ratio, 4),
        "sat_vp_hpa": fmt(sat_vp),
        "act_vp_hpa": fmt(act_vp),

        # Relative room-side normalized levels
        "light_relative": fmt(light_rel, 3),
        "noise_relative": fmt(noise_rel, 3),

        # Variability / trend
        "temp_std": fmt(temp_std, 3),
        "rh_std": fmt(rh_std, 3),
        "light_std": fmt(light_std, 3),
        "noise_std": fmt(noise_std, 3),
        "dtemp_dt": fmt(dtemp_dt, 4),
        "drh_dt": fmt(drh_dt, 4),
        "dlight_dt": fmt(dlight_dt, 4),
        "dnoise_dt": fmt(dnoise_dt, 4),

        # Component scores
        "temperature_score": fmt(temp_score_val, 1),
        "humidity_score": fmt(rh_score_val, 1),
        "dew_point_score": fmt(dew_score_val, 1),
        "stability_score": fmt(stability_score_val, 1),
        "noise_calmness_score": fmt(noise_calm_score_val, 1),
        "general_light_score": fmt(general_light_score_val, 1),
        "relax_light_score": fmt(relax_light_score_val, 1),
        "productivity_light_score": fmt(productivity_light_score_val, 1),
        "moisture_score": fmt(moisture_score_val, 1),

        # Composite scores
        "room_score": fmt(room_score_val, 1),
        "relaxation_score": fmt(relaxation_score_val, 1),
        "productivity_score": fmt(productivity_score_val, 1),
        "overstimulation_risk": fmt(overstimulation_risk_val, 1),

        # Human-readable inference
        "thermal_label": thermal_label,
        "moisture_label": moisture_label,
        "light_label": light_label,
        "noise_label": noise_label,
        "room_state": room_state_label,
        "room_quality_label": label_score(room_score_val),
        "relaxation_label": label_score(relaxation_score_val),
        "productivity_label": label_score(productivity_score_val),
        "conclusion": conclusion,

        # Error flags
        "light_err": row["light_err"],
        "mic_err": row["mic_err"],
        "dht_err": row["dht_err"],
    }

# ============================================================
# SIMULATOR
# ============================================================
_sim_ms = 0
_sim_temp = 23.0
_sim_rh = 48.0
_sim_light = 820.0
_sim_noise = 15.0


def simulate_row():
    global _sim_ms, _sim_temp, _sim_rh, _sim_light, _sim_noise
    _sim_ms += 1000
    _sim_temp = max(15.0, min(35.0, _sim_temp + random.uniform(-0.2, 0.2)))
    _sim_rh = max(20.0, min(80.0, _sim_rh + random.uniform(-0.5, 0.5)))
    _sim_light = max(0.0, min(1023.0, _sim_light + random.uniform(-10, 10)))
    _sim_noise = max(2.0, min(100.0, _sim_noise + random.uniform(-2, 2)))

    if random.random() < 0.06:
        _sim_noise = random.uniform(45, 80)
    if random.random() < 0.05:
        _sim_light = random.uniform(680, 1000)

    return {
        "ms": _sim_ms,
        "light_raw": round(_sim_light, 1),
        "noise_avg": round(_sim_noise * 0.6, 1),
        "noise_p2p": round(_sim_noise, 1),
        "temp_c": round(_sim_temp, 2),
        "humidity_pct": round(_sim_rh, 2),
        "light_err": 0,
        "mic_err": 0,
        "dht_err": 0,
    }

# ============================================================
# WEBSOCKET ENDPOINT
# ============================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Frontend connected!")

    if SIMULATE:
        print("Running in SIMULATION mode.")
        try:
            while True:
                row = simulate_row()
                data = compute_analytics(row)
                await websocket.send_text(json.dumps(data))
                print(
                    f"[SIM] room={data['room_score']} relax={data['relaxation_score']} "
                    f"prod={data['productivity_score']} stress={data['overstimulation_risk']} "
                    f"state={data['room_state']}"
                )
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
