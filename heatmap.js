// ── Heatmap — Funding Rate & OI Heatmap for all Hyperliquid Perpetuals ────────

const _HM_TTL = 60 * 1000;
let _hmTs = 0;
window._hmData = {};

// ── Public entry point ────────────────────────────────────────────────────────

async function loadHeatmap() {
  const el = document.getElementById('heatmap-content');
  if (!el) return;

  const now = Date.now();
  if (!window._hmData.coins || now - _hmTs > _HM_TTL) {
    el.innerHTML = loading();
    try {
      await _hmFetch();
    } catch (e) {
      el.innerHTML = `<div style="padding:24px;color:var(--red)">Error loading heatmap: ${e.message}</div>`;
      return;
    }
  }

  _hmRender();
}

// ── Data fetch ────────────────────────────────────────────────────────────────

async function _hmFetch() {
  const [meta, ctxs] = await hlPost({ type: 'metaAndAssetCtxs' });
  const universe = meta?.universe || [];

  const coins = [];
  universe.forEach((asset, i) => {
    const ctx = ctxs[i] || {};
    const name = asset.name || '';
    if (!name) return;

    const markPx = parseFloat(ctx.markPx || 0);
    const funding = parseFloat(ctx.funding || 0);
    const oi = parseFloat(ctx.openInterest || 0);
    if (oi === 0) return;

    const oiUsd = oi * markPx;
    coins.push({ name, funding, oi, oiUsd, markPx });
  });

  _hmTs = Date.now();
  window._hmData = { coins, ts: _hmTs };
}

// ── Render ────────────────────────────────────────────────────────────────────

function _hmRender() {
  const el = document.getElementById('heatmap-content');
  if (!el) return;

  const { coins, ts } = window._hmData;
  if (!coins || !coins.length) {
    el.innerHTML = '<div style="padding:24px;color:var(--text-muted)">No data available.</div>';
    return;
  }

  // Read controls
  const sortVal   = document.getElementById('hm-sort')?.value   || 'fund-abs';
  const filterVal = (document.getElementById('hm-filter')?.value || '').trim().toUpperCase();

  // Filter
  let filtered = filterVal
    ? coins.filter(c => c.name.toUpperCase().includes(filterVal))
    : coins.slice();

  // Sort
  filtered.sort((a, b) => {
    switch (sortVal) {
      case 'fund-abs':  return Math.abs(b.funding) - Math.abs(a.funding);
      case 'fund-desc': return b.funding - a.funding;
      case 'fund-asc':  return a.funding - b.funding;
      case 'oi-desc':   return b.oiUsd - a.oiUsd;
      case 'name-asc':  return a.name.localeCompare(b.name);
      default:          return Math.abs(b.funding) - Math.abs(a.funding);
    }
  });

  // Stats
  const posCount = coins.filter(c => c.funding > 0).length;
  const negCount = coins.filter(c => c.funding < 0).length;
  const totalOI  = coins.reduce((s, c) => s + c.oiUsd, 0);
  const timeAgo  = Math.floor((Date.now() - ts) / 1000);

  // Build HTML
  const controlsHtml = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <select id="hm-sort"
        style="background:var(--surface2);color:var(--text);border:1px solid var(--border);
               border-radius:var(--radius-md);padding:5px 8px;font-size:12px;cursor:pointer;outline:none"
        onchange="_hmRender()">
        <option value="fund-abs"  ${sortVal === 'fund-abs'  ? 'selected' : ''}>|Fund| desc</option>
        <option value="fund-desc" ${sortVal === 'fund-desc' ? 'selected' : ''}>Fund ↓</option>
        <option value="fund-asc"  ${sortVal === 'fund-asc'  ? 'selected' : ''}>Fund ↑</option>
        <option value="oi-desc"   ${sortVal === 'oi-desc'   ? 'selected' : ''}>OI ↓</option>
        <option value="name-asc"  ${sortVal === 'name-asc'  ? 'selected' : ''}>Name A-Z</option>
      </select>
      <input id="hm-filter"
        placeholder="filter coin…"
        value="${filterVal}"
        style="background:var(--surface2);color:var(--text);border:1px solid var(--border);
               border-radius:var(--radius-md);padding:5px 10px;font-size:12px;outline:none;
               width:140px"
        oninput="_hmRender()">
      <span style="margin-left:auto;font-size:11px;color:var(--text-muted)">
        ${filtered.length} / ${coins.length} perps &middot; updated ${timeAgo}s ago
      </span>
    </div>`;

  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);
                  padding:10px 14px;display:flex;flex-direction:column;gap:4px">
        <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">
          Funding &gt; 0
        </span>
        <span style="font-size:18px;font-weight:700;color:var(--red)">${posCount}</span>
        <span style="font-size:10px;color:var(--text-faint)">positive rate</span>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);
                  padding:10px 14px;display:flex;flex-direction:column;gap:4px">
        <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">
          Funding &lt; 0
        </span>
        <span style="font-size:18px;font-weight:700;color:var(--green)">${negCount}</span>
        <span style="font-size:10px;color:var(--text-faint)">negative rate</span>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);
                  padding:10px 14px;display:flex;flex-direction:column;gap:4px">
        <span style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">
          Total OI
        </span>
        <span style="font-size:18px;font-weight:700;color:var(--blue)">${_hmFmt(totalOI)}</span>
        <span style="font-size:10px;color:var(--text-faint)">across all perps</span>
      </div>
    </div>`;

  const cardsHtml = filtered.map(c => {
    const bg     = _hmFundBg(c.funding);
    const fmtPct = (c.funding * 100 >= 0 ? '+' : '') + (c.funding * 100).toFixed(4) + '%';
    const fColor = c.funding < 0 ? 'var(--green)' : c.funding > 0 ? 'var(--red)' : 'var(--text-muted)';
    return `
      <div style="background:${bg};border:1px solid var(--border);border-radius:var(--radius-md);
                  padding:10px 8px;display:flex;flex-direction:column;gap:3px;
                  cursor:default;transition:opacity 0.15s;min-height:72px"
           title="${c.name} — funding: ${fmtPct}, OI: ${_hmFmt(c.oiUsd)}">
        <span style="font-size:13px;font-weight:700;color:var(--text);
                     white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${c.name}
        </span>
        <span style="font-size:14px;font-family:var(--mono);color:${fColor};font-weight:500">
          ${fmtPct}
        </span>
        <span style="font-size:10px;color:var(--text-muted)">${_hmFmt(c.oiUsd)}</span>
      </div>`;
  }).join('');

  const gridHtml = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px">
      ${cardsHtml || '<div style="color:var(--text-muted);font-size:13px;padding:8px">No results.</div>'}
    </div>`;

  el.innerHTML = `
    <div style="padding:12px 16px;max-width:1100px">
      ${controlsHtml}
      ${summaryHtml}
      ${gridHtml}
    </div>`;

  // Re-attach live event listeners (they survive the innerHTML replacement above
  // because we used inline onchange/oninput — but focus retention is nice to have)
  const filterEl = document.getElementById('hm-filter');
  if (filterEl && filterVal) {
    // Restore cursor to end after re-render
    filterEl.setSelectionRange(filterEl.value.length, filterEl.value.length);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _hmFundBg(rate) {
  if (rate > 0.0002) {
    const t = Math.min((rate - 0.0002) / 0.0018, 1);
    return `rgba(239,68,68,${(t * 0.35).toFixed(2)})`; // red with opacity
  }
  if (rate < -0.00005) {
    const t = Math.min((-rate - 0.00005) / 0.001, 1);
    return `rgba(34,197,94,${(t * 0.35).toFixed(2)})`; // green with opacity
  }
  return 'var(--surface)';
}

function _hmFmt(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + (n / 1e3).toFixed(0) + 'K';
}
