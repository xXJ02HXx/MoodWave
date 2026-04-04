/* ─────────────────────────────────────────────
   MOODWAVE — script.js
   ───────────────────────────────────────────── */

// ── DOM ──
const statusText      = document.getElementById("statusText");
const loginBtn        = document.getElementById("loginBtn");
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
const labTemp         = document.getElementById("labTemp");
const labLight        = document.getElementById("labLight");
const labNoise        = document.getElementById("labNoise");
const labHumidity     = document.getElementById("labHumidity");
const labTempDisplay  = document.getElementById("labTempDisplay");
const labLightValue   = document.getElementById("labLightValue");
const labNoiseValue   = document.getElementById("labNoiseValue");
const labHumidityValue = document.getElementById("labHumidityValue");
const labMusicTitle   = document.getElementById("labMusicTitle");
const labMusicSummary = document.getElementById("labMusicSummary");
const labRoomType     = document.getElementById("labRoomType");
const labGoalValue    = document.getElementById("labGoalValue");
const labMusicStyle   = document.getElementById("labMusicStyle");
const labEnergy       = document.getElementById("labEnergy");
const goalButtons     = document.querySelectorAll(".goal-btn");
const presetButtons   = document.querySelectorAll(".preset-btn");

// Music player
const playerTrack     = document.getElementById("playerTrack");
const playerPlayBtn   = document.getElementById("playerPlayBtn");
const playerSkipBtn   = document.getElementById("playerSkipBtn");
const musicPlayer     = document.getElementById("musicPlayer");

// ── STATE ──
const sensorState = { temperature: true, humidity: true, sound: true, brightness: true };
const latestSensorValues = { temperature: 23, humidity: 48, sound: 40, brightness: 380 };

const events = [];
let selectedGoal  = "study";
let showFahrenheit = false;
let playerPlaying = true;

// ─────────────────────────────────────────────
// TEMPERATURE HELPERS
// ─────────────────────────────────────────────
function cToF(c) { return c * 9 / 5 + 32; }

function tempClass(celsius) {
  if (celsius <= 0)        return "temp-ice";
  if (celsius <= 8)        return "temp-cold";
  if (celsius <= 17)       return "temp-cool";
  if (celsius <= 24)       return "temp-ok";
  if (celsius <= 30)       return "temp-warm";
  if (celsius <= 36)       return "temp-hot";
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
  if (sound < 42 && brightness < 220)  return "Calm / Relaxed";
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
  if (condition === "Hot and stuffy")   return "Lower heat or add cooler audio textures to reduce fatigue.";
  if (condition === "Overstimulated")   return "Noise is pushing the room hard. Shift toward calmer layers.";
  if (mood === "Focused")               return "The room is suitable for deep work and clean rhythmic focus tracks.";
  if (mood === "Calm / Relaxed")        return "This room favors softer ambient music and lower percussion density.";
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

// ─────────────────────────────────────────────
// CLOCK
// ─────────────────────────────────────────────
function renderClock() {
  const now  = new Date();
  if (dashboardClock) dashboardClock.textContent = now.toLocaleTimeString();
  if (dayPhase) {
    const h = now.getHours();
    dayPhase.textContent = h < 6 ? "Late Night" : h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  }
}

// ─────────────────────────────────────────────
// RENDER SENSOR DATA
// ─────────────────────────────────────────────
function renderData(temperature, humidity, sound, brightness) {
  latestSensorValues.temperature = temperature;
  latestSensorValues.humidity    = humidity;
  latestSensorValues.sound       = sound;
  latestSensorValues.brightness  = brightness;

  // Temperature — with unit toggle
  if (tempValueEl) {
    if (sensorState.temperature) {
      if (showFahrenheit) {
        tempValueEl.textContent = cToF(temperature).toFixed(1);
      } else {
        tempValueEl.textContent = temperature.toFixed(1);
      }
    } else {
      tempValueEl.textContent = "OFF";
    }
  }
  if (tempUnitEl) tempUnitEl.textContent = showFahrenheit ? "°F" : "°C";
  if (unitToggleBtn) unitToggleBtn.textContent = showFahrenheit ? "°C" : "°F";

  // Apply temperature card background
  if (sensorState.temperature) applyTempStyling(temperature);

  if (humidityValue)   humidityValue.textContent   = sensorState.humidity    ? humidity.toFixed(0)   : "OFF";
  if (soundValue)      soundValue.textContent       = sensorState.sound       ? sound.toFixed(0)      : "OFF";
  if (brightnessValue) brightnessValue.textContent  = sensorState.brightness  ? brightness.toFixed(0) : "OFF";

  const mood      = inferMood(temperature, humidity, sound, brightness);
  const condition = inferRoomCondition(temperature, humidity, sound, brightness);

  if (spaceMood)    spaceMood.textContent    = mood;
  if (roomCondition) roomCondition.textContent = condition;
  if (spaceAdvice)  spaceAdvice.textContent  = inferAdvice(condition, mood);

  // Keep player track in sync with live mood
  updatePlayerTrack(mood, condition);
}

// ─────────────────────────────────────────────
// PLACEHOLDER DATA GENERATOR
// ─────────────────────────────────────────────
function generatePlaceholderData() {
  const temperature = sensorState.temperature ? 20 + Math.random() * 14  : latestSensorValues.temperature;
  const humidity    = sensorState.humidity    ? 35 + Math.random() * 32  : latestSensorValues.humidity;
  const sound       = sensorState.sound       ? 28 + Math.random() * 52  : latestSensorValues.sound;
  const brightness  = sensorState.brightness  ? 100 + Math.random() * 760 : latestSensorValues.brightness;
  renderData(temperature, humidity, sound, brightness);
  if (eventTimer) eventTimer.textContent = `Updated ${new Date().toLocaleTimeString()}`;
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
    // Clear temp class if temperature sensor is off
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

function generateMusicProfile(temperature, light, noise, humidity, goal) {
  const roomType = inferRoomCondition(temperature, humidity, noise, light);
  let title   = "Balanced Flow";
  let summary = "MoodWave would blend measured rhythm, soft texture, and moderate energy.";
  let style   = "Adaptive ambient pulse";
  let energy  = "Medium";

  if (goal === "study" || goal === "focus") {
    title   = noise > 60 ? "Shielded Focus" : "Focused Pulse";
    summary = "Tight rhythmic layers and clear high-frequency control keep the room aimed at concentration.";
    style   = "Calm electronic focus";
    energy  = light > 600 ? "Medium-high" : "Medium";
  } else if (goal === "relax" || goal === "meditate") {
    title   = "Calm Drift";
    summary = "Long pads, softer bass motion, and slow transitions reduce tension in the room.";
    style   = "Warm ambient calm";
    energy  = "Low";
  } else if (goal === "workout") {
    title   = "Drive Mode";
    summary = "A stronger pulse and brighter musical accents push the room toward motion and energy.";
    style   = "High-energy rhythm";
    energy  = "High";
  } else if (goal === "irritate") {
    title   = "Chaotic Spike";
    summary = "MoodWave deliberately produces unstable intensity, sharp shifts, and uncomfortable pressure.";
    style   = "Harsh disruptive textures";
    energy  = "Extreme";
  }

  if (roomType === "Hot and stuffy") {
    summary = "The room feels hot and heavy. MoodWave offsets that with lighter textures and more air in the mix.";
  }
  if (roomType === "Overstimulated" && goal !== "workout") {
    title  = "Noise Recovery";
    style  = "Low-clutter ambient control";
    energy = "Low";
  }

  return { roomType, title, summary, style, energy };
}

function updateLabOutput() {
  if (!labTemp || !labLight || !labNoise || !labHumidity) return;

  const temperature = Number(labTemp.value);
  const light       = Number(labLight.value);
  const noise       = Number(labNoise.value);
  const humidity    = Number(labHumidity.value);
  const fahr        = cToF(temperature).toFixed(0);
  const profile     = generateMusicProfile(temperature, light, noise, humidity, selectedGoal);

  if (labTempDisplay)  labTempDisplay.textContent  = `${temperature}°C / ${fahr}°F`;
  if (labLightValue)   labLightValue.textContent   = `${light} lux`;
  if (labNoiseValue)   labNoiseValue.textContent   = noiseLabel(noise);
  if (labHumidityValue) labHumidityValue.textContent = `${humidity}%`;
  if (labMusicTitle)   labMusicTitle.textContent   = profile.title;
  if (labMusicSummary) labMusicSummary.textContent = profile.summary;
  if (labRoomType)     labRoomType.textContent     = profile.roomType;
  if (labGoalValue)    labGoalValue.textContent    = selectedGoal.charAt(0).toUpperCase() + selectedGoal.slice(1);
  if (labMusicStyle)   labMusicStyle.textContent   = profile.style;
  if (labEnergy)       labEnergy.textContent       = profile.energy;

  // Sync lab result to player
  if (playerTrack) playerTrack.textContent = `${profile.title} — ${profile.style}`;
}

function applyPreset(presetName) {
  if (!labTemp || !labLight || !labNoise || !labHumidity) return;

  const presets = {
    sauna:      { temperature: 42, light: 380, noise: 24, humidity: 82, goal: "relax" },
    igloo:      { temperature: 2,  light: 700, noise: 12, humidity: 30, goal: "focus" },
    massage:    { temperature: 27, light: 170, noise: 18, humidity: 55, goal: "meditate" },
    library:    { temperature: 22, light: 450, noise: 16, humidity: 42, goal: "study" },
    coffee:     { temperature: 24, light: 520, noise: 56, humidity: 48, goal: "focus" },
    nightclub:  { temperature: 31, light: 120, noise: 88, humidity: 64, goal: "workout" }
  };

  const preset = presets[presetName];
  if (!preset) return;

  labTemp.value = String(preset.temperature);
  labLight.value = String(preset.light);
  labNoise.value = String(preset.noise);
  labHumidity.value = String(preset.humidity);
  selectedGoal = preset.goal;

  goalButtons.forEach((b) => {
    b.classList.toggle("active", b.dataset.goal === selectedGoal);
  });

  addEvent(`Preset applied: ${presetName}`);
  updateLabOutput();
}

// ─────────────────────────────────────────────
// MUSIC PLAYER
// ─────────────────────────────────────────────
const PLACEHOLDER_TRACKS = [
  "Focused Pulse — Calm electronic focus",
  "Calm Drift — Warm ambient calm",
  "Drive Mode — High-energy rhythm",
  "Blue Hour — Deep ambient textures",
  "Rain Logic — Lo-fi focus blend",
  "Clear Signal — Minimal work state",
  "Late Current — Evening wind-down",
  "Noon Charge — Bright mid-energy pop",
];
let currentTrackIndex = 0;

function updatePlayerTrack(mood, condition) {
  const map = {
    "Focused":       "Clear Signal — Minimal work state",
    "High Energy":   "Drive Mode — High-energy rhythm",
    "Calm / Relaxed":"Calm Drift — Warm ambient calm",
    "Balanced Flow": "Noon Charge — Bright mid-energy pop",
  };
  if (playerTrack && playerPlaying) {
    const track = map[mood] || PLACEHOLDER_TRACKS[currentTrackIndex];
    if (condition === "Hot and stuffy") {
      playerTrack.textContent = "Blue Hour — Deep ambient textures";
    } else {
      playerTrack.textContent = track;
    }
  }
}

if (playerPlayBtn) {
  playerPlayBtn.addEventListener("click", () => {
    playerPlaying = !playerPlaying;
    playerPlayBtn.textContent = playerPlaying ? "⏸" : "▶";
    if (musicPlayer) musicPlayer.classList.toggle("paused", !playerPlaying);
  });
}

if (playerSkipBtn) {
  playerSkipBtn.addEventListener("click", () => {
    currentTrackIndex = (currentTrackIndex + 1) % PLACEHOLDER_TRACKS.length;
    if (playerTrack) playerTrack.textContent = PLACEHOLDER_TRACKS[currentTrackIndex];
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
    generatePlaceholderData();
  });
});

// ─────────────────────────────────────────────
// LAB SLIDERS
// ─────────────────────────────────────────────
[labTemp, labLight, labNoise, labHumidity].forEach((el) => {
  if (el) el.addEventListener("input", updateLabOutput);
});

// ─────────────────────────────────────────────
// GOAL BUTTONS
// ─────────────────────────────────────────────
goalButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedGoal = btn.dataset.goal;
    goalButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    updateLabOutput();
  });
});

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const presetName = btn.dataset.preset;
    applyPreset(presetName);
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
      sessionUser.textContent      = data.user.username;
      sessionUser.style.display    = "inline-block";
      logoutBtn.style.display      = "inline-block";
      loginBtn.style.display       = "none";
      if (statusText) statusText.textContent = `Logged in as ${data.user.username}. Goals and room profiles saved to your account.`;
      return;
    }
  } catch (_) {
    // no session — defaults below
  }
  sessionUser.style.display = "none";
  logoutBtn.style.display   = "none";
  loginBtn.style.display    = "inline-block";
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try { await fetch("/api/logout", { method: "POST" }); } catch (_) { /* ignore */ }
    sessionUser.style.display = "none";
    logoutBtn.style.display   = "none";
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (statusText) statusText.textContent = "Logged out. Create an account to save goals and future room profiles.";
  });
}

// ─────────────────────────────────────────────
// CONTENT PANEL TABS (landing page)
// ─────────────────────────────────────────────
function switchPanel(panelName) {
  // Hide all panels
  document.querySelectorAll(".content-panel").forEach((panel) => {
    panel.classList.remove("active");
  });
  
  // Deactivate all buttons
  document.querySelectorAll("[data-panel]").forEach((btn) => {
    btn.classList.remove("active");
  });
  
  // Show selected panel
  const panel = document.getElementById(`panel-${panelName}`);
  if (panel) {
    panel.classList.add("active");
    // Scroll panel into view with less aggressive offset
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  
  // Highlight selected button
  const btn = document.querySelector(`[data-panel="${panelName}"]`);
  if (btn) {
    btn.classList.add("active");
  }
}

// Attach click listeners to all data-panel buttons
document.querySelectorAll("[data-panel]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const panelName = btn.dataset.panel;
    switchPanel(panelName);
  });
});

// Set default active panel on page load
document.addEventListener("DOMContentLoaded", () => {
  switchPanel("what");
});

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
loadSession();
updateLabOutput();
generatePlaceholderData();
renderClock();
setInterval(renderClock, 1000);
setInterval(generatePlaceholderData, 4000);
