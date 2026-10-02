/* =========================================================
   Finances perso — connexion à Supabase
   Partagé par la page de connexion et les pages de l'application.
   Le client vient du CDN (balise <script> chargée juste avant) et
   s'expose sous le nom global `supabase` ; le nôtre s'appelle `sb`.
   ========================================================= */

'use strict';

const SUPABASE_URL = 'https://odfipvjapirsdrcahqvo.supabase.co';

/*
 * Clé « publishable » : publique par conception, elle peut figurer dans le code.
 * La protection des données repose sur la Row Level Security (supabase/schema.sql).
 * Ne jamais mettre ici une clé secrète ou service_role.
 */
const SUPABASE_KEY = 'sb_publishable_COB_Tpz3MNiOxuLRCHh7TQ_yQrz3SpL';

/** Client Supabase, ou null si le script du CDN n'a pas pu être chargé. */
const sb = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY) ?? null;

/** Texte lisible d'une erreur Supabase ou réseau. */
function describeError(err) {
  const message = err?.message ?? String(err);
  return /failed to fetch|networkerror|load failed/i.test(message)
    ? 'serveur injoignable, vérifiez votre connexion internet'
    : message;
}

/**
 * Bandeau d'erreur fixé en bas de l'écran, visible quelle que soit la page.
 * Un nouveau message remplace le précédent.
 */
function showCloudError(message) {
  let banner = document.querySelector('.cloud-banner');

  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'cloud-banner';
    banner.setAttribute('role', 'alert');

    const text = document.createElement('p');
    text.className = 'cloud-banner-text';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cloud-banner-close';
    close.setAttribute('aria-label', 'Fermer le message');
    close.textContent = '×';
    close.addEventListener('click', () => banner.remove());

    banner.append(text, close);
    document.body.appendChild(banner);
  }

  banner.querySelector('.cloud-banner-text').textContent = message;
}
