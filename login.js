const authForm = document.getElementById("authForm");
const loginMessage = document.getElementById("loginMessage");
const loginModeBtn = document.getElementById("loginModeBtn");
const registerModeBtn = document.getElementById("registerModeBtn");
const submitBtn = document.getElementById("submitBtn");
// Detect if the page is opened directly as a file (file://) rather than through the server.
// This happens when someone double-clicks the HTML file. We redirect them to the real server.
const isFilePreview = window.location.protocol === "file:";
let mode = "login";

// Switch the form between 'login' and 'register' modes.
// Changes the button label and highlights the active tab.
function setMode(nextMode) {
  mode = nextMode;
  if (submitBtn) {
    submitBtn.textContent = mode === "login" ? "Login" : "Create Account";
  }
  if (loginModeBtn && registerModeBtn) {
    if (mode === "login") {
      loginModeBtn.classList.remove("btn-secondary");
      registerModeBtn.classList.add("btn-secondary");
    } else {
      registerModeBtn.classList.remove("btn-secondary");
      loginModeBtn.classList.add("btn-secondary");
    }
  }
}

if (isFilePreview) {
  window.location.href = "http://localhost:3000/login";
}

// Ask the server if there's already a valid session cookie.
// If the user is already logged in, skip this page and go straight to the home page.
async function checkExistingSession() {
  try {
    const response = await fetch("/api/session");
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    if (data.authenticated) {
      window.location.href = "/";
    }
  } catch (error) {
    // Ignore session check errors on login page.
  }
}

if (loginModeBtn) {
  loginModeBtn.addEventListener("click", () => setMode("login"));
}

if (registerModeBtn) {
  registerModeBtn.addEventListener("click", () => setMode("register"));
}

if (authForm && loginMessage) {
  // Intercept the form submit so we can send it as JSON to the API instead of a normal page reload.
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isFilePreview) {
      window.location.href = "http://localhost:3000/login";
      return;
    }

    const formData = new FormData(authForm);
    const payload = {
      username: String(formData.get("username") || "").trim(),
      password: String(formData.get("password") || "")
    };
    const endpoint = mode === "login" ? "/api/login" : "/api/register";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Login failed");
      }

      loginMessage.textContent = "Success. Redirecting...";
      window.location.href = "/";
    } catch (error) {
      loginMessage.textContent = error.message || "Request failed";
    }
  });
}

setMode("login");
checkExistingSession();
