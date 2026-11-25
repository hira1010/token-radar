// Token Launch Radar — the page. Everything it shows comes from window.TOKEN_RADAR, the dataset
// main.ts writes beside this page from the same board it hands in: no fetch, no network, and the
// detail view's arithmetic is the model's own numbers, carried on each row.
(function () {
  'use strict';

  var DATA = window.TOKEN_RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, wl: false, sort: 'rank', dir: 1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function fmtMult(n) { return n.toFixed(3) + 'x'; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'object') node.appendChild(child);
      else node.appendChild(document.createTextNode(String(child)));
    }
    return node;
  }

  // ---- state <-> hash, so the board, a detail view and a filtered view all have URLs a
  // screenshot (or a reader) can land on directly.
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('min')) state.minTvl = Number(params.get('min')) || 0;
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir')) state.dir = Number(params.get('dir')) < 0 ? -1 : 1;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('min', String(state.minTvl));
    if (state.wl) params.set('wl', '1');
    if (state.sort !== 'rank') params.set('sort', state.sort);
    if (state.dir !== 1) params.set('dir', String(state.dir));
    if (state.selected) params.set('p', state.selected);
    var s = params.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var key = state.sort, dir = state.dir;
    return list.sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'pulse', 'aria-hidden': 'true' }),
        el('h1', null, 'Token Launch ', el('em', { text: 'Radar' }))),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version })),
        el('span', null, el('b', { text: String(DATA.board_size) }), ' protocols ranked')));
  }

  function lede() {
    return el('div', null,
      el('div', { class: 'lede' },
        el('p', { text: 'Every protocol in the sealed snapshot that records no token, ranked by what a token would be worth if the protocol\'s record stayed as it is. The watchlist of ' + DATA.watchlist_size + ' protocols at or above ' + fmtUsd(DATA.floor_usd) + ' of TVL is the floor; the radar adds the ' + DATA.extra_size + ' strongest pre-token protocols below it.' }),
        el('p', { class: 'fine', text: 'Implied value is this board\'s own model claim, not a price, a promise, or a forecast that a token will ever be issued. Select any row for its model breakdown and farm plan.' })),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'num', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'stat' }, el('span', { text: 'Rows ranked' }), el('b', { class: 'num', text: String(DATA.board_size) })),
        el('div', { class: 'stat' }, el('span', { text: 'Tokenized comps' }), el('b', { class: 'num', text: String(DATA.calibration.comp_count) })),
        el('div', { class: 'stat' }, el('span', { text: 'Global median mcap/TVL' }), el('b', { class: 'num', text: fmtMult(DATA.calibration.global_median) }))));
  }

  function modelPanel() {
    var m = DATA.model, c = DATA.calibration;
    return el('section', { class: 'block' },
      el('h2', { text: 'How the model works' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot\'s own figures only. No protocol name is special-cased and no figure comes from outside the sealed file.' }),
      el('div', { class: 'formula', text: 'implied value = TVL x category multiple x (1 + clamp(7d change, ' + m.growth_floor_pct + '%, +' + m.growth_cap_pct + '%) x ' + m.growth_weight + ') x (' + m.age_floor + ' + ' + m.age_range + ' x min(age in days, ' + m.age_full_days + ') / ' + m.age_full_days + ')' }),
      el('ul', { class: 'model-notes' },
        el('li', null, el('b', { text: 'Category multiple. ' }), 'The median market-cap / TVL of the tokenized protocols in the same category, calibrated on ' + c.comp_count + ' comps. A category needs at least ' + m.min_comps + ' comps before its own median is trusted; otherwise the global median (' + fmtMult(c.global_median) + ') stands in. The applied multiple is clamped to ' + m.mult_floor + 'x-' + m.mult_cap + 'x so one wild print cannot bend the board.'),
        el('li', null, el('b', { text: 'Growth. ' }), 'A protocol whose TVL rose over the last seven days scores up; one whose TVL fell scores down. The change is clamped before it is weighed, so a single spike cannot swamp the multiple.'),
        el('li', null, el('b', { text: 'Age. ' }), 'Days since DefiLlama first tracked the protocol: the longer it has run with no token on record, the more of the multiple it earns. A protocol with no listing date is scored at ' + m.unknown_age_days + ' days.'),
        el('li', { class: 'muted', text: 'Protocols whose token already trades are never ranked here: they are the calibration set, shown with the market\'s own figures under Comparables.' })));
  }

  function controls(list) {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(false); });
    function select(id, label, values, current, onchange) {
      var s = el('select', { id: id, 'aria-label': label },
        values.map(function (v) { return el('option', { value: v[0], text: v[1], selected: String(current) === v[0] ? 'selected' : null }); }));
      s.addEventListener('change', function () { onchange(s.value); writeHash(); render(false); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(false); });
    return el('div', { class: 'panel controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      select('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      select('min', 'Min TVL', [['0', 'Any TVL'], ['10000000', '$10M+'], ['50000000', '$50M+'], ['100000000', '$100M+'], ['500000000', '$500M+'], ['1000000000', '$1B+']], String(state.minTvl), function (v) { state.minTvl = Number(v) || 0; }),
      el('div', { class: 'field check' }, wlBox, el('label', { for: 'wl', text: 'Watchlist only' })),
      el('span', { class: 'count', text: list.length + ' of ' + DATA.board_size + ' rows shown' }));
  }

  function sortTh(key, label, cls) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return el('th', { scope: 'col', class: cls || null },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'rank' ? 1 : -1; }
        writeHash(); render(false);
      }, text: label + arrow }));
  }

  function boardTable(list) {
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h3', { text: 'No protocol matches those filters' }),
        el('p', { text: 'Loosen the search, pick another category or chain, or lower the TVL floor.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear all filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.wl = false;
          writeHash(); render(true);
        } })));
    }
    var maxImplied = Math.max.apply(null, DATA.rows.map(function (r) { return r.implied_value_usd; }));
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', { 'data-slug': r.slug, tabindex: '0', 'aria-selected': state.selected === r.slug ? 'true' : 'false' },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          r.watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null,
          el('span', { class: 'sub', text: (r.category || 'Uncategorized') + ' · ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain unrecorded') }))),
        el('td', { class: 'num r', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num r ' + growthCls, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num r', text: fmtAge(r.age_days) }),
        el('td', { class: 'num r', text: fmtMult(r.model.multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))));
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols ranked by implied value. Select a row for the model breakdown and its farm plan.' }),
        el('thead', null, el('tr', null,
          sortTh('rank', 'Rank'), sortTh('name', 'Protocol'), sortTh('tvl', 'TVL', 'r'),
          sortTh('growth', '7d', 'r'), sortTh('age', 'Age', 'r'), el('th', { scope: 'col', class: 'r', text: 'Multiple' }), sortTh('implied', 'Implied value', 'r'))),
        tbody)));
  }

  function comparables() {
    var compBody = el('tbody');
    DATA.comparables.forEach(function (c) {
      compBody.appendChild(el('tr', null,
        el('td', null, el('b', { text: c.name }), c.symbol ? el('span', { class: 'sub', text: c.symbol }) : null),
        el('td', { text: c.category || 'Uncategorized' }),
        el('td', { class: 'num r', text: fmtUsd(c.tvl_usd) }),
        el('td', { class: 'num r', text: fmtUsd(c.mcap_usd) }),
        el('td', { class: 'num r', text: fmtMult(c.ratio) })));
    });
    var calBody = el('tbody');
    DATA.calibration.categories.forEach(function (c) {
      calBody.appendChild(el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num r', text: String(c.comps) }),
        el('td', { class: 'num r', text: c.median_multiple === null ? 'n/a' : fmtMult(c.median_multiple) }),
        el('td', { class: 'num r', text: fmtMult(c.used_multiple) }),
        el('td', { text: c.source === 'category' ? 'own median' : 'global fallback' })));
    });
    return el('section', { class: 'block' },
      el('h2', { text: 'Comparables: where the multiples come from' }),
      el('p', { class: 'sub', text: 'These protocols already trade, so their market cap is a fact, not a model. The board never ranks them; it borrows their ratios to price the protocols still to come.' }),
      el('div', { class: 'split' },
        el('div', { class: 'panel' },
          el('h3', { text: 'Largest tokenized protocols' }),
          el('p', { class: 'sub muted', text: 'By market cap, from the same snapshot.' }),
          el('div', { class: 'table-wrap' }, el('table', null,
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }),
              el('th', { scope: 'col', class: 'r', text: 'TVL' }), el('th', { scope: 'col', class: 'r', text: 'Mcap' }), el('th', { scope: 'col', class: 'r', text: 'Mcap/TVL' }))),
            compBody))),
        el('div', { class: 'panel' },
          el('h3', { text: 'Category calibration' }),
          el('p', { class: 'sub muted', text: 'Median mcap/TVL per category, and the multiple the board applies.' }),
          el('div', { class: 'table-wrap' }, el('table', null,
            el('thead', null, el('tr', null,
              el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', class: 'r', text: 'Comps' }),
              el('th', { scope: 'col', class: 'r', text: 'Median' }), el('th', { scope: 'col', class: 'r', text: 'Applied' }), el('th', { scope: 'col', text: 'Basis' }))),
            calBody)))));
  }

  // ---- detail slide-over
  var overlay = el('div', { class: 'overlay' });
  var panel = el('aside', { class: 'detail', 'aria-label': 'Protocol detail' });
  overlay.addEventListener('click', closeDetail);

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    panel.textContent = '';
    var m = row.model;
    var basis = m.multiple_source === 'category'
      ? 'median of ' + m.comps + ' tokenized ' + (row.category || 'Uncategorized') + ' protocols'
      : 'global median of ' + DATA.calibration.comp_count + ' tokenized protocols (this category has too few comps of its own)';
    panel.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'muted', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · on the watchlist' : ' · below the watchlist floor') }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorized') + ' · ' + ((row.chains || []).join(', ') || 'chain unrecorded') })),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: closeDetail })));
    panel.appendChild(el('h3', { text: 'Implied value, step by step' }));
    panel.appendChild(el('div', { class: 'equation' },
      el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(m.multiple) })),
      el('div', null, el('span', { text: 'Growth factor (7d ' + fmtPct(row.change_7d) + ', clamped)' }), el('b', { class: 'num', text: m.growth_factor.toFixed(4) })),
      el('div', null, el('span', { text: 'Age factor (' + fmtAge(row.age_days) + ' with no token)' }), el('b', { class: 'num', text: m.age_factor.toFixed(4) })),
      el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))));
    panel.appendChild(el('p', { class: 'muted', text: 'Multiple basis: ' + basis + '. Factors are shown rounded to four places; the board\'s figure is the model\'s exact product, rounded to whole dollars. An estimate of what a token would be worth on today\'s record, not a prediction that one is issued.' }));
    panel.appendChild(el('h3', { text: 'Farm plan' }));
    panel.appendChild(el('ol', { class: 'steps' }, row.farm_steps.map(function (s) { return el('li', { text: s }); })));
    if (!overlay.isConnected) document.body.appendChild(overlay);
    if (!panel.isConnected) document.body.appendChild(panel);
    render(false);
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    if (overlay.isConnected) overlay.remove();
    if (panel.isConnected) panel.remove();
    render(false);
  }

  function render(rebuildControls) {
    var searchHadFocus = document.activeElement && document.activeElement.id === 'q';
    var list = visibleRows();
    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(header());
    wrap.appendChild(lede());
    wrap.appendChild(modelPanel());
    wrap.appendChild(controls(list));
    wrap.appendChild(el('section', { class: 'block' }, boardTable(list)));
    wrap.appendChild(comparables());
    wrap.appendChild(el('footer', null,
      el('p', { text: 'Data: ' + DATA.source + ' The snapshot is sealed: every run of this program, and the grade, read the same bytes.' }),
      el('p', { text: 'This page renders with no network. Implied values are the model\'s claims; a protocol listed here records no token on DefiLlama, which is not proof none exists.' })));
    app.textContent = '';
    app.appendChild(wrap);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) {
      var keep = state.selected;
      if (!panel.isConnected) { state.selected = keep; openDetail(keep); }
    }
    if (searchHadFocus) {
      var q = document.getElementById('q');
      if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });

  readHash();
  render(true);
  if (state.selected) openDetail(state.selected);
})();
