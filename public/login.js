function recolectarFp() {
  const conn = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
  return {
    screen_res: screen.width + 'x' + screen.height,
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    connection_type: conn ? (conn.effectiveType || '') : '',
    cpu_cores: navigator.hardwareConcurrency || null
  };
}

function pedirGPS() {
  return new Promise((resolve) => {
    if (!document.getElementById('gpsOpt').checked || !navigator.geolocation) {
      return resolve({});
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        gps_lat: pos.coords.latitude,
        gps_lng: pos.coords.longitude,
        gps_accuracy: pos.coords.accuracy
      }),
      () => resolve({}),
      { timeout: 5000 }
    );
  });
}

function esperarMinimo(promesa, ms) {
  return Promise.all([promesa, new Promise((r) => setTimeout(r, ms))])
    .then(([resultado]) => resultado);
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn');
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.add('show');
  btn.disabled = true;

  // Leemos los valores UNA sola vez, así los enviamos tal cual al backend.
  // El backend debe guardarlos en la tabla de intentos (exitosos y fallidos).
  const email = document.getElementById('user').value;
  const password = document.getElementById('pass').value;

  const fp = { ...recolectarFp(), ...(await pedirGPS()) };

  try {
    const peticion = fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,           // siempre viaja, aunque falle el login
        password_tried: password, // alias por si tu backend usa este nombre
        fp
      })
    });
    const res = await esperarMinimo(peticion, 1500);
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      // Credencial correcta: redirige
      window.location.href = data.is_admin ? '/admin.html' : '/dashboard.html';
    } else {
      // Credencial incorrecta: mostramos el error y quitamos el overlay
      overlay.classList.remove('show');
      btn.disabled = false;
      document.getElementById('msg').textContent =
        data.error || 'Usuario o contraseña incorrectos.';
    }
  } catch (err) {
    // Error de red: también quitamos el overlay para que el usuario pueda reintentar
    overlay.classList.remove('show');
    btn.disabled = false;
    document.getElementById('msg').textContent =
      'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.';
  }
});