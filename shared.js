/* =========================================================
   Finances perso — socle commun aux pages Transactions et Dashboard
   Constantes, formatteurs et accès au stockage, partagés pour
   éviter toute divergence entre les deux pages.
   Chargé en script classique (pas de module) : fonctionne en file://.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   Configuration
   --------------------------------------------------------- */

const STORAGE_KEY = 'finances-perso.transactions.v1';

/** Clé dédiée aux catégories personnalisées, séparée de celle des transactions. */
const CATEGORIES_KEY = 'finances-perso.categories.v1';

/** Clé dédiée aux soldes de départ des comptes. */
const ACCOUNTS_KEY = 'finances-perso.accounts.v1';

/** Libellés lisibles des types (clé interne -> affichage). */
const TYPES = {
  depense:        'Dépense',
  revenu:         'Revenu',
  investissement: 'Investissement',
  transfert:      'Transfert',
};

/** Initiale affichée dans la pastille de chaque ligne. */
const TYPE_INITIALS = {
  depense:        'D',
  revenu:         'R',
  investissement: 'I',
  transfert:      'T',
};

/** Catégorie de secours, toujours présente et toujours en dernier. */
const FALLBACK_CATEGORY = 'Autre';

/**
 * Catégories livrées par défaut, utilisées tant que l'utilisateur n'a rien personnalisé.
 */
const DEFAULT_CATEGORIES = {
  revenu:         ['Salaire', 'Pension', 'Cadeau', 'Intérêts', 'Autre'],
  depense:        ['Loyer', 'Bar/Restaurant', 'Courses', 'Autre'],
  investissement: ['Actions', 'ETF', 'Crypto', 'Obligations', 'Autre'],
  transfert:      ['Interne', 'Externe', 'Autre'],
};

/** Libellés courts des 12 mois, dans l'ordre (index = numéro de mois, 0 = janvier). */
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

/** Signe appliqué au montant selon le type, pour le solde et l'affichage. */
const SIGNS = {
  revenu:          1,
  depense:        -1,
  investissement: -1,   // sortie du compte courant vers un support d'investissement
  transfert:       0,   // neutre : ni gain ni perte
};

/* ---------------------------------------------------------
   Raccourcis DOM
   --------------------------------------------------------- */

const $ = (selector, scope = document) => scope.querySelector(selector);

/** Crée un élément avec sa classe et son texte en une ligne. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------------------------------------------------------
   Persistance (localStorage)
   --------------------------------------------------------- */

/** Charge les transactions, en tolérant un stockage indisponible ou corrompu. */
function loadTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // Navigation privée, stockage bloqué ou JSON invalide : on repart d'une liste vide.
    console.warn('Lecture du stockage impossible, démarrage à vide.', err);
    return [];
  }
}

/** Sauvegarde la liste. Une erreur d'écriture ne doit pas casser l'interface. */
function saveTransactions(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Écriture du stockage impossible, les données ne survivront pas au rechargement.', err);
  }
}

/* ---------------------------------------------------------
   Formatage
   --------------------------------------------------------- */

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
});

/** Montants compacts pour les axes et les nœuds du Sankey (1 234 € -> 1,2 k€). */
const compactFormatter = new Intl.NumberFormat('fr-FR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const monthTitleFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

const shortDateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** Formate un montant en euros. */
function formatMoney(amount) {
  return currencyFormatter.format(amount);
}

/** Formate un montant en version courte, pour les espaces contraints. */
function formatCompact(amount) {
  return `${compactFormatter.format(amount)} €`;
}

/** Formate un pourcentage déjà exprimé en ratio (0.42 -> "42 %"). */
function formatPercent(ratio) {
  return `${(ratio * 100).toFixed(1).replace('.', ',')} %`;
}

/** Formate une date ISO (AAAA-MM-JJ) en date française complète. */
function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : dateFormatter.format(d);
}

/** Formate une date ISO en jour + mois abrégé. */
function formatShort(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : shortDateFormatter.format(d);
}

/** Date du jour au format AAAA-MM-JJ, en heure locale (pas UTC). */
function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Convertit une date locale en chaîne AAAA-MM-JJ. */
function toISO(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Clé de mois AAAA-MM extraite d'une date ISO. */
function monthKey(iso) {
  return iso.slice(0, 7);
}

/** Dernier jour du mois, au format AAAA-MM-JJ. */
function endOfMonth(year, month) {
  return toISO(year, month, new Date(year, month + 1, 0).getDate());
}

/* ---------------------------------------------------------
   Catégories personnalisables
   --------------------------------------------------------- */

/**
 * Nettoie une liste de catégories : retire les vides et les doublons (insensible à
 * la casse), puis garantit que "Autre" est présente et placée en dernier.
 */
function normalizeCategoryList(list) {
  const seen = new Set();
  const out = [];

  for (const raw of Array.isArray(list) ? list : []) {
    const label = String(raw ?? '').trim();
    if (!label) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // "Autre" est réinsérée en dernier, quelle que soit sa place d'origine.
    if (key !== FALLBACK_CATEGORY.toLowerCase()) out.push(label);
  }

  out.push(FALLBACK_CATEGORY);
  return out;
}

/**
 * Catégories effectives par type : la version personnalisée si elle existe,
 * sinon les valeurs par défaut.
 */
function loadCategories() {
  let stored = {};
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
  } catch (err) {
    console.warn('Catégories personnalisées illisibles, retour aux valeurs par défaut.', err);
  }

  const out = {};
  for (const type of Object.keys(DEFAULT_CATEGORIES)) {
    // Une liste absente ou vide retombe sur les valeurs par défaut du type.
    const list = Array.isArray(stored[type]) && stored[type].length ? stored[type] : DEFAULT_CATEGORIES[type];
    out[type] = normalizeCategoryList(list);
  }
  return out;
}

/** Enregistre les catégories personnalisées. */
function saveCategories(map) {
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn('Écriture des catégories impossible.', err);
  }
}

/* ---------------------------------------------------------
   Remboursements liés
   --------------------------------------------------------- */

/*
 * Un revenu peut porter un champ optionnel `linkedExpenseId` pointant vers une
 * dépense : il la rembourse au lieu de compter comme un revenu à part entière.
 * Le champ est absent par défaut, donc les données antérieures restent valides.
 */

/** Vrai si la transaction est un remboursement effectivement rattaché à une dépense. */
function isRefund(tx, list) {
  if (tx.type !== 'revenu' || !tx.linkedExpenseId) return false;

  // Un lien orphelin (dépense supprimée, JSON importé incohérent) est ignoré.
  return list.some((item) => item.id === tx.linkedExpenseId && item.type === 'depense');
}

/** Somme des remboursements rattachés à une dépense, hors transaction exclue. */
function refundsFor(expenseId, list, exceptId = null) {
  return list.reduce((total, tx) => {
    if (tx.id === exceptId) return total;
    if (tx.type !== 'revenu' || tx.linkedExpenseId !== expenseId) return total;
    return total + tx.amount;
  }, 0);
}

/**
 * Montant réellement supporté pour une dépense : montant d'origine moins les
 * remboursements qui lui sont liés. Les autres types renvoient leur montant brut.
 */
function netAmount(tx, list) {
  if (tx.type !== 'depense') return tx.amount;
  return Math.max(0, tx.amount - refundsFor(tx.id, list));
}

/** Vrai si la dépense porte au moins un remboursement. */
function hasRefunds(tx, list) {
  return tx.type === 'depense' && refundsFor(tx.id, list) > 0;
}

/**
 * Totaux d'une période, remboursements appliqués.
 * Les revenus liés ne sont pas comptés séparément : ils réduisent leur dépense.
 * @param {Array} rows  transactions de la période
 * @param {Array} all   ensemble des transactions, pour retrouver les liens
 */
function totalsFor(rows, all) {
  let income = 0;
  let expense = 0;
  let invest = 0;

  for (const tx of rows) {
    if (tx.type === 'revenu') {
      if (!isRefund(tx, all)) income += tx.amount;
    } else if (tx.type === 'depense') {
      expense += netAmount(tx, all);
    } else if (tx.type === 'investissement') {
      invest += tx.amount;
    }
  }

  return { income, expense, invest };
}

/* ---------------------------------------------------------
   Comptes
   --------------------------------------------------------- */

/** Les deux comptes de l'application, fixes : ni ajoutables ni supprimables. */
const ACCOUNTS = {
  courant: 'Compte courant',
  epargne: 'Épargne',
};

/** Sens possibles d'un transfert entre les deux comptes. */
const TRANSFER_DIRECTIONS = {
  'vers-epargne': 'Vers Épargne',
  'depuis-epargne': 'Depuis Épargne',
};

/**
 * Sens d'un transfert. Les transactions antérieures à cette version n'ont pas de
 * champ `direction` : elles sont lues comme un versement vers l'épargne.
 */
function transferDirection(tx) {
  return tx.direction === 'depuis-epargne' ? 'depuis-epargne' : 'vers-epargne';
}

/** Soldes de départ déclarés par l'utilisateur. */
function loadAccounts() {
  const base = { courant: 0, epargne: 0 };

  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return base;

    for (const key of Object.keys(base)) {
      const value = Number(parsed[key]);
      if (Number.isFinite(value)) base[key] = value;
    }
  } catch (err) {
    console.warn('Soldes de départ illisibles, remis à zéro.', err);
  }

  return base;
}

/** Enregistre les soldes de départ. */
function saveAccounts(start) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(start));
  } catch (err) {
    console.warn('Écriture des soldes de départ impossible.', err);
  }
}

/**
 * Effet d'une transaction sur les deux comptes.
 * Dépense, revenu et investissement passent par le compte courant ; seul le
 * transfert touche l'épargne, dans le sens indiqué.
 */
function accountDelta(tx, list) {
  if (tx.type === 'revenu') {
    // Un remboursement ne crédite rien : il réduit sa dépense, déjà comptée en net.
    return isRefund(tx, list) ? { courant: 0, epargne: 0 } : { courant: tx.amount, epargne: 0 };
  }

  if (tx.type === 'depense') return { courant: -netAmount(tx, list), epargne: 0 };

  // L'argent investi sort du compte courant vers un actif suivi à part.
  if (tx.type === 'investissement') return { courant: -tx.amount, epargne: 0 };

  return transferDirection(tx) === 'vers-epargne'
    ? { courant: -tx.amount, epargne: tx.amount }
    : { courant: tx.amount, epargne: -tx.amount };
}

/**
 * Soldes des comptes et patrimoine à une date donnée.
 * @param {Array}  list   toutes les transactions
 * @param {object} start  soldes de départ
 * @param {string|null} iso  date de fin incluse, ou null pour tout prendre
 */
function balancesAt(list, start, iso = null) {
  // On borne d'abord la liste : un remboursement postérieur ne doit pas alléger
  // rétroactivement une dépense déjà passée à cette date.
  const scope = iso ? list.filter((tx) => tx.date <= iso) : list;

  let courant = start.courant;
  let epargne = start.epargne;
  let investments = 0;

  for (const tx of scope) {
    const delta = accountDelta(tx, scope);
    courant += delta.courant;
    epargne += delta.epargne;
    if (tx.type === 'investissement') investments += tx.amount;
  }

  return { courant, epargne, investments, patrimoine: courant + epargne + investments };
}
