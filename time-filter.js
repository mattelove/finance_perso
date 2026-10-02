/* =========================================================
   Finances perso — composant de filtre temporel
   Barre "Plus précis" (période exacte) / mois / année, partagée
   entre la page Transactions et le Dashboard.
   Construit son propre DOM dans le conteneur qu'on lui passe,
   pour que les deux pages restent strictement identiques.
   ========================================================= */

'use strict';

/**
 * Instancie la barre de filtre temporel.
 *
 * @param {HTMLElement} root        conteneur vide qui recevra la barre
 * @param {object}      options
 * @param {Function}    options.getTransactions  renvoie la liste courante des transactions
 * @param {Function}    options.onChange         appelé à chaque changement de filtre
 * @returns {{ matches: Function, months: Function, year: Function, rangeBounds: Function }}
 */
function createTimeFilter(root, options) {
  const getTransactions = options.getTransactions;
  const onChange = options.onChange || (() => {});

  /* -- État : deux modes mutuellement exclusifs --
     mois/année (selectedMonths + activeYear) ou période exacte (range). */

  /** Mois sélectionnés, en index 0-11. Vide = aucun filtre de mois. */
  const selectedMonths = new Set();

  /** Année de référence des mois sélectionnés. */
  let activeYear = initialYear();

  /** Vrai dès que l'utilisateur change l'année lui-même : l'année filtre alors
      même si aucun mois n'est sélectionné. */
  let yearTouched = false;

  /** Période exacte. Active seulement quand les deux bornes sont posées. */
  let range = { start: null, end: null };

  /** Mois affiché dans le calendrier du popover, sous forme { y, m }. */
  let calCursor = { y: activeYear, m: new Date().getMonth() };

  /* ---------------------------------------------------------
     Construction du DOM
     --------------------------------------------------------- */

  root.classList.add('time-bar');
  root.innerHTML = `
    <!-- Ligne du haut : période exacte et raccourcis -->
    <div class="time-top">
      <div class="precise">
        <button type="button" class="chip chip-precise" aria-haspopup="dialog" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-sm">
            <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
          </svg>
          <span data-precise-label>Plus précis</span>
        </button>

        <div class="popover card" role="dialog" aria-label="Choisir une période" hidden>
          <div class="cal-head">
            <button type="button" class="step" data-cal-prev aria-label="Mois précédent">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-sm"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <span class="cal-title" aria-live="polite"></span>
            <button type="button" class="step" data-cal-next aria-label="Mois suivant">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-sm"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          </div>

          <div class="cal-dow" aria-hidden="true">
            <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
          </div>

          <div class="cal-grid"></div>

          <div class="cal-foot">
            <p class="cal-range"></p>
            <button type="button" class="btn-link" data-cal-reset>Réinitialiser</button>
          </div>
        </div>
      </div>

      <!-- Raccourcis : appliqués immédiatement, sans confirmation -->
      <button type="button" class="chip" data-preset="year">Cette année</button>
      <button type="button" class="chip" data-preset="month">Ce mois-ci</button>
    </div>

    <!-- Ligne du bas : les 12 mois, puis l'année de référence -->
    <div class="time-main">
      <div class="month-chips" role="group" aria-label="Filtrer par mois"></div>

      <div class="year-picker">
        <button type="button" class="step" data-year-prev aria-label="Année précédente">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-sm"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span class="year-label" aria-live="polite"></span>
        <button type="button" class="step" data-year-next aria-label="Année suivante">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-sm"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  `;

  const monthChips   = $('.month-chips', root);
  const yearLabel    = $('.year-label', root);
  const preciseBtn   = $('.chip-precise', root);
  const preciseLabel = $('[data-precise-label]', root);
  const precisePop   = $('.popover', root);
  const calTitle     = $('.cal-title', root);
  const calGrid      = $('.cal-grid', root);
  const calRangeText = $('.cal-range', root);

  /* ---------------------------------------------------------
     Logique de filtrage
     --------------------------------------------------------- */

  /** Vrai quand une période exacte complète est définie. */
  function hasRange() {
    return Boolean(range.start && range.end);
  }

  /**
   * Année affichée au premier chargement : l'année en cours si elle contient au moins
   * une transaction, sinon l'année la plus récente présente dans les données.
   */
  function initialYear() {
    const current = new Date().getFullYear();
    const years = getTransactions().map((tx) => Number(tx.date.slice(0, 4))).filter(Number.isFinite);

    if (!years.length || years.includes(current)) return current;
    return Math.max(...years);
  }

  /**
   * Teste une date AAAA-MM-JJ contre le filtre temporel actif.
   * Le format ISO permet de comparer directement les chaînes.
   */
  function matches(iso) {
    if (hasRange()) return iso >= range.start && iso <= range.end;

    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7)) - 1;

    // Sans mois sélectionné, on ne filtre sur l'année que si elle a été changée à la main.
    if (selectedMonths.size === 0) return yearTouched ? year === activeYear : true;

    return year === activeYear && selectedMonths.has(month);
  }

  /** Quitte le mode période exacte (appelé dès qu'on touche aux mois ou à l'année). */
  function clearRange() {
    range = { start: null, end: null };
  }

  /* ---------------------------------------------------------
     Rendu de la barre
     --------------------------------------------------------- */

  /** Construit les 12 chips de mois une seule fois. */
  function buildMonthChips() {
    const fragment = document.createDocumentFragment();

    MONTHS.forEach((label, index) => {
      const chip = el('button', 'chip', label);
      chip.type = 'button';
      chip.dataset.month = String(index);
      chip.setAttribute('aria-pressed', 'false');
      fragment.appendChild(chip);
    });

    monthChips.replaceChildren(fragment);
  }

  /** Reflète l'état du filtre sur la barre (chips, année, bouton "Plus précis"). */
  function renderBar() {
    const rangeOn = hasRange();

    for (const chip of monthChips.children) {
      const active = !rangeOn && selectedMonths.has(Number(chip.dataset.month));
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', String(active));
    }

    yearLabel.textContent = String(activeYear);
    root.classList.toggle('is-range', rangeOn);

    // Le bouton affiche la période choisie et passe en actif, pour rendre le mode visible.
    preciseBtn.classList.toggle('is-active', rangeOn);
    preciseLabel.textContent = rangeOn
      ? `${formatShort(range.start)} → ${formatShort(range.end)}`
      : 'Plus précis';
  }

  /** Notifie la page hôte après avoir rafraîchi la barre. */
  function commit() {
    renderBar();
    onChange();
  }

  /* ---------------------------------------------------------
     Calendrier du popover "Plus précis"
     --------------------------------------------------------- */

  /** Dessine le mois pointé par calCursor. */
  function renderCalendar() {
    const { y, m } = calCursor;

    calTitle.textContent = monthTitleFormatter.format(new Date(y, m, 1));

    // Semaine commençant le lundi : getDay() renvoie 0 pour dimanche.
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = todayISO();

    const fragment = document.createDocumentFragment();

    // Cases vides avant le 1er du mois, pour aligner la grille.
    for (let i = 0; i < offset; i += 1) {
      fragment.appendChild(el('span', 'cal-day is-blank'));
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = toISO(y, m, day);
      const cell = el('button', 'cal-day', String(day));
      cell.type = 'button';
      cell.dataset.date = iso;

      const isEdge = iso === range.start || iso === range.end;
      const isInside = hasRange() && iso > range.start && iso < range.end;

      cell.classList.toggle('is-edge', isEdge);
      cell.classList.toggle('is-in-range', isInside);
      cell.classList.toggle('is-today', iso === today && !isEdge);

      fragment.appendChild(cell);
    }

    calGrid.replaceChildren(fragment);

    // Message d'aide : indique l'étape en cours ou la période retenue.
    if (hasRange()) calRangeText.textContent = `${formatShort(range.start)} → ${formatShort(range.end)}`;
    else if (range.start) calRangeText.textContent = `Début : ${formatShort(range.start)} — choisissez la fin`;
    else calRangeText.textContent = 'Choisissez une date de début';
  }

  /**
   * Enregistre un clic sur un jour.
   * 1er clic (ou clic après une période complète) : pose le début et repart de zéro.
   * 2e clic : pose la fin, en réordonnant si la date choisie précède le début.
   */
  function pickDate(iso) {
    if (!range.start || hasRange()) {
      range = { start: iso, end: null };
    } else if (iso < range.start) {
      range = { start: iso, end: range.start };
    } else {
      range.end = iso;
    }

    // Une période complète exclut la sélection mois/année.
    if (hasRange()) selectedMonths.clear();

    renderCalendar();
    commit();
  }

  function openPopover() {
    // Repart du mois de la borne de début si elle existe, sinon du mois courant.
    const anchor = range.start ? new Date(`${range.start}T00:00:00`) : new Date();
    calCursor = { y: anchor.getFullYear(), m: anchor.getMonth() };

    renderCalendar();
    precisePop.hidden = false;
    preciseBtn.setAttribute('aria-expanded', 'true');
  }

  function closePopover() {
    if (precisePop.hidden) return;
    precisePop.hidden = true;
    preciseBtn.setAttribute('aria-expanded', 'false');
  }

  /* ---------------------------------------------------------
     Événements
     --------------------------------------------------------- */

  monthChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-month]');
    if (!chip) return;

    const month = Number(chip.dataset.month);

    clearRange();   // toucher aux mois quitte le mode période exacte
    if (selectedMonths.has(month)) selectedMonths.delete(month);
    else selectedMonths.add(month);

    closePopover();
    commit();
  });

  /**
   * Applique un raccourci de période. Les deux quittent le mode période exacte et
   * repositionnent l'année sur l'année courante.
   * @param {'year'|'month'} preset
   */
  function applyPreset(preset) {
    const now = new Date();

    clearRange();
    selectedMonths.clear();
    activeYear = now.getFullYear();

    // Sans mois sélectionné, seul `yearTouched` fait filtrer l'année.
    yearTouched = true;

    if (preset === 'month') selectedMonths.add(now.getMonth());

    closePopover();
    commit();
  }

  $('[data-preset="year"]', root).addEventListener('click', () => applyPreset('year'));
  $('[data-preset="month"]', root).addEventListener('click', () => applyPreset('month'));

  function stepYear(delta) {
    activeYear += delta;
    yearTouched = true;   // l'année filtre désormais, même sans mois sélectionné

    clearRange();
    closePopover();
    commit();
  }

  $('[data-year-prev]', root).addEventListener('click', () => stepYear(-1));
  $('[data-year-next]', root).addEventListener('click', () => stepYear(1));

  preciseBtn.addEventListener('click', () => {
    if (precisePop.hidden) openPopover();
    else closePopover();
  });

  $('[data-cal-prev]', root).addEventListener('click', () => {
    calCursor = { y: calCursor.m === 0 ? calCursor.y - 1 : calCursor.y, m: (calCursor.m + 11) % 12 };
    renderCalendar();
  });

  $('[data-cal-next]', root).addEventListener('click', () => {
    calCursor = { y: calCursor.m === 11 ? calCursor.y + 1 : calCursor.y, m: (calCursor.m + 1) % 12 };
    renderCalendar();
  });

  calGrid.addEventListener('click', (event) => {
    const cell = event.target.closest('[data-date]');
    if (cell) pickDate(cell.dataset.date);
  });

  // Retour au filtre mois/année.
  $('[data-cal-reset]', root).addEventListener('click', () => {
    clearRange();
    closePopover();
    commit();
  });

  // Fermeture au clic en dehors, comme la modal d'ajout.
  document.addEventListener('click', (event) => {
    if (precisePop.hidden) return;
    if (event.target.closest('.precise')) return;   // clic sur le bouton ou dans le popover
    closePopover();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePopover();
  });

  /* ---------------------------------------------------------
     Démarrage
     --------------------------------------------------------- */

  buildMonthChips();
  renderBar();

  /* ---------------------------------------------------------
     API exposée à la page hôte
     --------------------------------------------------------- */

  return {
    /** Teste une date ISO contre le filtre courant. */
    matches,

    /** Mois sélectionnés, triés. Vide si période exacte ou aucun mois. */
    months: () => [...selectedMonths].sort((a, b) => a - b),

    /** Année de référence, et si elle a été choisie explicitement. */
    year: () => ({ value: activeYear, touched: yearTouched }),

    /** Bornes de la période exacte, ou null si ce mode est inactif. */
    rangeBounds: () => (hasRange() ? { ...range } : null),

    /**
     * Dernier jour couvert par le filtre, ou null si aucune borne n'est posée.
     * Permet aux pages qui affichent un état cumulé de se caler sur la période.
     */
    endDate: () => {
      if (hasRange()) return range.end;

      const months = [...selectedMonths].sort((a, b) => a - b);
      if (months.length) return endOfMonth(activeYear, months[months.length - 1]);

      return yearTouched ? endOfMonth(activeYear, 11) : null;
    },
  };
}
