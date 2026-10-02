/* =========================================================
   Finances perso — page Dashboard
   Indicateurs, Sankey des flux et graphique multi-courbes,
   tous construits à la main en SVG. Aucune dépendance.
   Les données viennent du même localStorage que la page Transactions.
   ========================================================= */

'use strict';

/* ---------------------------------------------------------
   Configuration des séries du graphique
   --------------------------------------------------------- */

/**
 * Séries disponibles. `axis` choisit l'échelle : 'money' (euros, axe gauche)
 * ou 'rate' (ratio affiché en %, axe droit).
 * La couleur vient de la feuille de style, via l'attribut `data-serie` posé sur
 * la courbe, ses points et sa chip : une seule source pour les trois. `dash`
 * distingue deux séries qui partagent la même teinte.
 */
const SERIES = [
  { key: 'depense',        label: 'Dépense',               axis: 'money', dash: '' },
  { key: 'revenu',         label: 'Revenu',                axis: 'money', dash: '' },
  { key: 'patrimoine',     label: 'Patrimoine',            axis: 'money', dash: '' },
  { key: 'epargne',        label: 'Épargne brute',         axis: 'money', dash: '6 3' },
  { key: 'investissement', label: 'Investissement brut',   axis: 'money', dash: '' },
  { key: 'tauxEpargne',    label: 'Taux d’épargne',        axis: 'rate',  dash: '2 3' },
  { key: 'tauxConso',      label: 'Taux de consommation',  axis: 'rate',  dash: '2 3' },
  { key: 'tauxInvest',     label: 'Taux d’investissement', axis: 'rate',  dash: '9 3 2 3' },
];

/** Séries visibles au chargement ; les autres s'activent via leur chip. */
const activeSeries = new Set(['revenu', 'depense']);

/* ---------------------------------------------------------
   État
   --------------------------------------------------------- */

let transactions = [];
let timeFilter = null;

/** Soldes de départ des deux comptes, saisis sur la page Comptes. */
let startBalances = loadAccounts();

/** Dernier jeu de données calculé, réutilisé par les rendus au redimensionnement. */
let weekly = [];

/* ---------------------------------------------------------
   Références DOM
   --------------------------------------------------------- */

const seriesChips = $('#seriesChips');
const sankeySvg   = $('#sankey');
const sankeyBody  = $('#sankeyBody');
const sankeyTip   = $('#sankeyTip');
const sankeyEmpty = $('#sankeyEmpty');
const chartSvg    = $('#chart');
const chartBody   = $('#chartBody');
const chartTip    = $('#chartTip');
const chartEmpty  = $('#chartEmpty');
const donutSvg    = $('#donut');
const donutBody   = $('#donutBody');
const donutTip    = $('#donutTip');
const donutLegend = $('#donutLegend');
const donutEmpty  = $('#donutEmpty');

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Crée un nœud SVG avec ses attributs. */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/* ---------------------------------------------------------
   Agrégation des données
   --------------------------------------------------------- */

/** Transactions retenues par le filtre temporel courant. */
function filtered() {
  return transactions.filter((tx) => timeFilter.matches(tx.date));
}

/**
 * Mois couverts par la période, dans l'ordre chronologique.
 * L'axe X du graphique et l'agrégation mensuelle s'appuient dessus.
 */
function monthsInScope() {
  const bounds = timeFilter.rangeBounds();
  const months = timeFilter.months();
  const { value: year, touched } = timeFilter.year();

  // Mode période exacte : tous les mois traversés par la plage.
  if (bounds) return enumerateMonths(bounds.start.slice(0, 7), bounds.end.slice(0, 7));

  // Mois explicitement sélectionnés sur l'année active.
  if (months.length) return months.map((m) => ({ y: year, m }));

  // Année choisie à la main, sans mois : les 12 mois de cette année.
  if (touched) return Array.from({ length: 12 }, (unused, m) => ({ y: year, m }));

  // Aucun filtre : toute l'étendue des données, ou le mois courant si vide.
  const dates = transactions.map((tx) => tx.date).sort();
  if (!dates.length) {
    const now = new Date();
    return [{ y: now.getFullYear(), m: now.getMonth() }];
  }
  return enumerateMonths(dates[0].slice(0, 7), dates[dates.length - 1].slice(0, 7));
}

/** Liste les mois entre deux clés AAAA-MM incluses. */
function enumerateMonths(fromKey, toKey) {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);

  const out = [];
  let y = fy;
  let m = fm - 1;

  // Garde-fou : on ne dessine jamais plus de 10 ans de colonnes.
  while ((y < ty || (y === ty && m <= tm - 1)) && out.length < 120) {
    out.push({ y, m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/**
 * Patrimoine à une date donnée : compte courant + épargne + investissements cumulés,
 * soldes de départ inclus. Cumulatif par nature, il ignore donc le filtre temporel
 * et se calcule sur tout l'historique antérieur à la date.
 */
function wealthAt(iso) {
  return balancesAt(transactions, startBalances, iso).patrimoine;
}

/** Dernier jour couvert par la période, pour le patrimoine de fin. */
function periodEnd() {
  const bounds = timeFilter.rangeBounds();
  if (bounds) return bounds.end;

  const months = monthsInScope();
  const last = months[months.length - 1];
  const end = endOfMonth(last.y, last.m);

  // Sans filtre, la période s'arrête à la dernière donnée connue.
  const dates = transactions.map((tx) => tx.date).sort();
  const latest = dates.length ? dates[dates.length - 1] : todayISO();
  return end > latest ? latest : end;
}

/* ---------------------------------------------------------
   Découpage hebdomadaire
   --------------------------------------------------------- */

/*
 * Le graphique d'évolution raisonne à la semaine : chaque point couvre sept
 * jours, du lundi au dimanche. L'agrégation reste bornée par le filtre temporel,
 * qui peut ne retenir qu'une partie d'une semaine.
 */

/** Intitulés d'une semaine : jour seul, jour + mois, jour + mois + année. */
const dayFormatter      = new Intl.DateTimeFormat('fr-FR', { day: 'numeric' });
const dayMonthFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const fullDayFormatter  = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Formate une date avec le « 1er » d'usage : Intl rend « 1 mars », que le
 * français écrit « 1er mars ».
 */
function frenchDate(formatter, date) {
  const text = formatter.format(date);
  return date.getDate() === 1 ? text.replace(/^1(?!\d)/, '1er') : text;
}

/** Lundi de la semaine contenant la date ISO donnée. */
function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const weekday = (d.getDay() + 6) % 7;   // 0 = lundi, 6 = dimanche
  d.setDate(d.getDate() - weekday);
  return toISO(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Date ISO décalée d'un nombre de jours, changements de mois et d'année compris. */
function shiftDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISO(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Premier et dernier jour couverts par la période sélectionnée.
 * Sans filtre explicite, `periodEnd` borne déjà la fin à la dernière donnée
 * connue : inutile de dessiner des semaines vides après.
 */
function periodBounds() {
  const bounds = timeFilter.rangeBounds();
  if (bounds) return { start: bounds.start, end: bounds.end };

  const months = monthsInScope();
  const first = months[0];
  return { start: toISO(first.y, first.m, 1), end: periodEnd() };
}

/**
 * Intitulé complet d'une semaine. Le mois du premier jour n'est répété que
 * lorsque la semaine est à cheval sur deux mois.
 * @returns {string} ex. « Semaine du 8 au 14 septembre 2026 »
 */
function weekTitle(start, end) {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);

  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  const head = frenchDate(sameMonth ? dayFormatter : dayMonthFormatter, from);

  return `Semaine du ${head} au ${frenchDate(fullDayFormatter, to)}`;
}

/** Vrai si au moins un jour de la semaine est retenu par le filtre temporel. */
function weekInScope(start) {
  for (let i = 0; i < 7; i += 1) {
    if (timeFilter.matches(shiftDays(start, i))) return true;
  }
  return false;
}

/**
 * Agrège les montants semaine par semaine sur la période sélectionnée.
 * Une semaine dont aucun jour n'est retenu (mois désélectionné au milieu de la
 * période) est omise : l'axe ne montre que des semaines réellement filtrées.
 */
function buildWeekly() {
  const { start, end } = periodBounds();
  const out = [];

  let cursor = mondayOf(start);

  // Garde-fou : on ne dessine jamais plus de cinq ans de points.
  while (cursor <= end && out.length < 260) {
    const last = shiftDays(cursor, 6);

    if (weekInScope(cursor)) {
      const rows = transactions.filter(
        (tx) => tx.date >= cursor && tx.date <= last && timeFilter.matches(tx.date),
      );

      const { income: revenu, expense: depense, invest: investissement } = totalsFor(rows, transactions);
      const epargne = revenu - depense;

      out.push({
        key: cursor,
        start: cursor,
        end: last,
        label: frenchDate(shortDateFormatter, new Date(`${cursor}T00:00:00`)),   // « 8 sept. », pour l'axe
        fullLabel: weekTitle(cursor, last),
        year: Number(cursor.slice(0, 4)),
        revenu,
        depense,
        investissement,
        epargne,
        // Le patrimoine est cumulatif : on le lit à la clôture de la semaine.
        patrimoine: wealthAt(last),
        // Les taux n'ont pas de sens sans revenus : null = trou dans la courbe.
        tauxEpargne: revenu > 0 ? epargne / revenu : null,
        tauxConso: revenu > 0 ? depense / revenu : null,
        tauxInvest: revenu > 0 ? investissement / revenu : null,
      });
    }

    cursor = shiftDays(cursor, 7);
  }

  return out;
}

/* ---------------------------------------------------------
   Indicateurs clés
   --------------------------------------------------------- */

function renderKpis() {
  const rows = filtered();
  const end = periodEnd();

  // Dépenses nettes des remboursements, qui ne comptent donc pas dans les revenus.
  const { income, expense, invest } = totalsFor(rows, transactions);

  $('#kpiIncome').textContent  = formatMoney(income);
  $('#kpiExpense').textContent = formatMoney(expense);
  $('#kpiInvest').textContent  = formatMoney(invest);
  $('#kpiWealth').textContent = formatMoney(wealthAt(end));
  $('#kpiWealthNote').textContent = `au ${formatShort(end)}`;
}

/* ---------------------------------------------------------
   Infobulles partagées
   --------------------------------------------------------- */

/**
 * Positionne une infobulle près du pointeur, en la gardant dans son conteneur.
 * @param {HTMLElement} tip   l'élément d'infobulle
 * @param {HTMLElement} host  le conteneur positionné en relatif
 */
function placeTip(tip, host, event) {
  const box = host.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;

  tip.hidden = false;

  // Mesure après affichage pour pouvoir recadrer.
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;

  const left = Math.min(Math.max(x - width / 2, 4), Math.max(box.width - width - 4, 4));
  const top = y - height - 12 < 0 ? y + 16 : y - height - 12;

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip(tip) {
  tip.hidden = true;
}

/* ---------------------------------------------------------
   Sankey
   --------------------------------------------------------- */

/**
 * Macro-catégorie d'une dépense. Le loyer forme sa propre branche, tout le reste
 * relève de la consommation courante.
 */
function macroForExpense(category) {
  return category === 'Loyer' ? 'loyer' : 'consommation';
}

/** Trie un dictionnaire catégorie -> montant, du plus gros au plus petit. */
function toSortedNodes(totals) {
  return [...totals.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Part du total en dessous de laquelle une catégorie de consommation est jugée
 * marginale, et le nombre à partir duquel les regrouper allège vraiment le
 * dessin : sous ce seuil, un flux « Autres » coûterait plus en lisibilité
 * (une ligne de moins, mais une information cachée) qu'il n'en ferait gagner.
 */
const MINOR_SHARE = 0.025;
const MIN_MINOR_COUNT = 3;

/**
 * Regroupe les catégories vraiment marginales sous un flux « Autres », placé en
 * dernier. Le détail complet reste servi par l'infobulle : on allège le dessin,
 * jamais l'information.
 */
function groupMinorNodes(nodes, reference) {
  const limit = reference * MINOR_SHARE;
  const minor = nodes.filter((node) => node.value < limit);

  // Regrouper une ou deux lignes ne gagne rien : autant les garder distinctes.
  if (minor.length < MIN_MINOR_COUNT) return nodes;

  const kept = nodes.filter((node) => node.value >= limit);
  const value = minor.reduce((total, node) => total + node.value, 0);

  // Le reliquat reste en bas de colonne même s'il pèse plus que la dernière
  // catégorie gardée : un fourre-tout se lit mieux en fin de liste.
  return [...kept, { label: `Autres (${minor.length})`, value, breakdown: minor }];
}

/**
 * Construit le modèle du Sankey : revenus par catégorie, macro-catégories,
 * et détail sous chaque macro. Les dépenses sont prises en montant NET.
 */
function buildFlowModel(rows) {
  const incomeTotals = new Map();
  const expenseTotals = new Map();
  const investTotals = new Map();

  for (const tx of rows) {
    if (tx.type === 'revenu') {
      // Un remboursement ne rentre pas comme revenu : il réduit sa dépense.
      if (isRefund(tx, transactions)) continue;
      incomeTotals.set(tx.category, (incomeTotals.get(tx.category) ?? 0) + tx.amount);
    } else if (tx.type === 'depense') {
      const net = netAmount(tx, transactions);
      if (net > 0) expenseTotals.set(tx.category, (expenseTotals.get(tx.category) ?? 0) + net);
    } else if (tx.type === 'investissement') {
      investTotals.set(tx.category, (investTotals.get(tx.category) ?? 0) + tx.amount);
    }
  }

  const incomes = toSortedNodes(incomeTotals);
  const expenses = toSortedNodes(expenseTotals);
  const invests = toSortedNodes(investTotals);

  const totalIncome = incomes.reduce((t, n) => t + n.value, 0);
  const totalExpense = expenses.reduce((t, n) => t + n.value, 0);
  const totalInvest = invests.reduce((t, n) => t + n.value, 0);

  // Reliquat ni dépensé ni investi. Négatif = on a puisé dans ses réserves : borné à 0.
  const epargne = Math.max(0, totalIncome - totalExpense - totalInvest);
  const totalOut = totalExpense + totalInvest + epargne;

  // Colonne 3 : macro-catégories, chacune détaillée en colonne 4 (sauf l'épargne).
  const consommation = expenses.filter((node) => macroForExpense(node.label) === 'consommation');
  const loyer = expenses.filter((node) => macroForExpense(node.label) === 'loyer');

  const macros = [];
  const pushMacro = (label, details) => {
    const value = details.reduce((t, n) => t + n.value, 0);
    if (value > 0) macros.push({ label, value, details });
  };

  // Seule la consommation est regroupée : c'est la branche qui accumule les
  // petites lignes, les autres n'en comptent qu'une poignée.
  pushMacro('Consommation', groupMinorNodes(consommation, totalOut));
  pushMacro('Loyer', loyer);
  pushMacro('Investissement', invests);
  if (epargne > 0) macros.push({ label: 'Épargne', value: epargne, details: [] });

  return { incomes, macros, totalIncome, totalOut };
}

function renderSankey() {
  const model = buildFlowModel(filtered());
  const { incomes, macros, totalIncome, totalOut } = model;

  // Rien à dessiner.
  if (totalIncome === 0 && totalOut === 0) {
    sankeySvg.replaceChildren();
    sankeySvg.setAttribute('height', '0');
    sankeyEmpty.hidden = false;
    return;
  }
  sankeyEmpty.hidden = true;

  /* -- Géométrie --
     Le diagramme tient toujours dans sa carte, en largeur comme en hauteur : rien
     ne déborde et rien ne défile. Quand la place manque, ce sont les éléments qui
     rétrécissent (police, épaisseurs, espacements), pas la carte qui s'allonge. */
  const width = Math.max(sankeyBody.clientWidth || 520, 240);
  const compact = width < 640;

  /* Largeur à partir de laquelle le dessin respire à sa taille nominale. En
     dessous, tout est réduit du même facteur, pour que les quatre colonnes et
     leurs libellés continuent de tenir côte à côte. */
  const COMFORT_WIDTH = 560;
  const fit = Math.max(0.6, Math.min(1, width / COMFORT_WIDTH));

  // La police des libellés suit le même facteur, via une variable lue par la
  // feuille de style : un attribut serait écrasé par la règle `.flow-label`.
  sankeySvg.style.setProperty('--sankey-fit', fit.toFixed(3));

  const nodeW = Math.max(5, 8 * fit);
  const gap = 9 * fit;                 // espace vertical entre deux nœuds d'une colonne
  const topPad = 26 * fit;             // place pour le libellé du nœud central
  const bottomPad = 10 * fit;
  const AMOUNT_LINE = 14 * fit;        // hauteur de la 2e ligne d'un libellé (le montant)

  /* -- Lisibilité des flux fins --
     Un ruban dont l'épaisseur proportionnelle passe sous le plancher est dessiné
     à ce plancher : il redevient visible et survolable. Il est alors signalé
     (opacité rabaissée et liseré, cf. `.flow.is-boosted`) pour ne pas se lire
     comme un flux réellement épais, et l'espace autour de lui s'élargit. */
  // Le plancher suit la réduction générale, mais jamais en dessous de 4px :
  // en deçà, un ruban cesse d'être visible, ce que ce plancher existe justement
  // pour éviter.
  const MIN_FLOW_H = Math.max(4, (compact ? 5 : 6) * fit);
  const detailGap = (compact ? 12 : 14) * fit;   // colonne 4, plus aérée que les autres
  const thinGap = (compact ? 17 : 20) * fit;     // entre deux flux portés au plancher
  const macroGap = (compact ? 20 : 24) * fit;    // changement de branche dans la colonne 4
  const hitH = compact ? 24 : 18;                // cible de survol : jamais réduite, c'est le doigt qui vise

  // Quatre colonnes réparties sur toute la largeur ; les libellés se posent
  // par-dessus les rubans, avec un liseré de fond pour rester lisibles.
  const span = width - nodeW;
  const xIncome = 0;
  const xTotal = span * 0.30;
  const xMacro = span * 0.63;
  const xDetail = span;

  // Toutes les feuilles de la colonne 4, dans l'ordre de leur macro-catégorie.
  // Chaque branche est déjà triée du plus gros au plus petit par toSortedNodes.
  const details = macros.flatMap((macro) => macro.details.map((node) => ({ ...node, macro })));

  const rowsCount = Math.max(incomes.length, macros.length, details.length, 1);
  const baseH = Math.max(compact ? 190 : 230, rowsCount * (compact ? 26 : 30));

  // Les espacements de la colonne la plus aérée sont retirés de la hauteur de
  // référence : l'échelle se règle sur la place restant aux rubans eux-mêmes.
  const reserve = Math.max(details.length - 1, 0) * detailGap;
  const scale = Math.max(baseH - reserve, baseH * 0.45) / Math.max(totalIncome, totalOut, 1);

  /**
   * Prépare une colonne pour un facteur de compression `k` : plancher
   * d'épaisseur appliqué, espacements calculés et hauteur totale mesurée.
   * Épaisseurs, planchers et espacements varient tous avec `k`, donc la hauteur
   * de la colonne lui est exactement proportionnelle — c'est ce qui permet de la
   * ramener dans la carte en une seule correction.
   * Le placement vertical vient ensuite, une fois connue la colonne la plus haute.
   */
  const measure = (list, x, gapFor, k) => {
    const boxes = list.map((node) => {
      const exact = node.value * scale * k;
      const h = Math.max(exact, MIN_FLOW_H * k);
      // `exact` reste la part proportionnelle : c'est elle qui pave les barres,
      // pour que l'échelle générale ne soit jamais faussée par le plancher.
      return { ...node, x, exact, h, boosted: h > exact + 0.01, y: 0 };
    });

    const gaps = boxes.slice(1).map((box, i) => gapFor(boxes[i], box) * k);
    const blockH = boxes.reduce((t, b) => t + b.h, 0) + gaps.reduce((t, g) => t + g, 0);

    return { boxes, gaps, blockH };
  };

  /** Pose une colonne mesurée, centrée verticalement dans le diagramme. */
  const place = (column, flowH) => {
    let y = topPad + (flowH - column.blockH) / 2;

    column.boxes.forEach((box, i) => {
      if (i) y += column.gaps[i - 1];
      box.y = y;
      y += box.h;
    });

    return column.boxes;
  };

  /** Colonnes 1 et 3 : espacement courant, élargi dès qu'un voisin est au plancher. */
  const plainGapFor = (a, b) => (a.boosted || b.boosted ? thinGap : gap);

  /** Colonne 4 : aérée, davantage encore entre deux flux fins ou deux branches. */
  const detailGapFor = (a, b) => {
    if (a.macro.label !== b.macro.label) return macroGap;
    return a.boosted || b.boosted ? thinGap : detailGap;
  };

  /** Mesure les trois colonnes d'un coup, pour un facteur de compression donné. */
  const measureAll = (k) => {
    const income = measure(incomes, xIncome, plainGapFor, k);
    const macro = measure(macros, xMacro, plainGapFor, k);
    const detail = measure(details, xDetail, detailGapFor, k);

    // Nœud central : hauteur du plus gros des deux côtés.
    const centerH = Math.max(totalIncome, totalOut) * scale * k;

    // Le diagramme prend la hauteur de sa colonne la plus haute.
    return { income, macro, detail, centerH,
      flowH: Math.max(income.blockH, macro.blockH, detail.blockH, centerH) };
  };

  /* Hauteur maximale tolérée dans la carte. Le diagramme ne défile pas : s'il ne
     tient pas, c'est lui qui se resserre, jamais la carte qui s'allonge. */
  const maxH = compact ? 300 : 360;

  // Une première mesure à taille pleine donne la hauteur voulue ; comme tout est
  // proportionnel au facteur, une seule correction suffit à tomber juste.
  const full = measureAll(1);
  const room = Math.max(maxH - topPad - bottomPad, 60);
  const squeeze = Math.min(1, room / Math.max(full.flowH, 1));

  const layout = squeeze === 1 ? full : measureAll(squeeze);
  const { centerH, flowH } = layout;

  // Échelle réellement appliquée : c'est elle qui pave les barres.
  const s = scale * squeeze;

  const height = flowH + topPad + bottomPad;

  const incomeNodes = place(layout.income, flowH);
  const macroNodes = place(layout.macro, flowH);
  const detailNodes = place(layout.detail, flowH);
  const centerY = topPad + (flowH - centerH) / 2;

  sankeySvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  sankeySvg.setAttribute('width', width);
  sankeySvg.setAttribute('height', height);
  sankeySvg.replaceChildren();

  /* -- Rubans -- */
  const allValues = [...incomes, ...macros, ...details].map((n) => n.value);
  const maxFlow = Math.max(...allValues, 1);

  /** Ruban de (x1,y1) vers (x2,y2), d'épaisseur h1 puis h2. */
  const ribbon = ({ x1, y1, h1, x2, y2, h2 }) => {
    const xm = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${xm} ${y1}, ${xm} ${y2}, ${x2} ${y2}`
      + ` L ${x2} ${y2 + h2} C ${xm} ${y2 + h2}, ${xm} ${y1 + h1}, ${x1} ${y1 + h1} Z`;
  };

  /** Ligne médiane du même ruban, support de la zone de survol élargie. */
  const centerLine = ({ x1, y1, h1, x2, y2, h2 }) => {
    const xm = (x1 + x2) / 2;
    const a = y1 + h1 / 2;
    const b = y2 + h2 / 2;
    return `M ${x1} ${a} C ${xm} ${a}, ${xm} ${b}, ${x2} ${b}`;
  };

  /**
   * Opacité selon le poids du flux. La plage est resserrée depuis l'arrivée de
   * la couleur : au-delà, les teintes claires deviennent indistinctes.
   * Un flux porté au plancher est rabaissé d'un cran : son épaisseur ne dit plus
   * sa taille, c'est à l'opacité de continuer à la dire.
   */
  const weight = (value, boosted) => {
    const base = 0.6 + 0.35 * (value / maxFlow);
    return (boosted ? base * 0.8 : base).toFixed(3);
  };

  /** Classe de couleur d'un flux, d'après sa macro-catégorie. */
  const flowClass = (label) => {
    const key = label.split(' → ')[0];
    if (key === 'Consommation') return 'is-consommation';
    if (key === 'Loyer') return 'is-loyer';
    if (key === 'Investissement') return 'is-investissement';
    if (key === 'Épargne') return 'is-epargne';
    return 'is-income';   // colonne 1 : les catégories de revenus
  };

  const linkLayer = svgEl('g');

  /**
   * Ajoute un ruban et, s'il est trop fin pour être visé confortablement, une
   * zone de survol invisible posée sur sa ligne médiane. Les deux vivent dans un
   * même groupe : viser l'une allume l'autre et sert la même infobulle.
   */
  const addLink = (geom, label, node, kind) => {
    const group = svgEl('g', { class: 'flow-group' });
    group.dataset.label = label;
    group.dataset.value = node.value;

    // Flux « Autres » : le détail regroupé voyage avec lui, pour l'infobulle.
    if (node.breakdown) {
      group.dataset.breakdown = JSON.stringify(node.breakdown.map((item) => [item.label, item.value]));
    }

    group.appendChild(svgEl('path', {
      d: ribbon(geom),
      class: `flow ${kind}${node.boosted ? ' is-boosted' : ''}`,
      'fill-opacity': weight(node.value, node.boosted),
    }));

    // L'extrémité la plus fine décide du confort de visée.
    const thin = Math.min(geom.h1, geom.h2);
    if (thin < hitH) {
      group.appendChild(svgEl('path', {
        d: centerLine(geom),
        class: 'flow-hit',
        // Jamais plus large que le flux et son espacement : la cible du voisin
        // reste atteignable.
        'stroke-width': Math.min(hitH, thin + detailGap),
      }));
    }

    linkLayer.appendChild(group);
  };

  // Colonne 1 → 2 : chaque catégorie de revenu vers le total. Le ruban part à
  // l'épaisseur du nœud et arrive à sa part exacte de la barre centrale, qu'il
  // faut paver sans trou : c'est `exact` qui fait avancer le curseur.
  let cursorIn = centerY + (centerH - totalIncome * s) / 2;
  for (const node of incomeNodes) {
    addLink(
      { x1: node.x + nodeW, y1: node.y, h1: node.h, x2: xTotal, y2: cursorIn, h2: node.exact },
      node.label, node, 'is-income',
    );
    cursorIn += node.exact;
  }

  // Colonne 2 → 3 : le total se répartit entre macro-catégories.
  let cursorOut = centerY + (centerH - totalOut * s) / 2;
  for (const node of macroNodes) {
    addLink(
      { x1: xTotal + nodeW, y1: cursorOut, h1: node.exact, x2: node.x, y2: node.y, h2: node.h },
      node.label, node, flowClass(node.label),
    );
    cursorOut += node.exact;
  }

  // Colonne 3 → 4 : chaque macro se détaille en catégories. Les détails pavent
  // la hauteur réelle de leur barre, plancher compris, pour qu'aucun filet de
  // fond ne reste visible entre deux départs.
  const macroCursor = new Map(macroNodes.map((node) => [node.label, node.y]));
  const macroShare = new Map(macroNodes.map((node) => {
    const exactTotal = node.details.reduce((t, n) => t + n.value * s, 0);
    return [node.label, exactTotal > 0 ? node.h / exactTotal : 0];
  }));

  for (const node of detailNodes) {
    const from = macroCursor.get(node.macro.label);
    const h = node.exact * macroShare.get(node.macro.label);

    addLink(
      { x1: xMacro + nodeW, y1: from, h1: h, x2: node.x, y2: node.y, h2: node.h },
      `${node.macro.label} → ${node.label}`, node, flowClass(node.macro.label),
    );
    macroCursor.set(node.macro.label, from + h);
  }

  sankeySvg.appendChild(linkLayer);

  /* -- Nœuds -- */
  const nodeLayer = svgEl('g');
  const bar = (x, y, h) => nodeLayer.appendChild(
    svgEl('rect', { x, y, width: nodeW, height: Math.max(h, 1.5), rx: 2, class: 'node' }),
  );

  for (const node of [...incomeNodes, ...macroNodes, ...detailNodes]) bar(node.x, node.y, node.h);
  bar(xTotal, centerY, centerH);

  sankeySvg.appendChild(nodeLayer);

  /* -- Libellés -- */
  const leaderLayer = svgEl('g');   // sous les textes : leur liseré masque le raccord
  const textLayer = svgEl('g');

  /**
   * Répartit les libellés verticalement sans chevauchement : on part du centre
   * de chaque nœud, on repousse vers le bas ce qui se superpose, puis une passe
   * retour remonte la pile si elle a débordé sous le diagramme.
   */
  const layoutLabels = (list) => {
    const minStep = (compact ? 23 : 25) * fit;

    let previous = -Infinity;
    const placed = list.map((node) => {
      const y = Math.max(node.y + node.h / 2, previous + minStep);
      previous = y;
      return { node, y };
    });

    // Le libellé tient sur deux lignes : c'est la seconde, le montant, qui doit
    // rester dans le cadre.
    let limit = height - bottomPad - AMOUNT_LINE;
    for (let i = placed.length - 1; i >= 0; i -= 1) {
      placed[i].y = Math.min(placed[i].y, limit);
      limit = placed[i].y - minStep;
    }

    // Cas dégénéré (colonne plus chargée que haute) : mieux vaut resserrer en
    // haut que déborder du cadre.
    for (const item of placed) item.y = Math.max(item.y, topPad);

    return placed;
  };

  /**
   * Tronque un libellé qui déborderait de la gouttière qui lui est réservée.
   * Sur une carte étroite, mieux vaut « Investisse… » qu'un texte qui chevauche
   * la colonne voisine.
   */
  const clampLabel = (text, room) => {
    const perChar = 5.6 * fit;                    // largeur moyenne à cette taille
    const max = Math.max(5, Math.floor(room / perChar));
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };

  const addLabel = (node, y, anchor, x, room) => {
    const middle = node.y + node.h / 2;
    const edge = anchor === 'end' ? node.x : node.x + nodeW;

    // Libellé repoussé pour éviter un chevauchement : un trait fin le raccroche
    // à sa barre, sans quoi on ne saurait plus de quel flux il parle.
    if (Math.abs(y - middle) > 2) {
      const near = anchor === 'end' ? x + 2 : x - 2;
      leaderLayer.appendChild(svgEl('path', {
        d: `M ${near} ${y} L ${(near + edge) / 2} ${y} L ${edge} ${middle}`,
        class: 'flow-leader',
      }));
    }

    const text = svgEl('text', { x, y, 'text-anchor': anchor, class: 'flow-label' });
    text.appendChild(svgEl('tspan', { x, dy: '-0.1em' })).textContent = clampLabel(node.label, room);

    const amount = svgEl('tspan', { x, dy: '1.4em', class: 'flow-amount' });
    amount.textContent = formatCompact(node.value);
    text.appendChild(amount);

    // Un flux porté au plancher garde un libellé pleinement lisible : c'est lui
    // qui porte désormais l'information de montant.
    if (node.boosted) text.classList.add('is-thin');

    textLayer.appendChild(text);
  };

  // Colonne 1 à droite de sa barre, colonnes 3 et 4 à gauche de la leur :
  // chaque gouttière ne reçoit ainsi qu'une seule série de libellés.
  // Chaque série dispose de la gouttière qui la sépare de la colonne voisine.
  const incomeX = xIncome + nodeW + 7;
  const macroX = xMacro - 7;
  const detailX = xDetail - 7;

  for (const { node, y } of layoutLabels(incomeNodes)) {
    addLabel(node, y, 'start', incomeX, xTotal - incomeX);
  }
  for (const { node, y } of layoutLabels(macroNodes)) {
    addLabel(node, y, 'end', macroX, macroX - (xTotal + nodeW));
  }
  for (const { node, y } of layoutLabels(detailNodes)) {
    addLabel(node, y, 'end', detailX, detailX - (xMacro + nodeW));
  }

  // Libellé du nœud central, posé au-dessus de la barre.
  const centerLabel = svgEl('text', {
    x: xTotal + nodeW / 2,
    y: 14,
    'text-anchor': 'middle',
    class: 'flow-label is-center',
  });
  centerLabel.textContent = `Revenus totaux · ${formatCompact(totalIncome)}`;
  textLayer.appendChild(centerLabel);

  sankeySvg.appendChild(leaderLayer);
  sankeySvg.appendChild(textLayer);
}

/* -- Infobulle du Sankey (souris et tactile) -- */
function handleSankeyPointer(event) {
  // Le groupe porte le ruban et sa zone de survol élargie : viser l'un ou
  // l'autre donne la même infobulle.
  const group = event.target.closest('.flow-group');
  if (!group) return hideTip(sankeyTip);

  sankeyTip.innerHTML = '';
  sankeyTip.append(
    el('strong', null, group.dataset.label),
    el('span', null, formatMoney(Number(group.dataset.value))),
  );

  // Flux « Autres » : les catégories regroupées sont listées sous le total.
  if (group.dataset.breakdown) {
    for (const [label, value] of JSON.parse(group.dataset.breakdown)) {
      sankeyTip.appendChild(el('span', 'tip-row', `${label} · ${formatMoney(value)}`));
    }
  }

  placeTip(sankeyTip, sankeyBody, event);
}
sankeySvg.addEventListener('pointermove', handleSankeyPointer);
sankeySvg.addEventListener('pointerdown', handleSankeyPointer);
sankeySvg.addEventListener('pointerleave', () => hideTip(sankeyTip));

/* ---------------------------------------------------------
   Graphique multi-courbes
   --------------------------------------------------------- */

/** Chips de sélection des séries, construites une seule fois. */
function buildSeriesChips() {
  const fragment = document.createDocumentFragment();

  for (const serie of SERIES) {
    const chip = el('button', 'chip chip-serie');
    chip.type = 'button';
    chip.dataset.serie = serie.key;

    // Aperçu du trait : reprend le pointillé et la couleur de la courbe.
    const swatch = svgEl('svg', { viewBox: '0 0 16 4', class: 'swatch', 'aria-hidden': 'true' });
    swatch.appendChild(svgEl('line', {
      x1: 0, y1: 2, x2: 16, y2: 2,
      'stroke-dasharray': serie.dash || 'none',
    }));

    chip.append(swatch, el('span', null, serie.label));
    fragment.appendChild(chip);
  }

  seriesChips.replaceChildren(fragment);
  syncSeriesChips();
}

function syncSeriesChips() {
  for (const chip of seriesChips.children) {
    const on = activeSeries.has(chip.dataset.serie);
    chip.classList.toggle('is-active', on);
    chip.setAttribute('aria-pressed', String(on));
  }
}

/** Formate une valeur selon l'axe de sa série. */
function formatSerieValue(serie, value) {
  if (value === null || value === undefined) return '—';
  return serie.axis === 'rate' ? formatPercent(value) : formatMoney(value);
}

/** Bornes arrondies d'un ensemble de valeurs, 0 toujours inclus. */
function niceDomain(values) {
  const clean = values.filter((v) => v !== null && Number.isFinite(v));
  if (!clean.length) return { min: 0, max: 1, ticks: [0, 1] };

  let min = Math.min(0, ...clean);
  let max = Math.max(0, ...clean);
  if (min === max) max = min + 1;

  const step = niceStep((max - min) / 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;

  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { min, max, ticks };
}

/** Arrondit un pas d'axe à 1, 2, 5 ou 10 × une puissance de 10. */
function niceStep(raw) {
  const exponent = Math.floor(Math.log10(Math.abs(raw) || 1));
  const magnitude = 10 ** exponent;
  const normalized = raw / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

function renderChart() {
  const shown = SERIES.filter((s) => activeSeries.has(s.key));

  chartEmpty.hidden = shown.length > 0;
  if (!shown.length || !weekly.length) {
    chartSvg.replaceChildren();
    chartSvg.setAttribute('height', '0');
    return;
  }

  const moneySeries = shown.filter((s) => s.axis === 'money');
  const rateSeries = shown.filter((s) => s.axis === 'rate');

  /* -- Géométrie --
     À la semaine, une année tient 52 points : plutôt que de les tasser jusqu'à
     l'illisible, on garde un pas minimal et on laisse la carte défiler
     horizontalement quand la période dépasse la largeur disponible. */
  const available = chartBody.clientWidth || 320;
  const compact = available < 520;
  const height = compact ? 250 : 300;

  const padT = 14;
  const padB = 28;
  const padL = moneySeries.length ? (compact ? 46 : 58) : 10;
  const padR = rateSeries.length ? (compact ? 40 : 50) : 10;

  const count = weekly.length;

  // Pas minimal entre deux semaines : en deçà, points et repères se confondent.
  const minStep = compact ? 18 : 24;
  const roomW = Math.max(available - padL - padR, 10);
  const innerW = Math.max(roomW, (count - 1) * minStep);

  const width = padL + innerW + padR;
  const innerH = height - padT - padB;

  // Le conteneur ne défile que si le tracé dépasse réellement la largeur offerte.
  chartBody.classList.toggle('is-scrollable', width > available + 1);

  chartSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  chartSvg.setAttribute('width', width);
  chartSvg.setAttribute('height', height);
  chartSvg.replaceChildren();

  /* -- Échelles -- */
  const moneyDomain = niceDomain(moneySeries.flatMap((s) => weekly.map((row) => row[s.key])));
  const rateDomain = niceDomain(rateSeries.flatMap((s) => weekly.map((row) => row[s.key])));

  const step = count > 1 ? innerW / (count - 1) : 0;
  const xAt = (i) => (count > 1 ? padL + i * step : padL + innerW / 2);

  const yAt = (value, axis) => {
    const domain = axis === 'rate' ? rateDomain : moneyDomain;
    const span = domain.max - domain.min || 1;
    return padT + innerH - ((value - domain.min) / span) * innerH;
  };

  /* -- Grille et axes -- */
  const gridLayer = svgEl('g');
  const axisSource = moneySeries.length ? moneyDomain : rateDomain;
  const axisKind = moneySeries.length ? 'money' : 'rate';

  for (const tick of axisSource.ticks) {
    const y = yAt(tick, axisKind);
    gridLayer.appendChild(svgEl('line', { x1: padL, y1: y, x2: padL + innerW, y2: y, class: 'grid' }));
  }
  chartSvg.appendChild(gridLayer);

  const axisLayer = svgEl('g');

  if (moneySeries.length) {
    for (const tick of moneyDomain.ticks) {
      const label = svgEl('text', { x: padL - 8, y: yAt(tick, 'money') + 3, 'text-anchor': 'end', class: 'axis-label' });
      label.textContent = formatCompact(tick);
      axisLayer.appendChild(label);
    }
  }

  if (rateSeries.length) {
    for (const tick of rateDomain.ticks) {
      const label = svgEl('text', { x: padL + innerW + 8, y: yAt(tick, 'rate') + 3, 'text-anchor': 'start', class: 'axis-label' });
      label.textContent = `${Math.round(tick * 100)} %`;
      axisLayer.appendChild(label);
    }
  }

  /* Libellés de semaines : on n'en affiche qu'un sur N, calculé d'après la place
     réelle qu'occupe un libellé, pour qu'ils ne se chevauchent jamais. */
  const labelW = compact ? 52 : 62;         // « 8 sept. 26 » au gabarit de l'axe
  const every = Math.max(1, Math.ceil(labelW / Math.max(step, 1)));

  // L'année n'est rappelée que si la période en traverse plusieurs.
  const multiYear = count > 0 && weekly[0].year !== weekly[count - 1].year;

  weekly.forEach((row, i) => {
    // Toujours la première et la dernière semaine : elles bornent la période.
    if (i % every !== 0 && i !== count - 1) return;

    // ...sauf si la dernière tombe trop près de la précédente affichée.
    if (i === count - 1 && i % every !== 0 && (i % every) * step < labelW) return;

    const label = svgEl('text', { x: xAt(i), y: height - 9, 'text-anchor': 'middle', class: 'axis-label' });
    label.textContent = multiYear ? `${row.label} ${String(row.year).slice(2)}` : row.label;
    axisLayer.appendChild(label);
  });

  chartSvg.appendChild(axisLayer);

  /* -- Zones de survol par semaine (sous les courbes) -- */
  const bandLayer = svgEl('g');
  weekly.forEach((row, i) => {
    const bandW = count > 1 ? step : innerW;
    const band = svgEl('rect', {
      x: xAt(i) - bandW / 2,
      y: padT,
      width: bandW,
      height: innerH,
      fill: 'transparent',
    });
    band.dataset.band = String(i);
    bandLayer.appendChild(band);
  });
  chartSvg.appendChild(bandLayer);

  // Trait vertical de repère, déplacé au survol.
  const guide = svgEl('line', { y1: padT, y2: padT + innerH, class: 'guide', visibility: 'hidden' });
  chartSvg.appendChild(guide);

  /* -- Courbes -- */
  const lineLayer = svgEl('g');

  for (const serie of shown) {
    // Un trou (taux sans revenu) coupe la courbe en plusieurs segments.
    let segment = [];
    const segments = [];

    weekly.forEach((row, i) => {
      const value = row[serie.key];
      if (value === null || !Number.isFinite(value)) {
        if (segment.length) segments.push(segment);
        segment = [];
        return;
      }
      segment.push(`${xAt(i)} ${yAt(value, serie.axis)}`);
    });
    if (segment.length) segments.push(segment);

    for (const points of segments) {
      // Un point isolé n'a pas de tracé : seul son marqueur le représente.
      if (points.length < 2) continue;
      const line = svgEl('path', {
        d: `M ${points.join(' L ')}`,
        class: 'serie-line',
        'stroke-dasharray': serie.dash || 'none',
      });
      line.dataset.serie = serie.key;   // la couleur vient du CSS
      lineLayer.appendChild(line);
    }
  }

  chartSvg.appendChild(lineLayer);

  /* -- Points et zones de survol ponctuelles -- */
  const pointLayer = svgEl('g');

  for (const serie of shown) {
    weekly.forEach((row, i) => {
      const value = row[serie.key];
      if (value === null || !Number.isFinite(value)) return;

      const cx = xAt(i);
      const cy = yAt(value, serie.axis);

      const dot = svgEl('circle', { cx, cy, r: 3, class: 'serie-dot' });
      dot.dataset.serie = serie.key;
      pointLayer.appendChild(dot);

      // Cible de survol élargie, invisible, posée par-dessus le point.
      const hit = svgEl('circle', { cx, cy, r: 11, fill: 'transparent' });
      hit.dataset.point = serie.key;
      hit.dataset.index = String(i);
      pointLayer.appendChild(hit);
    });
  }

  chartSvg.appendChild(pointLayer);

  // Mémorise de quoi positionner le repère lors des survols.
  chartSvg.__guide = { guide, xAt };
}

/* -- Infobulles du graphique -- */
function handleChartPointer(event) {
  const shown = SERIES.filter((s) => activeSeries.has(s.key));
  if (!shown.length) return;

  const point = event.target.closest('[data-point]');
  const band = event.target.closest('[data-band]');
  const guide = chartSvg.__guide;

  // a) Survol d'un point : semaine + valeur de cette seule courbe.
  if (point) {
    const serie = SERIES.find((s) => s.key === point.dataset.point);
    const row = weekly[Number(point.dataset.index)];

    chartTip.innerHTML = '';
    chartTip.append(
      el('strong', null, row.fullLabel),
      el('span', 'tip-row', `${serie.label} : ${formatSerieValue(serie, row[serie.key])}`),
    );
    placeTip(chartTip, chartBody, event);

    if (guide) {
      guide.guide.setAttribute('x1', guide.xAt(Number(point.dataset.index)));
      guide.guide.setAttribute('x2', guide.xAt(Number(point.dataset.index)));
      guide.guide.setAttribute('visibility', 'visible');
    }
    return;
  }

  // b) Survol d'une graduation de l'axe X : toutes les courbes actives pour cette semaine.
  if (band) {
    const index = Number(band.dataset.band);
    const row = weekly[index];

    chartTip.innerHTML = '';
    chartTip.appendChild(el('strong', null, row.fullLabel));
    for (const serie of shown) {
      chartTip.appendChild(el('span', 'tip-row', `${serie.label} : ${formatSerieValue(serie, row[serie.key])}`));
    }
    placeTip(chartTip, chartBody, event);

    if (guide) {
      guide.guide.setAttribute('x1', guide.xAt(index));
      guide.guide.setAttribute('x2', guide.xAt(index));
      guide.guide.setAttribute('visibility', 'visible');
    }
    return;
  }

  hideChartTip();
}

function hideChartTip() {
  hideTip(chartTip);
  if (chartSvg.__guide) chartSvg.__guide.guide.setAttribute('visibility', 'hidden');
}

chartSvg.addEventListener('pointermove', handleChartPointer);
chartSvg.addEventListener('pointerdown', handleChartPointer);
chartSvg.addEventListener('pointerleave', hideChartTip);

// Chips de séries : activation/désactivation indépendante.
seriesChips.addEventListener('click', (event) => {
  const chip = event.target.closest('[data-serie]');
  if (!chip) return;

  const key = chip.dataset.serie;
  if (activeSeries.has(key)) activeSeries.delete(key);
  else activeSeries.add(key);

  syncSeriesChips();
  hideChartTip();
  renderChart();
});

/* ---------------------------------------------------------
   Donut de répartition du patrimoine
   --------------------------------------------------------- */

/**
 * Parts du patrimoine à la fin de la période : la liquidité des deux comptes,
 * puis une part par catégorie d'investissement.
 */
function buildWealthParts(iso) {
  const { courant, epargne } = balancesAt(transactions, startBalances, iso);

  const parts = [];
  const liquid = courant + epargne;
  if (liquid > 0) parts.push({ label: 'Liquidité', value: liquid });

  const totals = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'investissement' || tx.date > iso) continue;
    totals.set(tx.category, (totals.get(tx.category) ?? 0) + tx.amount);
  }

  const invests = [...totals.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  return [...parts, ...invests];
}

/** Nombre de teintes du cycle défini dans la feuille de style. */
const SLICE_SHADES = 6;

/** Arc de couronne entre deux angles, en radians. */
function donutArc(cx, cy, rOuter, rInner, from, to) {
  const large = to - from > Math.PI ? 1 : 0;
  const at = (r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

  const [x0, y0] = at(rOuter, from);
  const [x1, y1] = at(rOuter, to);
  const [x2, y2] = at(rInner, to);
  const [x3, y3] = at(rInner, from);

  return `M ${x0} ${y0} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`
    + ` L ${x2} ${y2} A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3} Z`;
}

function renderDonut() {
  const parts = buildWealthParts(periodEnd());
  const total = parts.reduce((sum, part) => sum + part.value, 0);

  donutEmpty.hidden = total > 0;
  if (total <= 0) {
    donutSvg.replaceChildren();
    donutSvg.setAttribute('height', '0');
    donutLegend.replaceChildren();
    return;
  }

  /* -- Géométrie -- */
  const width = Math.min(donutBody.clientWidth || 240, 260);
  const size = Math.max(Math.min(width, 260), 180);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 4;
  const rInner = rOuter * 0.62;

  donutSvg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  donutSvg.setAttribute('width', size);
  donutSvg.setAttribute('height', size);
  donutSvg.replaceChildren();

  const sliceLayer = svgEl('g');
  let angle = -Math.PI / 2;   // on démarre en haut

  parts.forEach((part, index) => {
    const sweep = (part.value / total) * Math.PI * 2;

    // La teinte vient du CSS : on ne pose que sa position dans le cycle.
    part.shade = String(index % SLICE_SHADES);
    part.share = part.value / total;

    // Une part unique couvre le cercle entier : un arc dégénérerait, on trace un anneau.
    const node = parts.length === 1
      ? svgEl('circle', {
        cx, cy, r: (rOuter + rInner) / 2,
        class: 'slice is-ring',
        'stroke-width': rOuter - rInner,
      })
      : svgEl('path', { d: donutArc(cx, cy, rOuter, rInner, angle, angle + sweep), class: 'slice' });

    node.dataset.slice = String(index);
    node.dataset.shade = part.shade;
    sliceLayer.appendChild(node);

    angle += sweep;
  });

  donutSvg.appendChild(sliceLayer);

  // Total au centre de la couronne.
  const label = svgEl('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'donut-total' });
  label.textContent = formatCompact(total);
  donutSvg.appendChild(label);

  const caption = svgEl('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', class: 'donut-caption' });
  caption.textContent = 'Patrimoine';
  donutSvg.appendChild(caption);

  /* -- Légende -- */
  const fragment = document.createDocumentFragment();

  parts.forEach((part, index) => {
    const item = el('li', 'legend-row');
    item.dataset.slice = String(index);

    const swatch = el('span', 'legend-swatch');
    swatch.dataset.shade = part.shade;   // même teinte que la part correspondante

    item.append(
      swatch,
      el('span', 'legend-label', part.label),
      el('span', 'legend-value', formatMoney(part.value)),
      el('span', 'legend-share', formatPercent(part.share)),
    );

    fragment.appendChild(item);
  });

  donutLegend.replaceChildren(fragment);

  // Mémorise les parts pour l'infobulle.
  donutSvg.__parts = parts;
}

/* -- Infobulle du donut (souris et tactile) -- */
function handleDonutPointer(event) {
  const slice = event.target.closest('[data-slice]');
  if (!slice || !donutSvg.__parts) return hideTip(donutTip);

  const part = donutSvg.__parts[Number(slice.dataset.slice)];
  if (!part) return hideTip(donutTip);

  donutTip.innerHTML = '';
  donutTip.append(
    el('strong', null, part.label),
    el('span', 'tip-row', `${formatMoney(part.value)} · ${formatPercent(part.share)}`),
  );
  placeTip(donutTip, donutBody, event);
}

donutSvg.addEventListener('pointermove', handleDonutPointer);
donutSvg.addEventListener('pointerdown', handleDonutPointer);
donutSvg.addEventListener('pointerleave', () => hideTip(donutTip));

/* ---------------------------------------------------------
   Rendu global
   --------------------------------------------------------- */

/** Recalcule tout : indicateurs, Sankey et graphique. */
function render() {
  weekly = buildWeekly();

  hideTip(sankeyTip);
  hideTip(donutTip);
  hideChartTip();

  renderKpis();
  renderSankey();
  renderChart();
  renderDonut();
}

// Les deux SVG sont dimensionnés en pixels : on les redessine au redimensionnement.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderSankey();
    renderChart();
    renderDonut();
  }, 150);
});

/* ---------------------------------------------------------
   Démarrage
   --------------------------------------------------------- */

transactions = loadTransactions();
buildSeriesChips();

timeFilter = createTimeFilter($('#timeBar'), {
  getTransactions: () => transactions,
  onChange: render,
});

render();
