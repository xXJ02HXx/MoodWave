const statusText = document.getElementById("statusText");
const loginBtn = document.getElementById("loginBtn");
const sessionUser = document.getElementById("sessionUser");
const logoutBtn = document.getElementById("logoutBtn");
const tempValue = document.getElementById("tempValue");
const humidityValue = document.getElementById("humidityValue");
const soundValue = document.getElementById("soundValue");
const brightnessValue = document.getElementById("brightnessValue");
const spaceMood = document.getElementById("spaceMood");

function inferMood(temperature, humidity, sound, brightness) {
  if (sound > 65 || temperature > 28) {
    return "High Energy";
  }
  if (sound < 42 && brightness < 220) {
    return "Calm / Relaxed";
  }
  if (brightness > 480 && humidity < 55) {
    return "Focused";
  }
  return "Balanced Flow";
}

function renderData(temperature, humidity, sound, brightness) {
  if (!tempValue || !humidityValue || !soundValue || !brightnessValue || !spaceMood) {
    return;
  }

  tempValue.textContent = temperature.toFixed(1);
  humidityValue.textContent = humidity.toFixed(0);
  soundValue.textContent = sound.toFixed(0);
  brightnessValue.textContent = brightness.toFixed(0);
  spaceMood.textContent = inferMood(temperature, humidity, sound, brightness);
}

function generatePlaceholderData() {
  const temperature = 20 + Math.random() * 8;
  const humidity = 35 + Math.random() * 30;
  const sound = 34 + Math.random() * 40;
  const brightness = 120 + Math.random() * 700;

  renderData(temperature, humidity, sound, brightness);
}

async function loadSession() {
  if (!loginBtn || !sessionUser || !logoutBtn) {
    return;
  }

  try {
    const response = await fetch("/api/session");
    if (!response.ok) {
      throw new Error("Session check failed");
    }

    const data = await response.json();
    if (data.authenticated) {
      sessionUser.textContent = data.user.username;
      sessionUser.style.display = "inline-block";
      logoutBtn.style.display = "inline-block";
      loginBtn.style.display = "none";
      if (statusText) {
        statusText.textContent = `Logged in as ${data.user.username}. Live mode: Placeholder data active.`;
      }
      return;
    }

    sessionUser.style.display = "none";
    logoutBtn.style.display = "none";
    loginBtn.style.display = "inline-block";
  } catch (error) {
    sessionUser.style.display = "none";
    logoutBtn.style.display = "none";
    loginBtn.style.display = "inline-block";
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      sessionUser.style.display = "none";
      logoutBtn.style.display = "none";
      if (loginBtn) {
        loginBtn.style.display = "inline-block";
      }
      if (statusText) {
        statusText.textContent = "Logged out. Live mode: Placeholder data active.";
      }
    }
  });
}

if (statusText) {
  statusText.textContent = "Live mode: Placeholder data active.";
}

loadSession();
generatePlaceholderData();
setInterval(generatePlaceholderData, 4000);
