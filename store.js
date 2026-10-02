/* =========================================================
   Finances perso — stockage Supabase des pages de l'application
   1. Vérifie la connexion : sans session, renvoi vers login.html.
   2. Charge transactions, catégories et soldes de départ en mémoire.
   3. Lance alors le script de la page (attribut data-app), qui lit
      ces données de façon synchrone via les load*() de shared.js.
   Les save*() de shared.js passent ici : les écritures partent vers
   Supabase dans une file, une à la fois, dans l'ordre.
   ========================================================= */

'use strict';

/** Taille d'une page de lecture : 1000 est le maximum renvoyé par défaut par Supabase. */
const READ_PAGE = 1000;

/** Taille des lots d'écriture, pour garder des requêtes raisonnables. */
const UPSERT_BATCH = 500;
const DELETE_BATCH = 100;

/** Marqueur d'une ligne dont l'écriture a échoué : elle sera renvoyée à la prochaine sauvegarde. */
const STALE = '\u0000stale';

/** Données chargées depuis Supabase, servies aux load*() de shared.js. */
const cloud = {
  userId: null,
  transactions: [],
  categories: {},    // { type: [libellés] }, seulement les types enregistrés
  accounts: {},      // { courant, epargne }, seulement les comptes enregistrés
  /** Dernier état connu côté serveur : id -> ligne sérialisée. Sert au calcul des différences. */
  txSnapshot: new Map(),
};

/* ---------------------------------------------------------
   Conversion transaction <-> ligne de la table
   --------------------------------------------------------- */

function toRow(tx) {
  return {
    user_id: cloud.userId,
    id: String(tx.id),
    type: tx.type,
    name: String(tx.name),
    amount: Number(tx.amount),
    category: String(tx.category),
    date: tx.date,
    created_at_ms: Math.round(Number(tx.createdAt) || 0),
    linked_expense_id: tx.linkedExpenseId ?? null,
    direction: tx.direction ?? null,
  };
}

/** Recrée l'objet utilisé par l'app : les champs optionnels restent absents s'ils sont vides. */
function fromRow(row) {
  const tx = {
    id: row.id,
    type: row.type,
    name: row.name,
    amount: Number(row.amount),
    category: row.category,
    date: row.date,
    createdAt: Number(row.created_at_ms),
  };
  if (row.linked_expense_id) tx.linkedExpenseId = row.linked_expense_id;
  if (row.direction) tx.direction = row.direction;
  return tx;
}

/* ---------------------------------------------------------
   Lecture
   --------------------------------------------------------- */

/** Lève l'erreur d'une réponse Supabase, pour la traiter dans un seul catch. */
function check({ data, error }) {
  if (error) throw error;
  return data;
}

/** Lit toute une table, page par page (Supabase plafonne chaque réponse). */
async function fetchAll(table, orderColumns) {
  const rows = [];

  for (let from = 0; ; from += READ_PAGE) {
    let query = sb.from(table).select('*');
    for (const column of orderColumns) query = query.order(column);

    const page = check(await query.range(from, from + READ_PAGE - 1));
    rows.push(...page);
    if (page.length < READ_PAGE) return rows;
  }
}

async function loadCloud() {
  const [txRows, catRows, accRows] = await Promise.all([
    fetchAll('transactions', ['created_at_ms', 'id']),
    fetchAll('categories', ['type']),
    fetchAll('accounts', ['account']),
  ]);

  cloud.transactions = txRows.map(fromRow);
  for (const tx of cloud.transactions) cloud.txSnapshot.set(tx.id, JSON.stringify(toRow(tx)));

  for (const row of catRows) cloud.categories[row.type] = row.labels ?? [];
  for (const row of accRows) cloud.accounts[row.account] = Number(row.start_balance);
}

/* ---------------------------------------------------------
   Écriture : file d'attente
   --------------------------------------------------------- */

let writeQueue = Promise.resolve();
let pendingWrites = 0;

/**
 * Ajoute une écriture à la file. Une erreur affiche le bandeau sans casser la suite.
 * @returns {Promise<boolean>} vrai si l'écriture a réussi
 */
function enqueue(label, op) {
  pendingWrites += 1;

  const run = writeQueue
    .then(op)
    .then(
      () => true,
      (err) => {
        console.error(label, err);
        showCloudError(`${label} : ${describeError(err)}. Rechargez la page pour vérifier ce qui a été enregistré.`);
        return false;
      },
    )
    .finally(() => { pendingWrites -= 1; });

  writeQueue = run;
  return run;
}

/** Attend que toutes les écritures en cours soient terminées. */
function flushWrites() {
  return writeQueue;
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Enregistre la liste complète des transactions. Seules les différences avec le
 * dernier état connu partent vers Supabase : lignes nouvelles ou modifiées, et
 * lignes disparues.
 */
function cloudSaveTransactions(list) {
  cloud.transactions = list.map((tx) => ({ ...tx }));

  const next = new Map(list.map((tx) => [String(tx.id), toRow(tx)]));
  const upserts = [];
  const deletes = [];

  for (const [id, row] of next) {
    const serialized = JSON.stringify(row);
    if (cloud.txSnapshot.get(id) === serialized) continue;
    upserts.push(row);
    cloud.txSnapshot.set(id, serialized);
  }

  for (const id of [...cloud.txSnapshot.keys()]) {
    if (next.has(id)) continue;
    deletes.push(id);
    cloud.txSnapshot.delete(id);
  }

  if (!upserts.length && !deletes.length) return Promise.resolve(true);

  return enqueue('Enregistrement des transactions impossible', async () => {
    try {
      for (const ids of chunks(deletes, DELETE_BATCH)) {
        check(await sb.from('transactions').delete().in('id', ids));
      }
      for (const rows of chunks(upserts, UPSERT_BATCH)) {
        check(await sb.from('transactions').upsert(rows, { onConflict: 'user_id,id' }));
      }
    } catch (err) {
      // Ces lignes seront comparées comme « inconnues » et renvoyées à la prochaine sauvegarde.
      for (const row of upserts) cloud.txSnapshot.set(row.id, STALE);
      for (const id of deletes) cloud.txSnapshot.set(id, STALE);
      throw err;
    }
  });
}

/** Enregistre les catégories : une ligne par type. */
function cloudSaveCategories(map) {
  cloud.categories = structuredClone(map);

  const rows = Object.entries(map).map(([type, labels]) => ({ user_id: cloud.userId, type, labels }));

  return enqueue('Enregistrement des catégories impossible', async () => {
    check(await sb.from('categories').upsert(rows, { onConflict: 'user_id,type' }));
  });
}

/** Enregistre les soldes de départ : une ligne par compte. */
function cloudSaveAccounts(start) {
  cloud.accounts = { ...start };

  const rows = Object.entries(start).map(([account, value]) => ({
    user_id: cloud.userId,
    account,
    start_balance: Number(value) || 0,
  }));

  return enqueue('Enregistrement des soldes de départ impossible', async () => {
    check(await sb.from('accounts').upsert(rows, { onConflict: 'user_id,account' }));
  });
}

/* ---------------------------------------------------------
   Navigation et déconnexion
   --------------------------------------------------------- */

/** Une écriture en cours serait coupée par un changement de page : on la laisse finir. */
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link || !pendingWrites || event.defaultPrevented) return;

  event.preventDefault();
  flushWrites().then(() => { window.location.href = link.href; });
});

window.addEventListener('beforeunload', (event) => {
  if (!pendingWrites) return;
  event.preventDefault();
  event.returnValue = '';
});

/** Retour à la page de connexion, une seule fois même si plusieurs causes le demandent. */
let leaving = false;
function goToLogin() {
  if (leaving) return;
  leaving = true;
  window.location.replace('login.html');
}

async function logout(button) {
  button.disabled = true;
  await flushWrites();

  const { error } = await sb.auth.signOut();
  if (error) {
    button.disabled = false;
    return showCloudError(`Déconnexion impossible : ${describeError(error)}.`);
  }
  goToLogin();
}

/* ---------------------------------------------------------
   Démarrage
   --------------------------------------------------------- */

/** Script de la page à lancer une fois les données prêtes (lu tant que currentScript est valide). */
const APP_SCRIPT = document.currentScript?.dataset.app;

async function boot() {
  if (!sb) {
    return showCloudError('Le module Supabase n’a pas pu être chargé. Vérifiez votre connexion internet puis rechargez la page.');
  }

  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) return goToLogin();

  cloud.userId = data.session.user.id;

  // Session expirée ou fermée dans un autre onglet : retour à la connexion.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') goToLogin();
  });

  // Branché avant le chargement : on doit pouvoir se déconnecter même s'il échoue.
  const logoutBtn = document.getElementById('logoutBtn');
  logoutBtn?.addEventListener('click', () => logout(logoutBtn));

  try {
    await loadCloud();
  } catch (err) {
    console.error('Chargement Supabase impossible', err);
    return showCloudError(`Impossible de charger vos données : ${describeError(err)}. Rechargez la page pour réessayer.`);
  }

  // Les données sont là : on affiche la page et on lance son script.
  document.documentElement.removeAttribute('data-auth');
  const script = document.createElement('script');
  script.src = APP_SCRIPT;
  document.body.appendChild(script);
}

boot();
