/* =========================================================
   Finances perso — page de connexion
   E-mail + mot de passe via Supabase Auth. Pas d'inscription :
   le compte est créé à la main dans le tableau de bord Supabase.
   ========================================================= */

'use strict';

const loginForm  = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passInput  = document.getElementById('password');
const loginError = document.getElementById('loginError');
const loginBtn   = document.getElementById('loginBtn');

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

/** Messages Supabase les plus courants, traduits. */
function loginMessage(error) {
  const message = error?.message ?? '';
  if (/invalid login credentials/i.test(message)) return 'E-mail ou mot de passe incorrect.';
  if (/email not confirmed/i.test(message)) {
    return 'Cette adresse e-mail n’est pas confirmée. Confirmez-la dans Supabase (Authentication > Users).';
  }
  return `Connexion impossible : ${describeError(error)}.`;
}

async function handleLogin(event) {
  event.preventDefault();
  loginError.hidden = true;

  const email = emailInput.value.trim();
  const password = passInput.value;
  if (!email || !password) return showLoginError('Merci de saisir votre e-mail et votre mot de passe.');

  loginBtn.disabled = true;
  loginBtn.textContent = 'Connexion…';

  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Se connecter';
    return showLoginError(loginMessage(error));
  }

  window.location.replace('index.html');
}

async function initLogin() {
  if (!sb) {
    loginBtn.disabled = true;
    return showLoginError('Le module Supabase n’a pas pu être chargé. Vérifiez votre connexion internet puis rechargez la page.');
  }

  // Déjà connecté : inutile de rester ici.
  const { data } = await sb.auth.getSession();
  if (data.session) return window.location.replace('index.html');

  loginForm.addEventListener('submit', handleLogin);
}

initLogin();
