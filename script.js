/* ─────────────────────────────────────────────
   MOODWAVE — script.js
   ───────────────────────────────────────────── */

// ── DOM ──
const statusText      = document.getElementById("statusText");
const loginBtn        = document.getElementById("loginBtn");
const signUpBtn       = document.querySelector('.nav-right a.btn-filled[href="/login"]');
const sessionUser     = document.getElementById("sessionUser");
const logoutBtn       = document.getElementById("logoutBtn");
const tempValueEl     = document.getElementById("tempValue");
const tempUnitEl      = document.getElementById("tempUnit");
const humidityValue   = document.getElementById("humidityValue");
const soundValue      = document.getElementById("soundValue");
const brightnessValue = document.getElementById("brightnessValue");
const spaceMood       = document.getElementById("spaceMood");
const dashboardClock  = document.getElementById("dashboardClock");
const dayPhase        = document.getElementById("dayPhase");
const roomCondition   = document.getElementById("roomCondition");
const spaceAdvice     = document.getElementById("spaceAdvice");
const eventLog        = document.getElementById("eventLog");
const logCount        = document.getElementById("logCount");
const eventTimer      = document.getElementById("eventTimer");
const toggleButtons   = document.querySelectorAll(".toggle-btn");
const unitToggleBtn   = document.getElementById("unitToggleBtn");
const tempCard        = document.getElementById("card-temperature");

// Lab
const labTemp          = document.getElementById("labTemp");
const labLight         = document.getElementById("labLight");
const labNoise         = document.getElementById("labNoise");
const labHumidity      = document.getElementById("labHumidity");
const labTimeButtons   = document.querySelectorAll(".time-btn");
const labTempDisplay   = document.getElementById("labTempDisplay");
const labLightValue    = document.getElementById("labLightValue");
const labNoiseValue    = document.getElementById("labNoiseValue");
const labHumidityValue = document.getElementById("labHumidityValue");
const labTimeOfDayValue = document.getElementById("labTimeOfDayValue");
const labMusicTitle    = document.getElementById("labMusicTitle");
const labMusicSummary  = document.getElementById("labMusicSummary");
const labRoomType      = document.getElementById("labRoomType");
const labGoalValue     = document.getElementById("labGoalValue");
const labMusicStyle    = document.getElementById("labMusicStyle");
const labEnergy        = document.getElementById("labEnergy");
const goalButtons      = document.querySelectorAll(".goal-btn");
const presetButtons    = document.querySelectorAll(".preset-card, .preset-btn");

// Music player
const playerTrack  = document.getElementById("playerTrack");
const playerMuteBtn = document.getElementById("playerMuteBtn");
const playerPlayBtn = document.getElementById("playerPlayBtn");
const playerSkipBtn = document.getElementById("playerSkipBtn");
const musicPlayer  = document.getElementById("musicPlayer");

// ── STATE ──
const sensorState = { temperature: true, humidity: true, sound: true, brightness: true };
const latestSensorValues = { temperature: 23, humidity: 48, sound: 40, brightness: 380 };

const events = [];
let selectedGoal   = "study";
let showFahrenheit = false;
let selectedLabTimeOfDay = "Midday";
let isMuted = true;
let landingTrackIndex = 0;
const isTestLabPage = Boolean(document.getElementById("test-lab"));
const isDashboardPage = Boolean(document.getElementById("dashboardClock"));
const isLandingPage = Boolean(document.getElementById("heroSection")) && !isTestLabPage && !isDashboardPage;
const landingPageAudio = isLandingPage ? new Audio("/Audio/Chill1.mp3") : null;

// Expose dashboard state/hooks for teammate integration.
window.sensorState = sensorState;
window.latestSensorValues = latestSensorValues;
window.ws = null;
window._placeholderInterval = null;

if (landingPageAudio) {
  landingPageAudio.loop = true;
  landingPageAudio.preload = "none";
  landingPageAudio.muted = true;
}

// ─────────────────────────────────────────────
// TEMPERATURE HELPERS
// ─────────────────────────────────────────────
function cToF(c) { return c * 9 / 5 + 32; }

function tempClass(celsius) {
  if (celsius <= 0)  return "temp-ice";
  if (celsius <= 8)  return "temp-cold";
  if (celsius <= 17) return "temp-cool";
  if (celsius <= 24) return "temp-ok";
  if (celsius <= 30) return "temp-warm";
  if (celsius <= 36) return "temp-hot";
  return "temp-lava";
}

const TEMP_CLASSES = ["temp-ice", "temp-cold", "temp-cool", "temp-ok", "temp-warm", "temp-hot", "temp-lava"];

function applyTempStyling(celsius) {
  if (!tempCard) return;
  const cls = tempClass(celsius);
  TEMP_CLASSES.forEach((c) => tempCard.classList.remove(c));
  tempCard.classList.add(cls);
}

// ─────────────────────────────────────────────
// MOOD / CONDITION INFERENCE
// ─────────────────────────────────────────────
function inferMood(temperature, humidity, sound, brightness) {
  if (sound > 65 || temperature > 28) return "High Energy";
  if (sound < 42 && brightness < 220) return "Calm / Relaxed";
  if (brightness > 480 && humidity < 55) return "Focused";
  return "Balanced Flow";
}

function inferRoomCondition(temperature, humidity, sound, brightness) {
  if (temperature > 29 && humidity > 60) return "Hot and stuffy";
  if (sound > 72)                         return "Overstimulated";
  if (brightness < 150 && sound < 40)    return "Dim and quiet";
  if (brightness > 650 && temperature < 25) return "Bright and alert";
  return "Balanced and usable";
}

function inferAdvice(condition, mood) {
  if (condition === "Hot and stuffy")  return "Lower heat or add cooler audio textures to reduce fatigue.";
  if (condition === "Overstimulated")  return "Noise is pushing the room hard. Shift toward calmer layers.";
  if (mood === "Focused")              return "The room is suitable for deep work and clean rhythmic focus tracks.";
  if (mood === "Calm / Relaxed")       return "This room favors softer ambient music and lower percussion density.";
  return "MoodWave would keep the room balanced with adaptive mid-energy sound.";
}

// ─────────────────────────────────────────────
// EVENT LOG
// ─────────────────────────────────────────────
function addEvent(message) {
  const timestamp = new Date().toLocaleTimeString();
  events.unshift(`${timestamp} — ${message}`);
  if (events.length > 6) events.length = 6;
  if (eventLog) eventLog.innerHTML = events.map((e) => `<li>${e}</li>`).join("");
  if (logCount) logCount.textContent = `${events.length} events`;
}
window.addEvent = addEvent;

// ─────────────────────────────────────────────
// CLOCK
// ─────────────────────────────────────────────
function renderClock() {
  const now = new Date();
  if (dashboardClock) dashboardClock.textContent = now.toLocaleTimeString();
  if (dayPhase) {
    dayPhase.textContent = getDayPhaseLabel(now.getHours());
  }
}

function getDayPhaseLabel(hour) {
  if (hour < 6) return "Late Night";
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

function getTrackTimeIndex(dayPhaseLabel) {
  if (dayPhaseLabel === "Morning" || dayPhaseLabel === "Early") return 1;
  if (dayPhaseLabel === "Afternoon" || dayPhaseLabel === "Midday") return 2;
  return 3;
}

function getProfileDayBand(dayPhaseLabel) {
  if (dayPhaseLabel === "Morning" || dayPhaseLabel === "Early") return "early";
  if (dayPhaseLabel === "Afternoon" || dayPhaseLabel === "Midday") return "midday";
  return "late";
}

function getTempTrackBand(temperature) {
  if (temperature < 17) return 1;
  if (temperature < 22) return 2;
  if (temperature < 25.5) return 3;
  return 4;
}

function getTrackIndex(time, temp) {
  return 4 * (time - 1) + (temp - 1);
}

// ─────────────────────────────────────────────
// RENDER SENSOR DATA
// ─────────────────────────────────────────────
function renderData(temperature, humidity, sound, brightness) 
{
  latestSensorValues.temperature = temperature;
  latestSensorValues.humidity    = humidity;
  latestSensorValues.sound       = sound;
  latestSensorValues.brightness  = brightness;

  const temp = getTempTrackBand(temperature);


  if (tempValueEl) {
    if (sensorState.temperature) {
      tempValueEl.textContent = showFahrenheit
        ? cToF(temperature).toFixed(1)
        : temperature.toFixed(1);
    } else {
      tempValueEl.textContent = "OFF";
    }
  }
  if (tempUnitEl)    tempUnitEl.textContent    = showFahrenheit ? "°F" : "°C";
  if (unitToggleBtn) unitToggleBtn.textContent = showFahrenheit ? "°C" : "°F";

  if (sensorState.temperature) applyTempStyling(temperature);

  if (humidityValue)   humidityValue.textContent   = sensorState.humidity   ? humidity.toFixed(0)   : "OFF";
  if (soundValue)      soundValue.textContent       = sensorState.sound      ? sound.toFixed(0)      : "OFF";
  if (brightnessValue) brightnessValue.textContent  = sensorState.brightness ? brightness.toFixed(0) : "OFF";

  const mood      = inferMood(temperature, humidity, sound, brightness);
  const condition = inferRoomCondition(temperature, humidity, sound, brightness);

  if (spaceMood)     spaceMood.textContent     = mood;
  if (roomCondition) roomCondition.textContent = condition;
  if (spaceAdvice)   spaceAdvice.textContent   = inferAdvice(condition, mood);

  const time = getTrackTimeIndex(getDayPhaseLabel(new Date().getHours()));

  

  updatePlayerTrack(time, temp);
  updateReverbFromBrightness(brightness);
}

function updateReverbFromBrightness(brightness) 
{
  if (!audioCtx) return;
  // bright room = dry, dark room = wet
  const wetAmount = 1 - Math.min(brightness / 600, 1);

  // Apply to both slots so the currently audible slot always has the right mix.
  slot.forEach((s, idx) => {
    if (s.source) {
      setReverb(idx, wetAmount);
    }
  });
}

window.renderData = renderData;

// ─────────────────────────────────────────────
// PLACEHOLDER DATA GENERATOR
// ─────────────────────────────────────────────
function generatePlaceholderData() {
  const temperature = sensorState.temperature ? 20 + Math.random() * 14   : latestSensorValues.temperature;
  const humidity    = sensorState.humidity    ? 35 + Math.random() * 32   : latestSensorValues.humidity;
  const sound       = sensorState.sound       ? 28 + Math.random() * 52   : latestSensorValues.sound;
  const brightness  = sensorState.brightness  ? 100 + Math.random() * 760 : latestSensorValues.brightness;
  renderData(temperature, humidity, sound, brightness);
  if (eventTimer) eventTimer.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function extractSensorValue(payload, keys, fallback) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && !Number.isNaN(Number(payload[key]))) {
      return Number(payload[key]);
    }
  }
  return fallback;
}

function startDashboardStream() {
  if (!isDashboardPage) return;

  const wsUrl = "ws://localhost:8000/ws";
  try {
    const ws = new WebSocket(wsUrl);
    window.ws = ws;

    ws.addEventListener("open", () => {
      if (statusText) statusText.textContent = "Live mode: Arduino stream connected.";
      addEvent("Arduino stream connected");
    });

    ws.addEventListener("message", (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      const temperature = extractSensorValue(data, ["temp_c", "temperature", "temp"], latestSensorValues.temperature);
      const humidity = extractSensorValue(data, ["humidity_pct", "humidity", "rh"], latestSensorValues.humidity);
      const sound = extractSensorValue(data, ["noise_p2p", "noise", "sound"], latestSensorValues.sound);
      const brightness = extractSensorValue(data, ["light_raw", "brightness", "light"], latestSensorValues.brightness);

      if (soundValue && sensorState.sound) {
        soundValue.textContent = sound.toFixed(0);
        const soundUnit = document.getElementById("soundUnit");
        if (soundUnit) soundUnit.textContent = "dB";
      }

      renderData(temperature, humidity, sound, brightness);
      if (eventTimer) eventTimer.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    });

    ws.addEventListener("close", () => {
      if (statusText) statusText.textContent = "Live mode: Stream disconnected. Waiting to reconnect...";
      addEvent("Arduino stream disconnected");
    });

    ws.addEventListener("error", () => {
      if (statusText) statusText.textContent = "Live mode: Waiting for Arduino stream...";
    });
  } catch (_) {
    if (statusText) statusText.textContent = "Live mode: Waiting for Arduino stream...";
  }
}

// ─────────────────────────────────────────────
// SENSOR CARD TOGGLE STATE
// ─────────────────────────────────────────────
function updateSensorCardState() {
  Object.entries(sensorState).forEach(([sensor, active]) => {
    const button = document.querySelector(`.toggle-btn[data-sensor="${sensor}"]`);
    const card   = document.getElementById(`card-${sensor}`);
    if (button) {
      button.textContent = active ? "On" : "Off";
      button.classList.toggle("toggle-off", !active);
    }
    if (card) card.classList.toggle("sensor-off", !active);
    if (sensor === "temperature" && !active && tempCard) {
      TEMP_CLASSES.forEach((c) => tempCard.classList.remove(c));
    }
  });
}

// ─────────────────────────────────────────────
// TEST LAB HELPERS
// ─────────────────────────────────────────────
function noiseLabel(value) {
  if (value < 20) return "Quiet";
  if (value < 40) return "Low buzz";
  if (value < 60) return "Busy";
  if (value < 80) return "Loud";
  return "RAVE!";
}

function gradientTrack(inputEl, percent, active, rest) {
  if (!inputEl) return;
  inputEl.style.background = `linear-gradient(90deg, ${active} 0%, ${active} ${percent}%, ${rest} ${percent}%, ${rest} 100%)`;
}

function updateLabVisuals(temperature, light, noise) {
  const tempPct = ((temperature - 0) / 50) * 100;
  const noisePct = ((noise - 0) / 100) * 100;

  if (labTemp) {
    labTemp.style.background = "linear-gradient(90deg, #2a8bff 0%, #70dc8a 50%, #ea5a5a 100%)";
  }
  if (labLight) {
    labLight.style.background = "linear-gradient(90deg, #f7fbff 0%, #fff3c4 55%, #ffd459 100%)";
  }
  gradientTrack(labNoise, noisePct, "#66d1ff", "#ff8f3f");

  if (labTempDisplay) {
    let tempColor = "#71cbff";
    if (temperature <= 12) tempColor = "#5ca8ff";
    else if (temperature >= 33) tempColor = "#ff6e58";
    else if (temperature >= 21 && temperature <= 27) tempColor = "#7dff9a";
    labTempDisplay.style.color = tempColor;
  }

  if (labLightValue) {
    const warm = Math.min(255, Math.max(190, Math.round(190 + (light / 1000) * 65)));
    labLightValue.style.color = `rgb(255, ${warm}, 120)`;
  }

  if (labNoiseValue) {
    const quiet = noise <= 25;
    const loud = noise >= 70;
    labNoiseValue.style.textTransform = loud ? "uppercase" : "lowercase";
    labNoiseValue.style.fontSize = quiet ? "0.78rem" : loud ? "1rem" : "0.88rem";
    labNoiseValue.style.fontWeight = loud ? "800" : quiet ? "500" : "650";
    labNoiseValue.style.letterSpacing = loud ? "0.04em" : "0.01em";
  }
}

function generateMusicProfile(temperature, light, noise, humidity, goal, timeOfDay) {
  const roomType = inferRoomCondition(temperature, humidity, noise, light);
  const dayBand = getProfileDayBand(timeOfDay);
  const tempBand = temperature <= 24 ? "cold" : "hot";
  const key = `${dayBand}-${tempBand}`;

  const profiles = {
    "early-cold": {
      title: "Dawn Chill Pulse",
      style: "Soft crystalline ambient",
      summary: "Cool early air gets a gentle rhythmic bed with light texture to ease you into the day.",
      energy: "Low"
    },
    "early-hot": {
      title: "Sunrise Heat Lift",
      style: "Warm rising synthwave",
      summary: "Early warmth is balanced with airy highs and controlled rhythm so the room feels bright, not heavy.",
      energy: "Medium"
    },
    "midday-cold": {
      title: "Noon Ice Focus",
      style: "Clean focus electronica",
      summary: "Midday coolness gets crisp percussion and stable patterns to keep productivity locked in.",
      energy: "Medium"
    },
    "midday-hot": {
      title: "Solar Drive",
      style: "High-motion rhythmic pulse",
      summary: "Hot midday conditions push a stronger groove with brighter accents to channel the room's intensity.",
      energy: "High"
    },
    "late-cold": {
      title: "Twilight Frost Calm",
      style: "Deep evening ambient",
      summary: "Late cool rooms get wider pads and slower movement for a calm, grounded night feel.",
      energy: "Low"
    },
    "late-hot": {
      title: "Night Ember Flow",
      style: "Dark warm downtempo",
      summary: "Late warmth is softened with darker low-end waves and smoother transitions for sustained comfort.",
      energy: "Medium"
    }
  };

  const selected = profiles[key] || profiles["midday-cold"];
  let title = selected.title;
  let style = selected.style;
  let summary = selected.summary;
  let energy = selected.energy;

  if (roomType === "Hot and stuffy") {
    summary = "The room feels hot and heavy. MoodWave offsets that with lighter textures and more air in the mix.";
  }
  if (roomType === "Overstimulated") {
    summary = "The room is overstimulated, so MoodWave thins the mix and tightens rhythm to reduce sensory pressure.";
  }

  return { roomType, title, summary, style, energy };
}

function updateLabOutput() {
  if (!labTemp || !labLight || !labNoise || !labHumidity) return;

  const temperature = Number(labTemp.value);
  const light       = Number(labLight.value);
  const noise       = Number(labNoise.value);
  const humidity    = Number(labHumidity.value);
  const timeOfDay   = selectedLabTimeOfDay;
  const fahr        = cToF(temperature).toFixed(0);
  const profile     = generateMusicProfile(temperature, light, noise, humidity, selectedGoal, timeOfDay);

  const temp = getTempTrackBand(temperature);
  const time = getTrackTimeIndex(timeOfDay);
  const trackIdx = getTrackIndex(time, temp);
  const trackLabel = TRACKS[trackIdx]?.label ?? profile.title;

  if (labTempDisplay)   labTempDisplay.textContent   = `${temperature}°C / ${fahr}°F`;
  if (labLightValue)    labLightValue.textContent     = `${light} lux`;
  if (labNoiseValue)    labNoiseValue.textContent     = noiseLabel(noise);
  if (labHumidityValue) labHumidityValue.textContent  = `${humidity}%`;
  if (labTimeOfDayValue) labTimeOfDayValue.textContent = timeOfDay;
  if (labMusicTitle)    labMusicTitle.textContent     = trackLabel;
  if (labMusicSummary)  labMusicSummary.textContent   = profile.summary;
  if (labRoomType)      labRoomType.textContent       = profile.roomType;
  if (labGoalValue)     labGoalValue.textContent      = selectedGoal.charAt(0).toUpperCase() + selectedGoal.slice(1);
  if (labMusicStyle)    labMusicStyle.textContent     = profile.style;
  if (labEnergy)        labEnergy.textContent         = profile.energy;
  updateLabVisuals(temperature, light, noise);

  if (isTestLabPage && playerTrack) playerTrack.textContent = trackLabel;
  if (isTestLabPage) syncTestLabTrack(trackIdx, profile.style);
}

function setLabTimeOfDay(timeOfDay) {
  selectedLabTimeOfDay = timeOfDay;
  if (labTimeOfDayValue) labTimeOfDayValue.textContent = timeOfDay;
  labTimeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.time === timeOfDay);
  });
}

function applyPreset(presetName) {
  if (!labTemp || !labLight || !labNoise || !labHumidity) return;

  const presets = {
    library:   { temperature: 20, light: 210,  noise: 18, humidity: 46, goal: "study",    timeOfDay: "Late" },
    office:    { temperature: 22, light: 520,  noise: 24, humidity: 42, goal: "study",    timeOfDay: "Midday" },
    sauna:     { temperature: 42, light: 860,  noise: 24, humidity: 82, goal: "relax",    timeOfDay: "Early" },
    igloo:     { temperature: 2,  light: 820,  noise: 12, humidity: 30, goal: "study",    timeOfDay: "Early" },
    coffee:    { temperature: 29, light: 540,  noise: 56, humidity: 48, goal: "study",    timeOfDay: "Midday" },
  };

  if (presetName === "randomize") {
    const times = ["Early", "Midday", "Late"];
    const goals = ["study", "relax", "workout", "meditate"];
    const randomPreset = {
      temperature: Math.floor(Math.random() * 51),
      light: Math.floor(Math.random() * 1001),
      noise: Math.floor(Math.random() * 101),
      humidity: 10 + Math.floor(Math.random() * 81),
      goal: goals[Math.floor(Math.random() * goals.length)],
      timeOfDay: times[Math.floor(Math.random() * times.length)]
    };

    labTemp.value = String(randomPreset.temperature);
    labLight.value = String(randomPreset.light);
    labNoise.value = String(randomPreset.noise);
    labHumidity.value = String(randomPreset.humidity);
    setLabTimeOfDay(randomPreset.timeOfDay);
    selectedGoal = randomPreset.goal;

    goalButtons.forEach((b) => {
      b.classList.toggle("active", b.dataset.goal === selectedGoal);
    });

    addEvent("Preset applied: randomize");
    updateLabOutput();
    return;
  }

  const preset = presets[presetName];
  if (!preset) return;

  labTemp.value    = String(preset.temperature);
  labLight.value   = String(preset.light);
  labNoise.value   = String(preset.noise);
  labHumidity.value = String(preset.humidity);
  setLabTimeOfDay(preset.timeOfDay);
  selectedGoal     = preset.goal === "focus" ? "study" : preset.goal;

  goalButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.goal === selectedGoal);
  });

  addEvent(`Preset applied: ${presetName}`);
  updateLabOutput();
}
// ─────────────────────────────────────────────
// MUSIC PLAYER — Web Audio API with crossfade
// ─────────────────────────────────────────────

const TRACKS = 
[
  { label: "Snowed in",               src: "/Audio/1_Snowed_In.mp3" },              // COLD, MORNING
  { label: "Cool Dawn",               src: "/Audio/2_Cool_Dawn.mp3"    },           // chilly Morning
  { label: "Warm Morn",               src: "/Audio/3_Warm_Morn.mp3"    },           // warm Morning
  { label: "Rise and Grind",          src: "/Audio/4_Rise_and_Grind.mp3"     },     // Hot Morning
  { label: "Freezer Meals",           src: "/Audio/5_Freezer_Meals.mp3"    },       // Cold Noon
  { label: "Sweater Weather",         src: "/Audio/6_Sweater_Weather.mp3"  },       // chilly Noon
  { label: "Spacing Off",             src: "/Audio/7_Spacing_Off.mp3"  },           // warm Noon
  { label: "Microwave Madness",       src: "/Audio/8_Microwave_Madness.mp3"   },    // Hot Noon
  { label: "Canarie in the Ice Mine", src: "/Audio/9_Canarie_in_the_Ice_Mine.mp3"}, // Cold Night
  { label: "Journey to the Center of the Moon", src: "/Audio/10_Journey_to_the_Center_of_the_Moon.mp3"  },                  // chilly Night
  { label: "Cave Base",               src: "/Audio/11_Cave_Base.mp3"  },                  // warm Night
  { label: "Invisible Threat",              src: "/Audio/12_Invisible_Threat.mp3"   },                 // Hot Night
];

function fileNameFromSrc(src) {
  const parts = String(src || "").split("/");
  return parts[parts.length - 1] || src;
}

const LANDING_PLAYLIST = Array.from(
  new Map(TRACKS.map((track) => [track.src, track])).values()
).map((track) => ({ src: track.src, label: fileNameFromSrc(track.src) }));

if (isLandingPage && landingPageAudio) {
  const chillIndex = LANDING_PLAYLIST.findIndex((t) => t.src === "/Audio/Chill1.mp3");
  landingTrackIndex = chillIndex >= 0 ? chillIndex : 0;
  landingPageAudio.src = LANDING_PLAYLIST[landingTrackIndex]?.src || "/Audio/Chill1.mp3";
}

// Mood → track index map (matches TRACKS array above)
const MOOD_TRACK_MAP = 
{
  "Focused":        5, // Clear Signal
  "High Energy":    2, // Drive Mode
  "Calm / Relaxed": 1, // Calm Drift
  "Balanced Flow":  7, // Noon Charge
};
const CONDITION_TRACK_OVERRIDES = {
  "Hot and stuffy": 3, // Blue Hour
};

const FADE_DURATION = 8; // seconds

// Two slots — we alternate between them for crossfading
const slot = [
  { gain: null, source: null, stopTimer: null },
  { gain: null, source: null, stopTimer: null },
];
let activeSlot      = 0;
let audioCtx        = null;
let masterGain      = null;
let currentTrackIndex = 0;
let playerPlaying   = false;
let lastMoodIndex   = -1;      // debounce: track last mood-driven index
let moodIndexCount  = 0;       // debounce: consecutive matching readings
let transitionInProgress = false;
let pendingTrackIndex = null;
let loopTimer = null;

const bufferCache = new Map();

function clearLoopTimer() {
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
}

const LOOP_FADE = 2; // seconds — short overlap makes the loop undetectable

// Schedule a seamless self-crossfade loop.
// Fires just before the track ends, overlaps with a fresh copy for
// LOOP_FADE seconds, then reschedules forever.
function scheduleLoop(index, buffer) {
  clearLoopTimer();
  // Start the overlap LOOP_FADE seconds before the track would end
  const delay = Math.max((buffer.duration - LOOP_FADE) * 1000, 100);
  loopTimer = setTimeout(() => {
    loopTimer = null;
    if (currentTrackIndex !== index || transitionInProgress) return;
    transitionInProgress = true;
    const nextSlot = 1 - activeSlot;
    startSlot(nextSlot, buffer);

    // Short tight crossfade so the seam is imperceptible
    const ctx  = getAudioCtx();
    const now  = ctx.currentTime;
    const from = slot[activeSlot].gain.gain;
    const to   = slot[nextSlot].gain.gain;
    from.cancelScheduledValues(now);
    from.setValueAtTime(Math.max(from.value, 0.001), now);
    from.exponentialRampToValueAtTime(0.001, now + LOOP_FADE);
    to.cancelScheduledValues(now);
    to.setValueAtTime(0.001, now);
    to.exponentialRampToValueAtTime(1.0, now + LOOP_FADE);

    const prevSlot = activeSlot;
    activeSlot = nextSlot;
    if (slot[prevSlot].stopTimer) clearTimeout(slot[prevSlot].stopTimer);
    slot[prevSlot].stopTimer = setTimeout(() => {
      stopSlot(prevSlot);
      slot[prevSlot].gain.gain.value = 0;
      transitionInProgress = false;
      // Immediately re-schedule the next loop
      if (currentTrackIndex === index) scheduleLoop(index, buffer);
    }, (LOOP_FADE + 0.15) * 1000);
  }, delay);
}

// Lazily create (or return) the AudioContext and GainNodes.
// Must not be called before a user gesture.
function getAudioCtx() 
{
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = isMuted ? 0 : 1;
    masterGain.connect(audioCtx.destination);
    const impulse = buildImpulse(audioCtx);
    slot.forEach((s) => {
      s.gain = audioCtx.createGain();
      s.gain.gain.value = 0;

      s.reverb  = audioCtx.createConvolver();
      s.reverb.buffer = impulse;
      s.dryGain = audioCtx.createGain();
      s.wetGain = audioCtx.createGain();
      s.dryGain.gain.value = 1.0;
      s.wetGain.gain.value = 0.0;

      s.dryGain.connect(s.gain);
      s.reverb.connect(s.wetGain);
      s.wetGain.connect(s.gain);
      s.gain.connect(masterGain);
    });
  }
  return audioCtx;
}

// load mp3 into the buffer
async function loadBuffer(src) 
{
  if (bufferCache.has(src)) return bufferCache.get(src);
  const res    = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
  const raw    = await res.arrayBuffer();
  const buffer = await getAudioCtx().decodeAudioData(raw);
  bufferCache.set(src, buffer);
  return buffer;
}

// terminates file in a slot
function stopSlot(idx) 
{
  const s = slot[idx];
  if (s.stopTimer) {
    clearTimeout(s.stopTimer);
    s.stopTimer = null;
  }
  if (s.source) {
    try { s.source.stop(); } catch (_) { /* already stopped */ }
    s.source.disconnect();
    s.source = null;
  }
}

// start playing a file in the specified buffer
function startSlot(idx, buffer) {
  const ctx = getAudioCtx();
  stopSlot(idx);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop   = true;
  src.connect(slot[idx].dryGain);
  src.connect(slot[idx].reverb);
  src.start();
  slot[idx].source = src;

  // Apply reverb immediately based on current brightness
  const wetAmount = 1 - Math.min(latestSensorValues.brightness / 600, 1);
  setReverb(idx, wetAmount, 0.01); // near-instant, no fade on start
}

// set Reverb
function setReverb(idx, wetAmount, fadeSecs = 2.0) {
  if (!audioCtx || !slot[idx].wetGain) return;
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  const wet = slot[idx].wetGain.gain;
  const dry = slot[idx].dryGain.gain;
  wet.cancelScheduledValues(now);
  dry.cancelScheduledValues(now);
  wet.setValueAtTime(Math.max(wet.value, 0.001), now);
  dry.setValueAtTime(Math.max(dry.value, 0.001), now);
  wet.exponentialRampToValueAtTime(Math.max(wetAmount, 0.001),       now + fadeSecs);
  dry.exponentialRampToValueAtTime(Math.max(1 - wetAmount, 0.001),   now + fadeSecs);
}

// Crossfade from fromIdx slot to toIdx slot over FADE_DURATION seconds.
function crossfade(fromIdx, toIdx) {
  const ctx  = getAudioCtx();
  const now  = ctx.currentTime;
  const from = slot[fromIdx].gain.gain;
  const to   = slot[toIdx].gain.gain;

  // Fade out the current track
  from.cancelScheduledValues(now);
  from.setValueAtTime(Math.max(from.value, 0.001), now);
  from.exponentialRampToValueAtTime(0.001, now + FADE_DURATION);

  // Fade in the next track
  to.cancelScheduledValues(now);
  to.setValueAtTime(0.001, now);
  to.exponentialRampToValueAtTime(1.0, now + FADE_DURATION);

  // Once the fade is complete, stop the old slot to free resources
  if (slot[fromIdx].stopTimer) clearTimeout(slot[fromIdx].stopTimer);
  slot[fromIdx].stopTimer = setTimeout(() => {
    stopSlot(fromIdx);
    slot[fromIdx].gain.gain.value = 0;
    transitionInProgress = false;
    if (pendingTrackIndex !== null && pendingTrackIndex !== currentTrackIndex) {
      const next = pendingTrackIndex;
      pendingTrackIndex = null;
      playTrack(next, true);
    }
  }, (FADE_DURATION + 0.15) * 1000);
}

// Main play function.
// crossfadeIn = true  → smooth crossfade from whatever is currently playing
// crossfadeIn = false → hard start (first play, or after a pause)
async function playTrack(index, crossfadeIn = true) {
  if (transitionInProgress && crossfadeIn) {
    pendingTrackIndex = index;
    return;
  }

  const ctx   = getAudioCtx();
  await ctx.resume();

  const track = TRACKS[index];
  if (!track) return;

  if (playerTrack) playerTrack.textContent = track.label;
  currentTrackIndex = index;

  try {
    const buffer   = await loadBuffer(track.src);
    const nextSlot = crossfadeIn ? 1 - activeSlot : activeSlot;

    startSlot(nextSlot, buffer);

    if (crossfadeIn && slot[activeSlot].source) {
      transitionInProgress = true;
      crossfade(activeSlot, nextSlot);
    } else {
      // First play: fade in from silence
      const g   = slot[nextSlot].gain.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(0.001, now);
      g.exponentialRampToValueAtTime(1.0, now + FADE_DURATION);
    }

    activeSlot    = nextSlot;
    playerPlaying = true;
    if (playerPlayBtn) playerPlayBtn.textContent = "⏸";
    if (musicPlayer)   musicPlayer.classList.remove("paused");
    scheduleLoop(index, buffer);

  } catch (err) {
    // Audio file not found — label-only placeholder mode, no crash
    console.warn("MoodWave audio:", err.message);
  }
}

function buildImpulse(ctx, duration = 2.5, decay = 3.0) {
  const rate    = ctx.sampleRate;
  const length  = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function pausePlayer() {
  if (!audioCtx) return;
  clearLoopTimer();
  const ctx = getAudioCtx();
  const g   = slot[activeSlot].gain.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(Math.max(g.value, 0.001), now);
  g.exponentialRampToValueAtTime(0.001, now + 0.4);
  // Suspend the context after the short fade so CPU is released
  setTimeout(() => ctx.suspend(), 500);
  playerPlaying = false;
  if (playerPlayBtn) playerPlayBtn.textContent = "▶";
  if (musicPlayer)   musicPlayer.classList.add("paused");
}

async function resumePlayer() {
  const ctx = getAudioCtx();
  await ctx.resume();
  const g   = slot[activeSlot].gain.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0.001, now);
  g.exponentialRampToValueAtTime(1.0, now + 0.4);
  playerPlaying = true;
  if (playerPlayBtn) playerPlayBtn.textContent = "⏸";
  if (musicPlayer)   musicPlayer.classList.remove("paused");
  const resumeBuf = bufferCache.get(TRACKS[currentTrackIndex]?.src);
  if (resumeBuf) scheduleLoop(currentTrackIndex, resumeBuf);
}

function applyMuteState() {
  if (landingPageAudio) {
    landingPageAudio.muted = isMuted;
  }
  if (audioCtx && masterGain) {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(isMuted ? 0 : 1, now + 0.15);
  }
  if (playerMuteBtn) {
    playerMuteBtn.textContent = isMuted ? "🔇" : "🔊";
    playerMuteBtn.classList.toggle("active", !isMuted);
  }
}

// Called by renderData() every time sensor values update.
// Uses a 2-reading debounce so a single noisy spike doesn't
// cause an unwanted crossfade.
function updatePlayerTrack(time, temp) 
{
  if (isTestLabPage || isLandingPage) return;
  const idx = getTrackIndex(time, temp);

  // Always update the label when not actively playing
  if (!playerPlaying) {
    if (playerTrack) playerTrack.textContent = TRACKS[idx]?.label ?? "";
    currentTrackIndex = idx;
    return;
  }

  // Debounce: only crossfade after two consecutive readings agree on a new track
  if (idx === lastMoodIndex) {
    moodIndexCount++;
  } else {
    lastMoodIndex  = idx;
    moodIndexCount = 1;
  }

  if (idx !== currentTrackIndex && moodIndexCount >= 2) {
    moodIndexCount = 0;
    playTrack(idx, true);
  }
}

function syncTestLabTrack(idx, styleLabel) {
  if (idx < 0 || idx >= TRACKS.length) return;

  if (!playerPlaying) {
    currentTrackIndex = idx;
    if (playerTrack) playerTrack.textContent = TRACKS[idx].label;
    return;
  }

  if (idx !== currentTrackIndex) {
    playTrack(idx, true);
  }
}

// ── Player button handlers ──

if (playerPlayBtn) {
  playerPlayBtn.addEventListener("click", async () => {
    if (isLandingPage && landingPageAudio) {
      if (landingPageAudio.paused) {
        try {
          await landingPageAudio.play();
          playerPlaying = true;
          playerPlayBtn.textContent = "⏸";
          if (musicPlayer) musicPlayer.classList.remove("paused");
        } catch (error) {
          console.warn("MoodWave audio:", error.message);
        }
      } else {
        landingPageAudio.pause();
        playerPlaying = false;
        playerPlayBtn.textContent = "▶";
        if (musicPlayer) musicPlayer.classList.add("paused");
      }
      return;
    }

    // First click ever: create context and start playing
    if (!audioCtx || !slot[activeSlot].source) {
      await playTrack(currentTrackIndex, false);
    } else if (playerPlaying) {
      pausePlayer();
    } else {
      await resumePlayer();
    }
  });
}

if (playerMuteBtn) {
  playerMuteBtn.addEventListener("click", async () => {
    isMuted = !isMuted;
    applyMuteState();

    if (!isMuted && !playerPlaying) {
      if (isLandingPage && landingPageAudio) {
        try {
          await landingPageAudio.play();
          playerPlaying = true;
          if (playerPlayBtn) playerPlayBtn.textContent = "⏸";
          if (musicPlayer) musicPlayer.classList.remove("paused");
        } catch (_) {
          // Browser still blocked playback.
        }
        return;
      }

      try {
        if (!audioCtx || !slot[activeSlot].source) {
          await playTrack(currentTrackIndex, false);
        } else {
          await resumePlayer();
        }
      } catch (_) {
        // Playback can still be blocked until another gesture.
      }
    }
  });
}

if (playerSkipBtn && isLandingPage && landingPageAudio) {
  playerSkipBtn.addEventListener("click", async () => {
    landingTrackIndex = (landingTrackIndex + 1) % LANDING_PLAYLIST.length;
    const nextTrack = LANDING_PLAYLIST[landingTrackIndex];
    if (!nextTrack) return;

    landingPageAudio.src = nextTrack.src;
    if (playerTrack) playerTrack.textContent = nextTrack.label;

    try {
      await landingPageAudio.play();
      playerPlaying = true;
      if (playerPlayBtn) playerPlayBtn.textContent = "⏸";
      if (musicPlayer) musicPlayer.classList.remove("paused");
      applyMuteState();
    } catch (_) {
      playerPlaying = false;
      if (playerPlayBtn) playerPlayBtn.textContent = "▶";
      if (musicPlayer) musicPlayer.classList.add("paused");
    }
  });
}

// ─────────────────────────────────────────────
// TEMPERATURE UNIT TOGGLE
// ─────────────────────────────────────────────
if (unitToggleBtn) {
  unitToggleBtn.addEventListener("click", () => {
    showFahrenheit = !showFahrenheit;
    renderData(
      latestSensorValues.temperature,
      latestSensorValues.humidity,
      latestSensorValues.sound,
      latestSensorValues.brightness
    );
    addEvent(`Temperature unit switched to ${showFahrenheit ? "°F" : "°C"}`);
  });
}

// ─────────────────────────────────────────────
// SENSOR TOGGLES
// ─────────────────────────────────────────────
toggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const sensor = button.dataset.sensor;
    if (!sensor || !(sensor in sensorState)) return;
    sensorState[sensor] = !sensorState[sensor];
    updateSensorCardState();
    addEvent(`${sensor.charAt(0).toUpperCase() + sensor.slice(1)} sensor turned ${sensorState[sensor] ? "on" : "off"}`);

    if (isDashboardPage && window.ws && window.ws.readyState === WebSocket.OPEN) {
      renderData(
        latestSensorValues.temperature,
        latestSensorValues.humidity,
        latestSensorValues.sound,
        latestSensorValues.brightness
      );
    } else {
      renderData(
        latestSensorValues.temperature,
        latestSensorValues.humidity,
        latestSensorValues.sound,
        latestSensorValues.brightness
      );
      if (statusText) statusText.textContent = "Live mode: Waiting for Arduino stream...";
    }
  });
});

// ─────────────────────────────────────────────
// LAB SLIDERS
// ─────────────────────────────────────────────
[labTemp, labLight, labNoise, labHumidity].forEach((el) => {
  if (el) el.addEventListener("input", updateLabOutput);
});

labTimeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setLabTimeOfDay(btn.dataset.time || "Midday");
    updateLabOutput();
  });
});

// ─────────────────────────────────────────────
// GOAL BUTTONS
// ─────────────────────────────────────────────
goalButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedGoal = btn.dataset.goal === "focus" ? "study" : btn.dataset.goal;
    goalButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    updateLabOutput();
  });
});

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    applyPreset(btn.dataset.preset);
  });
});

// ─────────────────────────────────────────────
// SESSION (login/logout nav)
// ─────────────────────────────────────────────
async function loadSession() {
  if (!loginBtn || !sessionUser || !logoutBtn) return;
  try {
    const res  = await fetch("/api/session");
    if (!res.ok) throw new Error("session check failed");
    const data = await res.json();
    if (data.authenticated) {
      sessionUser.textContent   = data.user.username;
      sessionUser.style.display = "inline-block";
      logoutBtn.style.display   = "inline-block";
      loginBtn.style.display    = "none";
      if (signUpBtn) signUpBtn.style.display = "none";
      if (statusText) statusText.textContent = `Logged in as ${data.user.username}. Goals and room profiles saved to your account.`;
      return;
    }
  } catch (_) {
    // no session — defaults below
  }
  sessionUser.style.display = "none";
  logoutBtn.style.display   = "none";
  loginBtn.style.display    = "inline-block";
  if (signUpBtn) signUpBtn.style.display = "inline-block";
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try { await fetch("/api/logout", { method: "POST" }); } catch (_) { /* ignore */ }
    sessionUser.style.display = "none";
    logoutBtn.style.display   = "none";
    if (loginBtn)    loginBtn.style.display    = "inline-block";
    if (signUpBtn)   signUpBtn.style.display   = "inline-block";
    if (statusText)  statusText.textContent    = "Logged out. Create an account to save goals and future room profiles.";
  });
}

// ─────────────────────────────────────────────
// CONTENT PANEL TABS (landing page)
// ─────────────────────────────────────────────
function switchPanel(panelName) {
  document.querySelectorAll(".content-panel").forEach((panel) => {
    panel.classList.remove("active");
  });
  document.querySelectorAll("[data-panel]").forEach((btn) => {
    btn.classList.remove("active");
  });

  const panel = document.getElementById(`panel-${panelName}`);
  if (panel) {
    panel.classList.add("active");
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const btn = document.querySelector(`[data-panel="${panelName}"]`);
  if (btn) btn.classList.add("active");
}

document.querySelectorAll("[data-panel]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    switchPanel(btn.dataset.panel);
  });
});

document.addEventListener("DOMContentLoaded", () => {
  switchPanel("what");
  applyMuteState();

  if (isLandingPage) {
    if (playerTrack) {
      playerTrack.textContent = LANDING_PLAYLIST[landingTrackIndex]?.label || "Chill1.mp3";
    }
    if (playerPlayBtn) playerPlayBtn.textContent = "⏸";
    if (musicPlayer) musicPlayer.classList.remove("paused");
    if (landingPageAudio) {
      landingPageAudio.play()
        .then(() => {
          playerPlaying = true;
        })
        .catch(() => {
          playerPlaying = false;
          if (playerPlayBtn) playerPlayBtn.textContent = "▶";
          if (musicPlayer) musicPlayer.classList.add("paused");
        });
    }
    return;
  }

  playTrack(currentTrackIndex, false)
    .then(() => {
      playerPlaying = true;
    })
    .catch(() => {
      playerPlaying = false;
      if (playerPlayBtn) playerPlayBtn.textContent = "▶";
      if (musicPlayer) musicPlayer.classList.add("paused");

      const unlockAndStart = async () => {
        document.removeEventListener("click", unlockAndStart);
        document.removeEventListener("keydown", unlockAndStart);
        document.removeEventListener("touchstart", unlockAndStart);
        try {
          await playTrack(currentTrackIndex, false);
          playerPlaying = true;
          if (playerPlayBtn) playerPlayBtn.textContent = "⏸";
          if (musicPlayer) musicPlayer.classList.remove("paused");
          applyMuteState();
        } catch (_) {
          // still blocked
        }
      };

      document.addEventListener("click", unlockAndStart);
      document.addEventListener("keydown", unlockAndStart);
      document.addEventListener("touchstart", unlockAndStart);
    });
});

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
loadSession();

if (isTestLabPage) {
  setLabTimeOfDay(selectedLabTimeOfDay);
  updateLabOutput();
}

if (isDashboardPage) {
  renderClock();
  setInterval(renderClock, 1000);
  if (statusText) statusText.textContent = "Live mode: Connecting to Arduino stream...";
}

