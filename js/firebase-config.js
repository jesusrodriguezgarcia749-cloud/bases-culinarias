// firebase-config.js
//
// Authentication (correo/contraseña) ya está activo en el proyecto real de
// Firebase. Storage NO se está usando por ahora: Firebase exige el plan
// Blaze (con tarjeta registrada) para habilitarlo, y se decidió no alojar
// los libros de referencia de terceros por costo y por derechos de autor.
// La biblioteca queda lista para alojar material propio en el futuro si
// se decide activar Storage más adelante.
//
// IMPORTANTE: cambia DOMINIO_INSTITUCIONAL por el dominio real de correo
// de tus alumnos. Solo se permitirá registro con correos que terminen en
// ese dominio.

export const firebaseConfig = {
  apiKey: "AIzaSyCrn6_dvsj1qPvTYx05ztaW3R4p_7bGQQ0",
  authDomain: "bases-culinarias.firebaseapp.com",
  projectId: "bases-culinarias",
  storageBucket: "bases-culinarias.firebasestorage.app",
  messagingSenderId: "810616202608",
  appId: "1:810616202608:web:5a47712549207a9d0fdbb5"
};

export const DOMINIO_INSTITUCIONAL = "itesrenedescartes.edu.mx"; // ← AJUSTAR

// Sin materiales de terceros por ahora (ver nota arriba). Cuando haya
// material propio para alojar, se puede activar Storage (plan Blaze,
// gratis dentro de límites generosos) y llenar esta lista de nuevo.
export const MATERIALES_BIBLIOTECA = [];
