/* =========================================================
   Finances perso — page Transactions
   Vanilla JS, stockage Supabase (store.js), aucune autre dépendance.
   Constantes et formatteurs viennent de shared.js ;
   la barre de filtre temporel vient de time-filter.js.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   État
   --------------------------------------------------------- */

/** @type {Array<{id:string,type:string,name:string,amount:number,category:string,date:string,createdAt:number}>} */
let transactions = [];

/** Filtre de type actif dans la liste ('all' ou une clé de TYPES). */
let activeFilter = 'all';

/** Catégories effectives par type (personnalisées si elles existent). */
let categories = loadCategories();

/** Soldes de départ des deux comptes. */
let startBalances = loadAccounts();

/** Instance du composant de filtre temporel (créée au démarrage). */
let timeFilter = null;

/* ---------------------------------------------------------
   Références DOM
   --------------------------------------------------------- */

const modal       = $('#modal');
const openFormBtn = $('#openFormBtn');
const form        = $('#txForm');
const typeSelect  = $('#type');
const catSelect   = $('#category');
const nameInput   = $('#name');
const amountInput = $('#amount');
const dateInput   = $('#date');
const formError   = $('#formError');
const txList      = $('#txList');
const emptyState  = $('#emptyState');
const filtersBar  = $('#filters');

const directionField  = $('#directionField');
const directionSelect = $('#direction');

const linkField    = $('#linkField');
const linkToggle   = $('#linkToggle');
const linkPicker   = $('#linkPicker');
const linkSearch   = $('#linkSearch');
const linkList     = $('#linkList');
const linkEmpty    = $('#linkEmpty');
const linkChosen   = $('#linkChosen');
const linkChosenTxt = $('#linkChosenText');

const exportBtn    = $('#exportBtn');
const importBtn    = $('#importBtn');
const importFile   = $('#importFile');
const ioNotice     = $('#ioNotice');
const confirmModal = $('#confirmModal');
const confirmTitle = $('#confirmTitle');
const confirmText  = $('#confirmText');
const confirmOk    = $('#confirmOk');

const pasteBtn          = $('#pasteBtn');
const pasteModal        = $('#pasteModal');
const pasteInput        = $('#pasteInput');
const pasteError        = $('#pasteError');
const pasteSummary      = $('#pasteSummary');
const pasteSummaryTitle = $('#pasteSummaryTitle');
const pasteSummaryList  = $('#pasteSummaryList');
const pasteSubmit       = $('#pasteSubmit');
const pasteConfirm      = $('#pasteConfirm');

const catFilter       = $('#catFilter');
const catFilterBtn    = $('#catFilterBtn');
const catFilterPop    = $('#catFilterPop');
const catFilterGroups = $('#catFilterGroups');
const catFilterCount  = $('#catFilterCount');
const catFilterClear  = $('#catFilterClear');

const openCatsBtn  = $('#openCatsBtn');
const catsModal    = $('#catsModal');
const catTabs      = $('#catTabs');
const catList      = $('#catList');
const catAddForm   = $('#catAddForm');
const catInput     = $('#catInput');
const catError     = $('#catError');

/** Élément qui avait le focus avant l'ouverture de la modal, pour le restituer. */
let lastFocused = null;

/** Dépense à rembourser choisie dans le formulaire, ou null. */
let pendingLink = null;

/** Tolérance sur les comparaisons de montants, pour absorber les flottants. */
const EPSILON = 0.005;

/* ---------------------------------------------------------
   Utilitaires locaux
   --------------------------------------------------------- */

/** Formate un montant en euros, avec le signe explicite (+ / −) sauf pour les transferts. */
function formatAmount(amount, type) {
  const sign = SIGNS[type];
  const base = formatMoney(Math.abs(amount));
  if (sign > 0) return `+ ${base}`;
  if (sign < 0) return `− ${base}`;   // vrai signe moins (U+2212), plus lisible que le tiret
  return base;
}

/** Identifiant unique pour une transaction. */
function makeId() {
  return (crypto.randomUUID?.() ?? `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

/* ---------------------------------------------------------
   Formulaire : catégories dynamiques
   --------------------------------------------------------- */

/**
 * Remplit le select "Catégorie" en fonction du type choisi.
 * Conserve la sélection courante si elle existe toujours dans le nouveau type.
 */
function refreshCategories() {
  const type = typeSelect.value;
  const previous = catSelect.value;
  const options = categories[type] ?? [];

  catSelect.innerHTML = '';
  for (const label of options) {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    catSelect.appendChild(option);
  }

  if (options.includes(previous)) catSelect.value = previous;
}

/* ---------------------------------------------------------
   Formulaire : lier un revenu à une dépense
   --------------------------------------------------------- */

/** Montant restant à rembourser sur une dépense. */
function remainingFor(expense, exceptId = null) {
  return expense.amount - refundsFor(expense.id, transactions, exceptId);
}

/**
 * Affiche les champs propres au type choisi : le sens pour un transfert,
 * la liaison de remboursement pour un revenu.
 */
function refreshTypeFields() {
  const type = typeSelect.value;

  directionField.hidden = type !== 'transfert';

  const isIncome = type === 'revenu';
  linkField.hidden = !isIncome;
  if (!isIncome) clearLink();      // changer de type retire un lien déjà posé
  else syncLinkState();
}

/** Reflète l'état courant : bouton, sélecteur ou résumé du lien. */
function syncLinkState() {
  const expense = pendingLink ? transactions.find((tx) => tx.id === pendingLink) : null;

  linkChosen.hidden = !expense;
  linkToggle.hidden = Boolean(expense);

  if (expense) {
    linkPicker.hidden = true;
    linkChosenTxt.textContent = `→ lié à ${expense.name} · ${formatMoney(expense.amount)}`;
  }
}

/** Retire le lien en cours et referme le sélecteur. */
function clearLink() {
  pendingLink = null;
  linkPicker.hidden = true;
  linkChosen.hidden = true;
  linkToggle.hidden = false;
  linkSearch.value = '';
}

/** Liste les dépenses sélectionnables, filtrées par le champ de recherche. */
function renderLinkList() {
  const query = linkSearch.value.trim().toLowerCase();

  const expenses = transactions
    .filter((tx) => tx.type === 'depense')
    .filter((tx) => !query || tx.name.toLowerCase().includes(query))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.createdAt - a.createdAt;
    });

  const fragment = document.createDocumentFragment();

  for (const expense of expenses) {
    const remaining = remainingFor(expense);

    const button = el('button', 'link-row');
    button.type = 'button';
    button.dataset.link = expense.id;

    // Une dépense déjà intégralement remboursée n'est plus proposée.
    if (remaining <= EPSILON) button.disabled = true;

    button.append(
      el('span', 'link-name', expense.name),
      el('span', 'link-meta', `${formatMoney(expense.amount)} · ${formatShort(expense.date)}`),
      el('span', 'link-left', remaining > EPSILON ? `reste ${formatMoney(remaining)}` : 'déjà remboursée'),
    );

    const row = el('li');
    row.appendChild(button);
    fragment.appendChild(row);
  }

  linkList.replaceChildren(fragment);
  linkEmpty.hidden = expenses.length > 0;
}

/* ---------------------------------------------------------
   Modal : ouverture / fermeture
   --------------------------------------------------------- */

/** Affiche une modal : mémorise le focus courant et bloque le scroll de la page. */
function openPanel(root) {
  lastFocused = document.activeElement;
  root.hidden = false;
  document.body.classList.add('no-scroll');
}

/** Ferme une modal en jouant son animation de sortie avant de la masquer. */
function closePanel(root) {
  if (root.hidden) return;

  root.classList.add('is-closing');
  const panel = root.querySelector('.modal-panel');

  const finish = () => {
    root.classList.remove('is-closing');
    root.hidden = true;

    // Une modal peut en recouvrir une autre (confirmation) : on ne rend le scroll
    // à la page qu'une fois la dernière refermée.
    if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('no-scroll');

    lastFocused?.focus();
  };

  panel.addEventListener('animationend', finish, { once: true });
  // Filet de sécurité si l'animation ne se déclenche pas (prefers-reduced-motion, onglet inactif).
  setTimeout(() => { if (!root.hidden) finish(); }, 300);
}

/**
 * Ouvre le formulaire d'ajout.
 * @param {object|null} source  transaction à dupliquer, ou null pour un ajout vierge
 */
function openModal(source = null) {
  form.reset();
  hideError();

  if (source) {
    // Duplication : on reprend tout sauf la date, remise à aujourd'hui pour
    // enchaîner rapidement les dépenses récurrentes.
    typeSelect.value = source.type;
    refreshCategories();

    // La catégorie d'origine a pu être supprimée depuis : on ne la force que si elle existe.
    if ([...catSelect.options].some((option) => option.value === source.category)) {
      catSelect.value = source.category;
    }

    nameInput.value = source.name;
    amountInput.value = source.amount;
  } else {
    refreshCategories();
  }

  // La copie reprend le sens d'un transfert, mais jamais le lien de remboursement.
  if (source?.type === 'transfert') directionSelect.value = transferDirection(source);

  clearLink();
  refreshTypeFields();

  $('#modalTitle').textContent = source ? 'Dupliquer la transaction' : 'Nouvelle transaction';
  dateInput.value = todayISO();   // pré-rempli à aujourd'hui

  openPanel(modal);

  // Focus sur le premier champ une fois l'animation lancée.
  requestAnimationFrame(() => nameInput.focus());
}

function closeModal() {
  closePanel(modal);
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function hideError() {
  formError.hidden = true;
  formError.textContent = '';
}

/* ---------------------------------------------------------
   Ajout / suppression
   --------------------------------------------------------- */

/** Valide le formulaire et ajoute la transaction à la liste. */
function handleSubmit(event) {
  event.preventDefault();

  const name = nameInput.value.trim();
  const amount = Number.parseFloat(amountInput.value);
  const type = typeSelect.value;
  const category = catSelect.value;
  const date = dateInput.value || todayISO();

  if (!name) return showError('Merci d’indiquer un nom pour la transaction.');
  if (!Number.isFinite(amount) || amount <= 0) return showError('Le montant doit être un nombre supérieur à 0.');
  if (!category) return showError('Merci de choisir une catégorie.');

  // Un remboursement ne peut pas dépasser ce qui reste dû sur la dépense.
  if (type === 'revenu' && pendingLink) {
    const expense = transactions.find((tx) => tx.id === pendingLink);
    if (!expense) return showError('La dépense liée n’existe plus.');

    const remaining = remainingFor(expense);
    if (Math.abs(amount) > remaining + EPSILON) {
      return showError(
        `Ce remboursement dépasse « ${expense.name} » : il reste ${formatMoney(remaining)} à rembourser.`,
      );
    }
  }

  const entry = {
    id: makeId(),
    type,
    name,
    amount: Math.abs(amount),
    category,
    date,
    createdAt: Date.now(),   // départage deux transactions de même date
  };

  // Champ optionnel : absent quand il n'y a pas de lien, pour rester rétro-compatible.
  if (type === 'revenu' && pendingLink) entry.linkedExpenseId = pendingLink;

  // Le sens n'a de sens que pour un transfert.
  if (type === 'transfert') entry.direction = directionSelect.value;

  transactions.push(entry);

  saveTransactions(transactions);
  render();
  closeModal();
}

/** Supprime une transaction par son identifiant. */
function deleteTransaction(id) {
  transactions = transactions.filter((tx) => tx.id !== id);

  // Si c'était une dépense, ses remboursements redeviennent des revenus ordinaires.
  for (const tx of transactions) {
    if (tx.linkedExpenseId === id) delete tx.linkedExpenseId;
  }

  saveTransactions(transactions);
  render();
}

/* ---------------------------------------------------------
   Confirmation générique
   --------------------------------------------------------- */

/** Action à exécuter si l'utilisateur confirme. */
let confirmAction = null;

/** Ouvre la modal de confirmation, partagée par toutes les actions destructrices. */
function askConfirm({ title, text, okLabel, onConfirm }) {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  confirmOk.textContent = okLabel;
  confirmAction = onConfirm;

  openPanel(confirmModal);
  requestAnimationFrame(() => confirmOk.focus());
}

function closeConfirm() {
  closePanel(confirmModal);
  confirmAction = null;
}

/* ---------------------------------------------------------
   Export / import JSON
   --------------------------------------------------------- */

/** Champs qu'une transaction importée doit obligatoirement porter. */
const REQUIRED_FIELDS = ['type', 'name', 'amount', 'category', 'date'];

/** Masque automatiquement le message de succès au bout de quelques secondes. */
let noticeTimer = null;

/** Affiche un retour d'import/export sous l'en-tête. */
function showNotice(message, isError = false) {
  clearTimeout(noticeTimer);

  ioNotice.textContent = message;
  ioNotice.classList.toggle('is-ok', !isError);
  ioNotice.hidden = false;

  // Une erreur reste affichée jusqu'à la prochaine action ; un succès s'efface seul.
  if (!isError) noticeTimer = setTimeout(hideNotice, 6000);
}

function hideNotice() {
  clearTimeout(noticeTimer);
  ioNotice.hidden = true;
}

/**
 * Télécharge l'intégralité des transactions en JSON indenté.
 * Passe par un Blob et un lien temporaire : aucune dépendance, aucun serveur.
 */
function exportTransactions() {
  hideNotice();

  // Enveloppe incluant les soldes de départ et les catégories ; les anciens fichiers,
  // qui étaient un simple tableau, restent acceptés à l'import.
  const payload = { transactions, accounts: startBalances, categories };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Libère l'URL une fois le téléchargement lancé.
  setTimeout(() => URL.revokeObjectURL(url), 0);

  showNotice(`${transactions.length} transaction(s), les soldes de départ et les catégories exportés dans ${link.download}.`);
}

/** Lit des soldes de départ, en tolérant l'absence de la clé (anciens fichiers). */
function readAccounts(raw) {
  const start = { courant: 0, epargne: 0 };
  if (!raw || typeof raw !== 'object') return start;

  for (const key of Object.keys(start)) {
    const value = Number(raw[key]);
    if (Number.isFinite(value)) start[key] = value;
  }
  return start;
}

/**
 * Lit des catégories importées. Renvoie null si la clé est absente ou invalide
 * (anciens fichiers) : les catégories actuelles sont alors conservées.
 * Un type absent ou vide dans le fichier garde lui aussi sa liste actuelle.
 */
function readCategories(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const out = {};
  for (const type of Object.keys(categories)) {
    out[type] = Array.isArray(raw[type]) && raw[type].length
      ? normalizeCategoryList(raw[type])
      : categories[type];
  }
  return out;
}

/**
 * Extrait transactions, comptes et catégories d'un fichier importé.
 * Formats acceptés : le tableau nu des versions précédentes, et l'enveloppe
 * { transactions, accounts, categories? } produite depuis la V2.4 (categories
 * n'est présente que dans les exports récents).
 * @returns {{list: Array, accounts: object, categories: object|null}|null}
 */
function extractImport(data) {
  if (Array.isArray(data)) return { list: data, accounts: readAccounts(null), categories: null };

  if (data && typeof data === 'object' && Array.isArray(data.transactions)) {
    return {
      list: data.transactions,
      accounts: readAccounts(data.accounts),
      categories: readCategories(data.categories),
    };
  }

  return null;
}

/**
 * Vérifie qu'une liste importée est exploitable.
 * @returns {string|null} le message d'erreur, ou null si tout est valide.
 */
function validateImport(data) {
  if (!Array.isArray(data)) {
    return 'Format invalide : le fichier doit contenir un tableau de transactions.';
  }
  if (!data.length) {
    // Remplacer tout par rien est presque toujours une erreur : on refuse.
    return 'Le fichier ne contient aucune transaction.';
  }

  for (let i = 0; i < data.length; i += 1) {
    const tx = data[i];
    const at = `Transaction ${i + 1}`;

    if (!tx || typeof tx !== 'object' || Array.isArray(tx)) {
      return `${at} : un objet est attendu.`;
    }

    const missing = REQUIRED_FIELDS.filter((field) => tx[field] === undefined || tx[field] === null || tx[field] === '');
    if (missing.length) {
      return `${at} : champ(s) manquant(s) — ${missing.join(', ')}.`;
    }

    if (!(tx.type in TYPES)) {
      return `${at} : type inconnu « ${tx.type} ». Valeurs acceptées : ${Object.keys(TYPES).join(', ')}.`;
    }

    if (!Number.isFinite(Number(tx.amount))) {
      return `${at} : le montant « ${tx.amount} » n'est pas un nombre.`;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tx.date))) {
      return `${at} : date « ${tx.date} » attendue au format AAAA-MM-JJ.`;
    }
  }

  return null;
}

/**
 * Complète les champs techniques absents, pour accepter un JSON écrit à la main.
 * `createdAt` décroît avec l'index pour conserver l'ordre du fichier entre
 * deux transactions de même date.
 */
function normalizeImport(data) {
  const now = Date.now();

  return data.map((tx, index) => {
    const entry = {
      id: tx.id ?? makeId(),
      type: tx.type,
      name: String(tx.name),
      amount: Math.abs(Number(tx.amount)),
      category: String(tx.category),
      date: tx.date,
      createdAt: Number.isFinite(Number(tx.createdAt)) ? Number(tx.createdAt) : now - index,
    };

    // Champs optionnels : conservés seulement s'ils sont pertinents.
    if (tx.type === 'revenu' && tx.linkedExpenseId) entry.linkedExpenseId = String(tx.linkedExpenseId);
    if (tx.type === 'transfert') entry.direction = transferDirection(tx);

    return entry;
  });
}

/** Lit le fichier choisi, le valide, puis demande confirmation. */
function handleImportFile(event) {
  const file = event.target.files?.[0];

  // Réinitialise l'input pour pouvoir réimporter deux fois le même fichier.
  event.target.value = '';
  if (!file) return;

  hideNotice();

  const reader = new FileReader();

  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      return showNotice(`Fichier illisible : JSON invalide (${err.message}).`, true);
    }

    const extracted = extractImport(data);
    if (!extracted) {
      return showNotice(
        'Format invalide : le fichier doit contenir un tableau de transactions, '
        + 'ou un objet { transactions, accounts }.',
        true,
      );
    }

    const error = validateImport(extracted.list);
    if (error) return showNotice(error, true);

    const list = normalizeImport(extracted.list);

    askConfirm({
      title: 'Remplacer les transactions ?',
      text: `Remplacer toutes les transactions actuelles (${transactions.length}) par les ${list.length} `
        + `transactions de « ${file.name} » ? Les soldes de départ des comptes`
        + (extracted.categories ? ' et les catégories' : '')
        + ' seront eux aussi remplacés, et les données actuelles définitivement perdues.',
      okLabel: 'Remplacer',
      onConfirm: () => applyImport(list, extracted.accounts, extracted.categories),
    });
  };

  reader.onerror = () => showNotice('Lecture du fichier impossible.', true);
  reader.readAsText(file);
}

/** Remplace intégralement les données par le fichier importé. */
function applyImport(list, accounts, importedCategories = null) {
  transactions = list;
  startBalances = accounts;

  const saves = [saveTransactions(transactions), saveAccounts(startBalances)];

  // Fichier sans catégories (ancien export) : les catégories actuelles sont gardées.
  if (importedCategories) {
    categories = importedCategories;
    saves.push(saveCategories(categories));
    refreshCategories();
    if (pruneCatFilter()) syncCatFilterButton();
  }

  render();

  // Le message de réussite attend la confirmation de Supabase.
  showNotice(`Envoi de ${list.length} transaction(s) vers Supabase…`);
  Promise.all(saves).then((results) => {
    if (results.every(Boolean)) {
      showNotice(`${list.length} transaction(s) importée(s). Les données précédentes ont été remplacées.`);
    } else {
      showNotice('L’import n’a pas pu être enregistré entièrement dans Supabase. '
        + 'Rechargez la page pour voir ce qui a été sauvegardé, puis relancez l’import.', true);
    }
  });
}

/* ---------------------------------------------------------
   Import additif par collage de code
   --------------------------------------------------------- */

/*
 * Deuxième voie d'import, complémentaire du fichier ci-dessus : un bloc JSON
 * collé directement dans l'interface est AJOUTÉ aux transactions existantes,
 * qui ne sont jamais touchées. L'ajout se fait en deux temps — validation puis
 * confirmation — pour qu'un bloc mal formé ne parte jamais en stockage.
 */

/** Libellés singulier / pluriel des types, pour le résumé de contrôle. */
const TYPE_PLURALS = {
  depense:        ['dépense', 'dépenses'],
  revenu:         ['revenu', 'revenus'],
  investissement: ['investissement', 'investissements'],
  transfert:      ['transfert', 'transferts'],
};

/** Nombre maximum d'erreurs détaillées affichées d'un coup. */
const MAX_PASTE_ERRORS = 5;

/** Lot validé en attente de confirmation, ou null tant qu'il n'y a rien à ajouter. */
let pendingPaste = null;

function showPasteError(message) {
  pasteError.textContent = message;
  pasteError.hidden = false;
}

function hidePasteError() {
  pasteError.hidden = true;
  pasteError.textContent = '';
}

/** Abandonne le lot en attente et remet la modal sur son étape de contrôle. */
function resetPastePending() {
  pendingPaste = null;
  pasteSummary.hidden = true;
  pasteSummaryList.replaceChildren();

  pasteSubmit.hidden = false;
  pasteConfirm.hidden = true;
  pasteConfirm.textContent = 'Confirmer l’ajout';
}

/**
 * Extrait le tableau de transactions du texte collé.
 * Le tableau nu est le format attendu, mais l'enveloppe { transactions, … }
 * produite par l'export de fichier est acceptée : seule la liste est lue, les
 * soldes de départ ne sont jamais écrasés par un import additif.
 * @returns {Array|null}
 */
function extractPasted(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.transactions)) return data.transactions;
  return null;
}

/** Retrouve le libellé exact d'une catégorie du type, en ignorant la casse. */
function matchCategory(type, label) {
  const key = String(label).trim().toLowerCase();
  return (categories[type] ?? []).find((option) => option.toLowerCase() === key) ?? null;
}

/** Vrai si la chaîne est une date AAAA-MM-JJ qui existe réellement. */
function isValidISODate(value) {
  const iso = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;

  // Écarte les dates au bon format mais impossibles (2026-02-31, que Date décale).
  const d = new Date(`${iso}T00:00:00`);
  return !Number.isNaN(d.getTime()) && toISO(d.getFullYear(), d.getMonth(), d.getDate()) === iso;
}

/**
 * Sens d'un transfert collé. La clé technique `direction` du format d'export est
 * acceptée, tout comme `sens` et les libellés affichés, puisque le bloc peut être
 * écrit à la main.
 */
function readDirection(tx) {
  const raw = String(tx.direction ?? tx.sens ?? '').trim().toLowerCase();

  if (raw === 'depuis-epargne' || raw === 'depuis épargne' || raw === 'depuis epargne') return 'depuis-epargne';
  if (raw === 'vers-epargne' || raw === 'vers épargne' || raw === 'vers epargne') return 'vers-epargne';

  // Valeur absente ou non reconnue : versement vers l'épargne, comme en V2.4.
  return transferDirection(tx);
}

/**
 * Contrôle chaque entrée du lot collé et renvoie la liste des problèmes trouvés.
 * Plus strict que validateImport : la catégorie doit exister pour le type,
 * catégories personnalisées comprises (V2.2).
 * @returns {string[]} messages d'erreur, vide si le lot est exploitable
 */
function validatePasted(list) {
  const errors = [];

  for (let i = 0; i < list.length; i += 1) {
    const tx = list[i];
    const at = `Transaction ${i + 1}`;

    if (!tx || typeof tx !== 'object' || Array.isArray(tx)) {
      errors.push(`${at} : un objet est attendu.`);
      continue;
    }

    const missing = REQUIRED_FIELDS.filter((field) => tx[field] === undefined || tx[field] === null || tx[field] === '');
    if (missing.length) {
      // Sans ces champs, les contrôles suivants n'auraient rien à vérifier.
      errors.push(`${at} : champ(s) manquant(s) — ${missing.join(', ')}.`);
      continue;
    }

    if (!(tx.type in TYPES)) {
      // La catégorie dépend du type : inutile d'aller plus loin sur cette ligne.
      errors.push(`${at} : type inconnu « ${tx.type} » (attendus : ${Object.keys(TYPES).join(', ')}).`);
      continue;
    }

    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push(`${at} : le montant « ${tx.amount} » doit être un nombre supérieur à 0.`);
    }

    if (!matchCategory(tx.type, tx.category)) {
      errors.push(`${at} : catégorie « ${tx.category} » inconnue pour le type ${TYPES[tx.type]}.`);
    }

    if (!isValidISODate(tx.date)) {
      errors.push(`${at} : date « ${tx.date} » attendue au format AAAA-MM-JJ.`);
    }
  }

  return errors;
}

/**
 * Prépare le lot pour la fusion : champs techniques complétés, catégorie ramenée
 * à son libellé exact, et identifiants dédoublonnés contre la liste déjà en place
 * (deux transactions de même id seraient indistinguables à la suppression).
 */
function normalizePasted(list) {
  const now = Date.now();
  const used = new Set(transactions.map((tx) => tx.id));
  const remap = new Map();   // id d'origine -> id retenu, pour les liens internes au lot

  const entries = list.map((tx, index) => {
    const original = tx.id ? String(tx.id) : null;

    let id = original && !used.has(original) ? original : makeId();
    while (used.has(id)) id = makeId();
    used.add(id);
    if (original && original !== id) remap.set(original, id);

    const entry = {
      id,
      type: tx.type,
      name: String(tx.name).trim(),
      amount: Math.abs(Number(tx.amount)),
      category: matchCategory(tx.type, tx.category),
      date: String(tx.date),
      // `createdAt` décroît avec l'index pour conserver l'ordre du bloc collé
      // entre deux transactions de même date.
      createdAt: Number.isFinite(Number(tx.createdAt)) ? Number(tx.createdAt) : now - index,
    };

    // Champs optionnels : conservés seulement s'ils sont pertinents.
    if (tx.type === 'revenu' && tx.linkedExpenseId) entry.linkedExpenseId = String(tx.linkedExpenseId);
    if (tx.type === 'transfert') entry.direction = readDirection(tx);

    return entry;
  });

  // Un lien qui visait un id renuméroté doit suivre, sinon il deviendrait orphelin.
  for (const entry of entries) {
    if (entry.linkedExpenseId && remap.has(entry.linkedExpenseId)) {
      entry.linkedExpenseId = remap.get(entry.linkedExpenseId);
    }
  }

  return entries;
}

/** Ventilation par type du lot, dans l'ordre des onglets ("5 dépenses", "2 revenus"…). */
function summarizePasted(list) {
  const counts = {};
  for (const tx of list) counts[tx.type] = (counts[tx.type] ?? 0) + 1;

  return Object.keys(TYPES)
    .filter((type) => counts[type])
    .map((type) => `${counts[type]} ${TYPE_PLURALS[type][counts[type] > 1 ? 1 : 0]}`);
}

/**
 * Contrôle le texte collé et prépare le lot. Rien n'est écrit à ce stade :
 * l'ajout demande un second clic, sur le bouton de confirmation.
 */
function handlePasteSubmit() {
  hidePasteError();
  resetPastePending();

  const raw = pasteInput.value.trim();
  if (!raw) return showPasteError('Collez un bloc JSON de transactions avant de valider.');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return showPasteError(`JSON invalide : ${err.message}. Rien n’a été ajouté.`);
  }

  const list = extractPasted(data);
  if (!list) {
    return showPasteError('Format invalide : un tableau de transactions est attendu, entre crochets [ ].');
  }
  if (!list.length) return showPasteError('Le bloc collé ne contient aucune transaction.');

  const errors = validatePasted(list);
  if (errors.length) {
    const shown = errors.slice(0, MAX_PASTE_ERRORS).join(' ');
    const rest = errors.length > MAX_PASTE_ERRORS
      ? ` (+ ${errors.length - MAX_PASTE_ERRORS} autre(s) problème(s))`
      : '';
    return showPasteError(`${shown}${rest} Rien n’a été ajouté.`);
  }

  // Validation passée : on attend une confirmation explicite avant d'écrire.
  pendingPaste = normalizePasted(list);
  const total = pendingPaste.length;

  pasteSummaryTitle.textContent =
    `${total} transaction(s) prête(s) à être ajoutée(s). `
    + `La liste en compte ${transactions.length} avant ajout, aucune ne sera effacée.`;
  pasteSummaryList.replaceChildren(...summarizePasted(pendingPaste).map((label) => el('li', null, label)));
  pasteSummary.hidden = false;

  pasteSubmit.hidden = true;
  pasteConfirm.hidden = false;
  pasteConfirm.textContent = `Confirmer l’ajout de ${total} transaction(s)`;
  pasteConfirm.focus();
}

/** Fusionne le lot validé avec les transactions existantes, sans rien effacer. */
function applyPaste(list) {
  transactions = transactions.concat(list);

  saveTransactions(transactions);
  render();
  closePaste();

  showNotice(`${list.length} transaction(s) ajoutée(s). Les transactions existantes ont été conservées.`);
}

function openPaste() {
  hideNotice();
  hidePasteError();
  resetPastePending();
  pasteInput.value = '';

  openPanel(pasteModal);

  // Focus sur le champ de collage une fois l'animation lancée.
  requestAnimationFrame(() => pasteInput.focus());
}

function closePaste() {
  // Fermer abandonne le lot : rouvrir repart toujours d'une validation neuve.
  resetPastePending();
  hidePasteError();
  closePanel(pasteModal);
}

/* ---------------------------------------------------------
   Filtre par catégorie
   --------------------------------------------------------- */

/*
 * Troisième filtre de la liste, qui se combine en ET avec le type et la période.
 * Une sélection vide ne filtre rien : c'est l'état par défaut.
 * Les clés portent le type en préfixe, car un même libellé (« Autre ») existe
 * dans plusieurs types sans désigner la même chose.
 */

/** Catégories retenues, sous forme de clés « type::libellé ». */
const activeCategories = new Set();

/** Clé de sélection d'une catégorie, pour lever l'ambiguïté entre types. */
function catKey(type, label) {
  return `${type}::${label}`;
}

/** Vrai si la transaction passe le filtre de catégorie courant. */
function matchesCategory(tx) {
  if (!activeCategories.size) return true;   // aucune sélection = aucun filtre
  return activeCategories.has(catKey(tx.type, tx.category));
}

/**
 * Retire les sélections dont la catégorie n'existe plus : la modal « Modifier
 * les catégories » (V2.2) peut en renommer ou en supprimer entre deux ouvertures.
 * @returns {boolean} vrai si la sélection a changé
 */
function pruneCatFilter() {
  let changed = false;

  for (const key of [...activeCategories]) {
    const [type, label] = key.split('::');
    if (!(categories[type] ?? []).includes(label)) {
      activeCategories.delete(key);
      changed = true;
    }
  }
  return changed;
}

/** Construit la liste des catégories du popover, groupée par type. */
function renderCatFilter() {
  const fragment = document.createDocumentFragment();

  for (const [type, label] of Object.entries(TYPES)) {
    const list = categories[type] ?? [];
    if (!list.length) continue;

    const group = el('div', 'cat-filter-group');
    group.appendChild(el('p', 'cat-filter-label', label));

    const row = el('div', 'cat-filter-row');
    for (const name of list) {
      const key = catKey(type, name);

      const chip = el('button', 'chip cat-chip', name);
      chip.type = 'button';
      chip.dataset.cat = key;
      // Le type porte la couleur : la même que celle du flux dans le Sankey.
      chip.dataset.catType = type;

      const on = activeCategories.has(key);
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', String(on));

      row.appendChild(chip);
    }

    group.appendChild(row);
    fragment.appendChild(group);
  }

  catFilterGroups.replaceChildren(fragment);
}

/** Reflète le nombre de catégories retenues sur la chip d'ouverture. */
function syncCatFilterButton() {
  const count = activeCategories.size;

  catFilterBtn.classList.toggle('is-active', count > 0);
  catFilterCount.hidden = count === 0;
  catFilterCount.textContent = String(count);
}

function openCatFilter() {
  // Les catégories ont pu changer depuis la dernière ouverture : on repart
  // toujours de la liste courante.
  categories = loadCategories();
  if (pruneCatFilter()) {
    syncCatFilterButton();
    render();
  }

  renderCatFilter();
  catFilterPop.hidden = false;
  catFilterBtn.setAttribute('aria-expanded', 'true');
}

function closeCatFilter() {
  catFilterPop.hidden = true;
  catFilterBtn.setAttribute('aria-expanded', 'false');
}

/* ---------------------------------------------------------
   Gestion des catégories
   --------------------------------------------------------- */

/** Type dont l'onglet est actif dans la modal. */
let catTab = 'depense';

/** Libellé en cours de renommage, ou null. */
let editingCat = null;

function showCatError(message) {
  catError.textContent = message;
  catError.hidden = false;
}

function hideCatError() {
  catError.hidden = true;
  catError.textContent = '';
}

/** Vrai si le libellé existe déjà dans l'onglet courant (insensible à la casse). */
function categoryExists(label) {
  const key = label.toLowerCase();
  return categories[catTab].some((existing) => existing.toLowerCase() === key);
}

/** Enregistre, redessine la liste et met à jour le formulaire d'ajout. */
function persistCategories() {
  saveCategories(categories);
  renderCatList();
  refreshCategories();   // le select du formulaire reflète immédiatement le changement

  // Une catégorie supprimée ne doit pas rester dans le filtre de la liste, où
  // elle masquerait tout sans que rien ne l'explique.
  if (pruneCatFilter()) {
    syncCatFilterButton();
    render();
  }
}

/** Construit les onglets, un par type de transaction. */
function buildCatTabs() {
  const fragment = document.createDocumentFragment();

  for (const [type, label] of Object.entries(TYPES)) {
    const tab = el('button', 'chip', label);
    tab.type = 'button';
    tab.dataset.tab = type;
    tab.setAttribute('role', 'tab');
    fragment.appendChild(tab);
  }

  catTabs.replaceChildren(fragment);
}

/** Reflète l'onglet actif. */
function syncCatTabs() {
  for (const tab of catTabs.children) {
    const active = tab.dataset.tab === catTab;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
}

/** Petit bouton icône réutilisé dans les lignes de catégorie. */
function catIconButton(path, label, dataKey, dataValue) {
  const button = el('button', 'btn-icon btn-icon-sm');
  button.type = 'button';
  button.dataset[dataKey] = dataValue;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-sm"><path d="${path}"/></svg>`;
  return button;
}

const ICON_PENCIL = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z';
const ICON_TRASH  = 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14';
const ICON_CHECK  = 'M20 6 9 17l-5-5';
const ICON_CLOSE  = 'M18 6 6 18M6 6l12 12';

/** Dessine la liste des catégories de l'onglet actif. */
function renderCatList() {
  const fragment = document.createDocumentFragment();

  for (const label of categories[catTab]) {
    const locked = label === FALLBACK_CATEGORY;
    const row = el('li', `cat-row${locked ? ' is-locked' : ''}`);

    if (editingCat === label) {
      // Mode renommage : le nom devient un champ de saisie.
      const input = el('input', 'cat-edit');
      input.type = 'text';
      input.value = label;
      input.maxLength = 40;
      input.dataset.editing = label;

      const actions = el('div', 'cat-actions');
      actions.append(
        catIconButton(ICON_CHECK, `Valider le nouveau nom de ${label}`, 'commit', label),
        catIconButton(ICON_CLOSE, 'Annuler le renommage', 'cancel', label),
      );

      row.append(input, actions);
    } else {
      // "Autre" sert de secours : ni renommable, ni supprimable.
      const name = locked
        ? el('span', 'cat-name is-static', label)
        : el('button', 'cat-name', label);

      if (!locked) {
        name.type = 'button';
        name.dataset.rename = label;
      }

      const actions = el('div', 'cat-actions');
      if (locked) {
        actions.appendChild(el('span', 'cat-lock', 'toujours disponible'));
      } else {
        actions.append(
          catIconButton(ICON_PENCIL, `Renommer ${label}`, 'rename', label),
          catIconButton(ICON_TRASH, `Supprimer ${label}`, 'remove', label),
        );
      }

      row.append(name, actions);
    }

    fragment.appendChild(row);
  }

  catList.replaceChildren(fragment);

  // Le champ de renommage prend le focus dès son apparition.
  if (editingCat) {
    const editor = catList.querySelector('.cat-edit');
    editor?.focus();
    editor?.select();
  }
}

/** Ajoute une catégorie à l'onglet actif. */
function addCategory(raw) {
  const label = raw.trim();

  if (!label) return showCatError('Indiquez un nom de catégorie.');
  if (categoryExists(label)) return showCatError(`« ${label} » existe déjà dans ce type.`);

  // normalizeCategoryList replace "Autre" en dernier automatiquement.
  categories[catTab] = normalizeCategoryList([...categories[catTab], label]);
  catInput.value = '';
  hideCatError();
  persistCategories();
}

/**
 * Renomme une catégorie. Les transactions existantes qui l'utilisent sont mises à
 * jour : un renommage ne doit pas laisser d'anciens libellés orphelins.
 */
function renameCategory(oldLabel, raw) {
  const label = raw.trim();

  if (!label) return showCatError('Le nom ne peut pas être vide.');

  if (label === oldLabel) {
    editingCat = null;
    hideCatError();
    return renderCatList();
  }

  if (categoryExists(label)) return showCatError(`« ${label} » existe déjà dans ce type.`);

  categories[catTab] = normalizeCategoryList(
    categories[catTab].map((existing) => (existing === oldLabel ? label : existing)),
  );

  // Le filtre de la liste suit le renommage, au lieu de pointer dans le vide.
  const previousKey = catKey(catTab, oldLabel);
  if (activeCategories.has(previousKey)) {
    activeCategories.delete(previousKey);
    activeCategories.add(catKey(catTab, label));
  }

  let touched = 0;
  for (const tx of transactions) {
    if (tx.type === catTab && tx.category === oldLabel) {
      tx.category = label;
      touched += 1;
    }
  }
  if (touched) {
    saveTransactions(transactions);
    render();
  }

  editingCat = null;
  hideCatError();
  persistCategories();
}

/**
 * Supprime une catégorie. Si des transactions l'utilisent, on demande confirmation :
 * elles sont conservées et gardent leur ancien libellé.
 */
function removeCategory(label) {
  if (label === FALLBACK_CATEGORY) return;   // garde-fou, le bouton n'existe pas

  hideCatError();

  const apply = () => {
    categories[catTab] = normalizeCategoryList(
      categories[catTab].filter((existing) => existing !== label),
    );
    persistCategories();
  };

  const used = transactions.filter((tx) => tx.type === catTab && tx.category === label).length;
  if (!used) return apply();

  askConfirm({
    title: 'Supprimer cette catégorie ?',
    text: `${used} transaction(s) utilisent « ${label} ». Elles seront conservées et garderont ce libellé, `
      + 'mais la catégorie ne sera plus proposée dans le formulaire.',
    okLabel: 'Supprimer',
    onConfirm: apply,
  });
}

function openCats() {
  editingCat = null;
  hideCatError();
  catInput.value = '';

  syncCatTabs();
  renderCatList();
  openPanel(catsModal);
}

function closeCats() {
  editingCat = null;
  closePanel(catsModal);
}

/* ---------------------------------------------------------
   Édition inline depuis la liste
   --------------------------------------------------------- */

/** Libellés affichés par les étiquettes éditables. */
const CELL_TEXT = {
  type: (tx) => TYPES[tx.type] ?? tx.type,
  category: (tx) => tx.category,
  date: (tx) => formatDate(tx.date),
  amount: (tx) => formatAmount(tx.amount, tx.type),
};

/** Intitulé d'accessibilité de chaque champ éditable. */
const CELL_LABEL = {
  type: 'Modifier le type',
  category: 'Modifier la catégorie',
  date: 'Modifier la date',
  amount: 'Modifier le montant',
};

/**
 * Catégorie valide pour un type donné : on conserve l'actuelle si elle existe
 * dans ce type, sinon on retombe sur la première proposée.
 */
function categoryForType(type, current) {
  const list = categories[type] ?? [];
  if (list.includes(current)) return current;
  return list[0] ?? FALLBACK_CATEGORY;
}

/** Construit l'étiquette cliquable d'un champ éditable. */
function buildCell(tx, field) {
  const sign = SIGNS[tx.type];

  // Le montant garde sa classe de signe ; les méta reprennent leur style d'origine.
  const className = field === 'amount'
    ? `tx-amount tx-chip ${sign > 0 ? 'is-positive' : sign < 0 ? 'is-negative' : 'is-neutral'}`
    : field === 'type'
      ? 'badge badge-type tx-chip'
      : 'tx-chip tx-chip-text';

  const cell = el('button', className);
  cell.type = 'button';
  cell.dataset.edit = field;
  cell.setAttribute('aria-label', `${CELL_LABEL[field]} de ${tx.name}`);

  if (field === 'amount' && hasRefunds(tx, transactions)) {
    // Dépense remboursée : montant d'origine barré, puis montant réellement supporté.
    cell.append(
      el('s', 'tx-amount-gross', formatAmount(tx.amount, tx.type)),
      el('span', 'tx-amount-net', formatAmount(netAmount(tx, transactions), tx.type)),
    );
  } else {
    cell.textContent = CELL_TEXT[field](tx);
  }

  // Le badge de type porte sa couleur via data-type.
  if (field === 'type') cell.dataset.type = tx.type;

  return cell;
}

/** Construit le contrôle d'édition correspondant à un champ. */
function buildControl(tx, field) {
  if (field === 'type' || field === 'category') {
    const select = el('select', 'tx-edit tx-edit-select');
    select.dataset.editField = field;

    const options = field === 'type'
      ? Object.entries(TYPES)
      : (categories[tx.type] ?? []).map((label) => [label, label]);

    for (const [value, label] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }

    select.value = field === 'type' ? tx.type : tx.category;
    return select;
  }

  const input = el('input', `tx-edit tx-edit-${field}`);
  input.dataset.editField = field;

  if (field === 'date') {
    input.type = 'date';
    input.value = tx.date;
  } else {
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = String(tx.amount);   // valeur absolue, sans signe ni symbole
  }

  return input;
}

/**
 * Écrit une valeur saisie inline dans la transaction.
 * Une valeur invalide est ignorée : l'ancienne est conservée.
 * @returns {boolean} vrai si la transaction a réellement changé
 */
function applyEditValue(tx, field, raw) {
  if (field === 'type') {
    if (!(raw in TYPES) || raw === tx.type) return false;

    // Une dépense remboursée ne peut pas changer de type sans casser ses liens.
    if (tx.type === 'depense' && hasRefunds(tx, transactions)) return false;

    tx.type = raw;
    // La catégorie doit rester valide pour le nouveau type.
    tx.category = categoryForType(raw, tx.category);

    // Un revenu qui n'en est plus un perd son lien de remboursement.
    if (raw !== 'revenu') delete tx.linkedExpenseId;

    // Le sens n'existe que pour les transferts : posé par défaut, retiré sinon.
    if (raw === 'transfert') tx.direction = tx.direction ?? 'vers-epargne';
    else delete tx.direction;

    return true;
  }

  if (field === 'category') {
    if (!raw || raw === tx.category) return false;
    tx.category = raw;
    return true;
  }

  if (field === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw === tx.date) return false;
    tx.date = raw;
    return true;
  }

  const amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount === tx.amount) return false;

  // Un remboursement ne peut pas dépasser ce qui reste dû sur sa dépense.
  if (isRefund(tx, transactions)) {
    const expense = transactions.find((item) => item.id === tx.linkedExpenseId);
    if (amount > remainingFor(expense, tx.id) + EPSILON) return false;
  }

  // Une dépense ne peut pas passer sous le total déjà remboursé.
  if (tx.type === 'depense' && amount < refundsFor(tx.id, transactions) - EPSILON) return false;

  tx.amount = amount;
  return true;
}

/**
 * Referme une édition en cours.
 * @param {HTMLElement} control  le contrôle inline
 * @param {boolean} commit       false pour annuler (Échap)
 */
function closeEdit(control, commit) {
  const row = control.closest('.tx');
  const tx = transactions.find((item) => item.id === row?.dataset.id);
  const field = control.dataset.editField;

  if (!tx) return control.remove();   // la ligne a disparu entre-temps

  if (commit && applyEditValue(tx, field, control.value)) {
    saveTransactions(transactions);
    render();   // la ligne peut changer de place, ou sortir des filtres actifs
  } else {
    // Rien à enregistrer : simple retour à l'affichage, sans redessiner la liste.
    control.replaceWith(buildCell(tx, field));
  }
}

/** Referme l'édition éventuellement ouverte ailleurs dans la liste. */
function closeOpenEdit() {
  const open = txList.querySelector('[data-edit-field]');
  if (open) closeEdit(open, true);
}

/** Remplace une étiquette par son contrôle d'édition. */
function startEdit(cell) {
  const row = cell.closest('.tx');
  const tx = transactions.find((item) => item.id === row?.dataset.id);
  if (!tx) return;

  closeOpenEdit();   // un seul champ éditable à la fois

  const field = cell.dataset.edit;
  const control = buildControl(tx, field);

  cell.replaceWith(control);
  control.focus();

  // Le montant est présélectionné pour pouvoir être remplacé directement.
  if (field === 'amount') control.select();
}

/* ---------------------------------------------------------
   Rendu
   --------------------------------------------------------- */

/** Retourne les transactions triées de la plus récente à la plus ancienne. */
function sorted() {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.createdAt - a.createdAt;
  });
}

/** Construit l'élément <li> d'une transaction. */
function renderRow(tx) {
  const li = el('li', 'tx');
  li.dataset.id = tx.id;

  // Pastille de type
  const mark = el('span', 'tx-mark', TYPE_INITIALS[tx.type] ?? '?');
  mark.dataset.type = tx.type;
  mark.setAttribute('aria-hidden', 'true');

  // Bloc central : nom + méta (type, catégorie, date)
  const main = el('div', 'tx-main');

  const nameEl = el('p', 'tx-name', tx.name);   // textContent : pas d'injection HTML possible
  const meta = el('p', 'tx-meta');

  const dot = el('span', 'dot', '•');
  dot.setAttribute('aria-hidden', 'true');

  // Type, catégorie et date sont des étiquettes éditables au clic.
  meta.append(buildCell(tx, 'type'), buildCell(tx, 'category'), dot, buildCell(tx, 'date'));

  // Sens du transfert, pour lever l'ambiguïté sur le compte crédité.
  if (tx.type === 'transfert') {
    meta.appendChild(el('span', 'badge badge-link', TRANSFER_DIRECTIONS[transferDirection(tx)]));
  }

  // Indication discrète du remboursement, non éditable.
  if (isRefund(tx, transactions)) {
    const target = transactions.find((item) => item.id === tx.linkedExpenseId);
    meta.appendChild(el('span', 'badge badge-link', `→ lié à ${target.name}`));
  }

  main.append(nameEl, meta);

  // Bloc droit : montant (éditable) + actions
  const right = el('div', 'tx-right');
  const amountEl = buildCell(tx, 'amount');

  const duplicate = el('button', 'btn-icon tx-action');
  duplicate.type = 'button';
  duplicate.dataset.duplicate = tx.id;
  duplicate.setAttribute('aria-label', `Dupliquer ${tx.name}`);
  duplicate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';

  const del = el('button', 'btn-icon tx-action');
  del.type = 'button';
  del.dataset.delete = tx.id;
  del.setAttribute('aria-label', `Supprimer ${tx.name}`);
  del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

  right.append(amountEl, duplicate, del);
  li.append(mark, main, right);
  return li;
}

/** Met à jour les totaux du bandeau, sur les lignes retenues par les filtres actifs. */
function renderStats(rows) {
  // Dépenses nettes, et remboursements exclus des revenus pour ne pas compter deux fois.
  const { income, expense, invest } = totalsFor(rows, transactions);
  const outgoing = expense + invest;

  const balance = income - outgoing;

  $('#statIncome').textContent  = formatMoney(income);
  $('#statExpense').textContent = formatMoney(outgoing);
  $('#statBalance').textContent = formatMoney(balance);
  $('#statCount').textContent   = String(rows.length);

  // Accent chaud réservé au solde négatif, le seul état à signaler ici.
  $('#statBalance').classList.toggle('is-alert', balance < 0);
}

/** Redessine la liste et les statistiques. */
function render() {
  // Type, période et catégorie se combinent en ET logique.
  const rows = sorted().filter(
    (tx) => (activeFilter === 'all' || tx.type === activeFilter)
      && timeFilter.matches(tx.date)
      && matchesCategory(tx),
  );

  // On construit hors du DOM puis on remplace en une fois (un seul reflow).
  const fragment = document.createDocumentFragment();
  for (const tx of rows) fragment.appendChild(renderRow(tx));

  txList.replaceChildren(fragment);
  emptyState.hidden = rows.length > 0;

  renderStats(rows);
}

/* ---------------------------------------------------------
   Événements
   --------------------------------------------------------- */

openFormBtn.addEventListener('click', openModal);

// Le type pilote les catégories disponibles et l'affichage du bloc de liaison.
typeSelect.addEventListener('change', () => {
  refreshCategories();
  refreshTypeFields();
});

/* -- Liaison d'un remboursement à une dépense -- */
linkToggle.addEventListener('click', () => {
  linkPicker.hidden = !linkPicker.hidden;
  if (linkPicker.hidden) return;

  linkSearch.value = '';
  renderLinkList();
  linkSearch.focus();
});

linkSearch.addEventListener('input', renderLinkList);

linkList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-link]');
  if (!row) return;

  pendingLink = row.dataset.link;
  hideError();
  syncLinkState();
});

$('#linkClear').addEventListener('click', () => {
  clearLink();
  hideError();
});

form.addEventListener('submit', handleSubmit);
form.addEventListener('input', hideError);

// Fermeture : croix, bouton Annuler, clic sur le fond.
modal.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) closeModal();
});

// Export / import.
exportBtn.addEventListener('click', exportTransactions);
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', handleImportFile);

// Confirmation générique : on referme avant d'exécuter l'action.
confirmOk.addEventListener('click', () => {
  const action = confirmAction;
  closeConfirm();
  action?.();
});

confirmModal.addEventListener('click', (event) => {
  if (event.target.closest('[data-confirm-close]')) closeConfirm();
});

/* -- Import additif par collage de code -- */
pasteBtn.addEventListener('click', openPaste);
pasteSubmit.addEventListener('click', handlePasteSubmit);

// Ajout effectif : uniquement depuis le bouton apparu avec le résumé.
pasteConfirm.addEventListener('click', () => {
  if (pendingPaste) applyPaste(pendingPaste);
});

// Fermeture : croix, bouton Annuler, clic sur le fond.
pasteModal.addEventListener('click', (event) => {
  if (event.target.closest('[data-paste-close]')) closePaste();
});

// Toute retouche du texte invalide le lot déjà contrôlé : il faudra revalider.
pasteInput.addEventListener('input', () => {
  hidePasteError();
  resetPastePending();
});

/* -- Modal de gestion des catégories -- */
openCatsBtn.addEventListener('click', openCats);

catsModal.addEventListener('click', (event) => {
  if (event.target.closest('[data-cats-close]')) closeCats();
});

// Changement d'onglet.
catTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (!tab || tab.dataset.tab === catTab) return;

  catTab = tab.dataset.tab;
  editingCat = null;
  hideCatError();

  syncCatTabs();
  renderCatList();
});

// Renommer / supprimer / valider / annuler, en délégation sur la liste.
catList.addEventListener('click', (event) => {
  const rename = event.target.closest('[data-rename]');
  if (rename) {
    editingCat = rename.dataset.rename;
    hideCatError();
    return renderCatList();
  }

  const commit = event.target.closest('[data-commit]');
  if (commit) {
    const input = catList.querySelector('.cat-edit');
    return renameCategory(commit.dataset.commit, input ? input.value : '');
  }

  const cancel = event.target.closest('[data-cancel]');
  if (cancel) {
    editingCat = null;
    hideCatError();
    return renderCatList();
  }

  const remove = event.target.closest('[data-remove]');
  if (remove) removeCategory(remove.dataset.remove);
});

// Entrée valide le renommage, Échap l'annule sans refermer la modal.
catList.addEventListener('keydown', (event) => {
  const input = event.target.closest('.cat-edit');
  if (!input) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    renameCategory(input.dataset.editing, input.value);
  } else if (event.key === 'Escape') {
    event.stopPropagation();
    editingCat = null;
    hideCatError();
    renderCatList();
  }
});

// Ajout d'une catégorie.
catAddForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addCategory(catInput.value);
});

catInput.addEventListener('input', hideCatError);

// Fermeture au clavier.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  // La confirmation se superpose aux autres : elle se ferme en premier.
  if (!confirmModal.hidden) return closeConfirm();

  closeModal();
  closeCats();
  closePaste();
  closeCatFilter();
});

// Actions de ligne (délégation : la liste est redessinée à chaque rendu).
txList.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-delete]');
  if (remove) return deleteTransaction(remove.dataset.delete);

  const duplicate = event.target.closest('[data-duplicate]');
  if (duplicate) {
    // Ouvre le formulaire pré-rempli ; la validation créera bien une nouvelle
    // transaction, l'originale n'est pas touchée.
    const source = transactions.find((tx) => tx.id === duplicate.dataset.duplicate);
    if (source) openModal(source);
    return;
  }

  // Étiquette éditable : type, catégorie, date ou montant.
  const cell = event.target.closest('[data-edit]');
  if (cell) startEdit(cell);
});

/* -- Validation d'une édition inline -- */

// Un select s'applique dès qu'une valeur est choisie.
txList.addEventListener('change', (event) => {
  const control = event.target.closest('[data-edit-field]');
  if (control) closeEdit(control, true);
});

// Cliquer ailleurs valide la saisie en cours si elle est valide, sinon la restaure.
txList.addEventListener('focusout', (event) => {
  const control = event.target.closest('[data-edit-field]');
  // `change` a pu déjà refermer l'édition : le contrôle n'est alors plus dans le document.
  if (control && control.isConnected) closeEdit(control, true);
});

// Entrée valide, Échap annule sans toucher à la transaction.
txList.addEventListener('keydown', (event) => {
  const control = event.target.closest('[data-edit-field]');
  if (!control) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    closeEdit(control, true);
  } else if (event.key === 'Escape') {
    event.stopPropagation();   // ne referme pas une modal au passage
    closeEdit(control, false);
  }
});

/* -- Filtre par catégorie -- */
catFilterBtn.addEventListener('click', () => {
  if (catFilterPop.hidden) openCatFilter();
  else closeCatFilter();
});

// Sélection multiple : chaque clic bascule une catégorie, le popover reste ouvert.
catFilterGroups.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-cat]');
  if (!chip) return;

  const key = chip.dataset.cat;
  if (activeCategories.has(key)) activeCategories.delete(key);
  else activeCategories.add(key);

  const on = activeCategories.has(key);
  chip.classList.toggle('is-on', on);
  chip.setAttribute('aria-pressed', String(on));

  syncCatFilterButton();
  render();
});

catFilterClear.addEventListener('click', () => {
  if (!activeCategories.size) return;

  activeCategories.clear();
  renderCatFilter();
  syncCatFilterButton();
  render();
});

// Fermeture au clic en dehors, comme le popover de période.
document.addEventListener('click', (event) => {
  if (catFilterPop.hidden) return;
  if (event.target.closest('#catFilter')) return;   // le bouton ou le popover lui-même
  closeCatFilter();
});

// Filtres de type.
filtersBar.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-filter]');
  if (!chip) return;

  activeFilter = chip.dataset.filter;
  for (const node of filtersBar.querySelectorAll('.chip')) {
    node.classList.toggle('is-active', node === chip);
  }
  render();
});

/* ---------------------------------------------------------
   Démarrage
   --------------------------------------------------------- */

transactions = loadTransactions();
buildCatTabs();
syncCatFilterButton();
refreshCategories();
refreshTypeFields();

timeFilter = createTimeFilter($('#timeBar'), {
  getTransactions: () => transactions,
  onChange: render,
});

render();
