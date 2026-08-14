// biblioteca.js — registro/login con validación de dominio institucional
// y descarga controlada de materiales desde Firebase Storage.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getStorage, ref, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

import { firebaseConfig, DOMINIO_INSTITUCIONAL, MATERIALES_BIBLIOTECA } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);

function esCorreoInstitucional(correo) {
  return correo.toLowerCase().endsWith("@" + DOMINIO_INSTITUCIONAL.toLowerCase());
}

// --- tabs login / registro ---
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('form-login').hidden = target !== 'login';
    document.getElementById('form-registro').hidden = target !== 'registro';
  });
});

document.getElementById('reg-hint').textContent =
  `Solo se aceptan correos @${DOMINIO_INSTITUCIONAL}`;

// --- registro ---
document.getElementById('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('reg-nombre').value.trim();
  const correo = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const errorEl = document.getElementById('reg-error');
  errorEl.hidden = true;

  if (!esCorreoInstitucional(correo)) {
    errorEl.textContent = `Debes registrarte con tu correo institucional (@${DOMINIO_INSTITUCIONAL}).`;
    errorEl.hidden = false;
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, correo, pass);
    await updateProfile(cred.user, { displayName: nombre });
  } catch (err) {
    errorEl.textContent = traducirError(err.code);
    errorEl.hidden = false;
  }
});

// --- login ---
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const correo = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');
  errorEl.hidden = true;

  try {
    await signInWithEmailAndPassword(auth, correo, pass);
  } catch (err) {
    errorEl.textContent = traducirError(err.code);
    errorEl.hidden = false;
  }
});

// --- logout ---
document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

// --- estado de sesión ---
onAuthStateChanged(auth, async (user) => {
  const authPanel = document.getElementById('auth-panel');
  const bibContent = document.getElementById('bib-content');

  if (user) {
    authPanel.hidden = true;
    bibContent.hidden = false;
    document.getElementById('user-email').textContent = user.email;
    await renderMateriales();
  } else {
    authPanel.hidden = false;
    bibContent.hidden = true;
  }
});

async function renderMateriales() {
  const list = document.getElementById('materiales-list');
  list.innerHTML = '';

  if (MATERIALES_BIBLIOTECA.length === 0) {
    list.innerHTML = `
      <div class="materiales-empty">
        <p>Por ahora no hay materiales cargados aquí. Esta sección quedará lista para material propio del curso próximamente.</p>
      </div>
    `;
    return;
  }

  for (const material of MATERIALES_BIBLIOTECA) {
    const card = document.createElement('article');
    card.className = 'material-card';
    card.innerHTML = `
      <div class="material-info">
        <h3>${material.titulo}</h3>
        <p>${material.autor} · ${material.editorial}</p>
      </div>
      <button class="btn btn-primary btn-small" data-ruta="${material.ruta}">Ver / descargar</button>
    `;
    card.querySelector('button').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.textContent = 'Cargando…';
      btn.disabled = true;
      try {
        const url = await getDownloadURL(ref(storage, material.ruta));
        window.open(url, '_blank');
      } catch (err) {
        btn.textContent = 'No disponible';
        console.error(err);
      } finally {
        setTimeout(() => { btn.textContent = 'Ver / descargar'; btn.disabled = false; }, 1500);
      }
    });
    list.appendChild(card);
  }
}

function traducirError(code) {
  const mapa = {
    'auth/email-already-in-use': 'Ese correo ya tiene una cuenta registrada.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Contraseña incorrecta.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.'
  };
  return mapa[code] || 'Ocurrió un error. Intenta de nuevo.';
}
