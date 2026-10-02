/* =========================================================
   Finances perso — page Comptes
   Deux comptes fixes, alimentés automatiquement par les transactions,
   et le patrimoine qui en découle. Aucune dépendance.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   État
   --------------------------------------------------------- */

const transactions = loadTransactions();

/** Soldes de départ, seule donnée saisie à la main sur cette page. */
let startBalances = loadAccounts();

/** Sélecteur de période, partagé avec les autres pages. */
let timeFilter = null;

/* ---------------------------------------------------------
   Références DOM
   --------------------------------------------------------- */

const startInputs = {
  courant: $('#startCourant'),
  epargne: $('#startEpargne'),
};

/* ---------------------------------------------------------
   Rendu
   --------------------------------------------------------- */

/**
 * Transactions prises en compte : les soldes étant cumulatifs, on retient tout ce
 * qui précède la fin de la période plutôt que la période seule.
 */
function upTo(iso) {
  return iso ? transactions.filter((tx) => tx.date <= iso) : transactions;
}

/** Compte le nombre de transactions qui touchent un compte donné. */
function countMoves(account, scope) {
  return scope.filter((tx) => accountDelta(tx, scope)[account] !== 0).length;
}

/** Cumul investi par catégorie, du plus gros au plus petit. */
function investmentsByCategory(scope) {
  const totals = new Map();

  for (const tx of scope) {
    if (tx.type !== 'investissement') continue;
    totals.set(tx.category, (totals.get(tx.category) ?? 0) + tx.amount);
  }

  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function render() {
  const end = timeFilter.endDate();
  const scope = upTo(end);

  const { courant, epargne, investments, patrimoine } = balancesAt(transactions, startBalances, end);

  $('#wealthTotal').textContent    = formatMoney(patrimoine);
  $('#balanceCourant').textContent = formatMoney(courant);
  $('#balanceEpargne').textContent = formatMoney(epargne);
  $('#balanceInvest').textContent  = formatMoney(investments);

  // Accent chaud sur un compte à découvert ou un patrimoine négatif.
  $('#wealthTotal').classList.toggle('is-alert', patrimoine < 0);
  $('#balanceCourant').classList.toggle('is-alert', courant < 0);
  $('#balanceEpargne').classList.toggle('is-alert', epargne < 0);

  // Rappel de la période prise en compte.
  $('#wealthNote').textContent = end
    ? `Compte courant + Épargne + Investissements, au ${formatShort(end)}`
    : 'Compte courant + Épargne + Investissements';

  // Rappel de la composition de chaque solde.
  $('#detailCourant').textContent =
    `${formatMoney(startBalances.courant)} de départ · ${countMoves('courant', scope)} mouvement(s)`;
  $('#detailEpargne').textContent =
    `${formatMoney(startBalances.epargne)} de départ · ${countMoves('epargne', scope)} mouvement(s)`;

  // Détail par catégorie d'investissement.
  const rows = investmentsByCategory(scope);
  const fragment = document.createDocumentFragment();

  for (const row of rows) {
    const item = el('li', 'breakdown-row');
    item.append(
      el('span', 'breakdown-label', row.label),
      el('span', 'breakdown-value', formatMoney(row.value)),
    );
    fragment.appendChild(item);
  }

  if (!rows.length) {
    fragment.appendChild(el('li', 'breakdown-empty', 'Aucun investissement enregistré.'));
  }

  $('#investBreakdown').replaceChildren(fragment);
}

/* ---------------------------------------------------------
   Soldes de départ
   --------------------------------------------------------- */

/** Enregistre un solde de départ saisi et recalcule tout. */
function updateStart(account, raw) {
  const value = Number.parseFloat(raw);

  // Une saisie vide ou invalide retombe sur zéro plutôt que de casser les soldes.
  startBalances[account] = Number.isFinite(value) ? value : 0;
  startInputs[account].value = String(startBalances[account]);

  saveAccounts(startBalances);
  render();
}

for (const [account, input] of Object.entries(startInputs)) {
  input.value = String(startBalances[account]);
  input.addEventListener('change', () => updateStart(account, input.value));
}

/* ---------------------------------------------------------
   Démarrage
   --------------------------------------------------------- */

timeFilter = createTimeFilter($('#timeBar'), {
  getTransactions: () => transactions,
  onChange: render,
});

render();
