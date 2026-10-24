(function () {
  const alertEl = document.getElementById("alert");
  const stepRequest = document.getElementById("stepRequest");
  const stepVerify = document.getElementById("stepVerify");
  const btnRequest = document.getElementById("btnRequest");
  const btnVerify = document.getElementById("btnVerify");
  const btnResend = document.getElementById("btnResend");
  const otpInput = document.getElementById("otpInput");
  const countdownEl = document.getElementById("countdown");
  const maskedEmailEl = document.getElementById("maskedEmail");

  let expiresAt = 0;
  let resendAt = 0;
  let timer = null;

  function showAlert(type, message) {
    if (!message) {
      alertEl.hidden = true;
      alertEl.textContent = "";
      return;
    }
    alertEl.hidden = false;
    alertEl.className = "auth-alert " + type;
    alertEl.textContent = message;
  }

  function setLoading(btn, loading, label) {
    btn.disabled = loading;
    if (label) btn.textContent = label;
  }

  function formatMs(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ":" + String(r).padStart(2, "0");
  }

  function tick() {
    const now = Date.now();
    if (expiresAt) {
      const left = expiresAt - now;
      countdownEl.textContent = formatMs(left);
      if (left <= 0) {
        countdownEl.textContent = "0:00";
        showAlert("error", "O código expirou. Solicite um novo.");
      }
    }
    if (resendAt) {
      const wait = resendAt - now;
      if (wait <= 0) {
        btnResend.disabled = false;
        btnResend.textContent = "Reenviar código";
      } else {
        btnResend.disabled = true;
        btnResend.textContent = "Reenviar código (" + Math.ceil(wait / 1000) + "s)";
      }
    }
  }

  function startTimers(expiresInSec, cooldownSec) {
    const now = Date.now();
    expiresAt = now + expiresInSec * 1000;
    resendAt = now + (cooldownSec || 60) * 1000;
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 250);
    tick();
  }

  async function loadSession() {
    try {
      const res = await fetch("/api/auth/session", { credentials: "same-origin" });
      const data = await res.json();
      if (data.authenticated) {
        window.location.replace("/");
        return;
      }
      if (data.maskedEmail) {
        maskedEmailEl.textContent = "Email: " + data.maskedEmail;
      }
    } catch (_) {
      maskedEmailEl.textContent = "Email: autorizado";
    }
  }

  async function requestCode() {
    showAlert("", "");
    setLoading(btnRequest, true, "A enviar…");
    btnResend.disabled = true;
    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showAlert("error", data.error || "Não foi possível enviar o código.");
        return;
      }
      showAlert("ok", data.message || "Código enviado. Verifique o email.");
      stepRequest.hidden = true;
      stepVerify.hidden = false;
      otpInput.value = "";
      otpInput.focus();
      startTimers(data.expiresInSec || 300, data.resendInSec || 60);
      if (data.maskedEmail) maskedEmailEl.textContent = "Email: " + data.maskedEmail;
    } catch (_) {
      showAlert("error", "Falha de rede. Tente novamente.");
    } finally {
      setLoading(btnRequest, false, "Solicitar código");
    }
  }

  async function verifyCode() {
    const code = (otpInput.value || "").replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      showAlert("error", "Introduza o código de 6 dígitos.");
      return;
    }
    showAlert("", "");
    setLoading(btnVerify, true, "A confirmar…");
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showAlert("error", data.error || "Código inválido ou expirado.");
        return;
      }
      showAlert("ok", "Acesso confirmado. A redirecionar…");
      window.location.replace("/");
    } catch (_) {
      showAlert("error", "Falha de rede. Tente novamente.");
    } finally {
      setLoading(btnVerify, false, "Confirmar código");
    }
  }

  btnRequest.addEventListener("click", requestCode);
  btnResend.addEventListener("click", requestCode);
  btnVerify.addEventListener("click", verifyCode);
  otpInput.addEventListener("input", function () {
    this.value = this.value.replace(/\D/g, "").slice(0, 6);
  });
  otpInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") verifyCode();
  });

  loadSession();
})();
