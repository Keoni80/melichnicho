'use strict';

let currentSearchId = null;
let lastNicheData = null;

document.addEventListener('DOMContentLoaded', () => {
    loadCategories();
    loadHistory();

    document.getElementById('search-btn').addEventListener('click', performSearch);
    document.getElementById('keyword-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') performSearch();
    });
    document.getElementById('export-btn').addEventListener('click', () => {
        if (currentSearchId) window.open(`/api/export/${currentSearchId}`, '_blank');
    });
    document.getElementById('filter-toggle').addEventListener('click', toggleFilters);
    document.getElementById('ai-btn').addEventListener('click', analyzeWithAI);
    document.getElementById('discover-btn').addEventListener('click', discoverOpportunities);
    document.getElementById('close-modal').addEventListener('click', closeModal);
    document.getElementById('close-discover-modal').addEventListener('click', closeDiscoverModal);
    document.getElementById('ai-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('discover-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeDiscoverModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeModal(); closeDiscoverModal(); }
    });
});

// ─── Categories ───────────────────────────────────────────

async function loadCategories() {
    try {
        const resp = await fetch('/api/categories');
        if (!resp.ok) return;
        const cats = await resp.json();
        const sel = document.getElementById('category-select');
        cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.name;
            sel.appendChild(opt);
        });
    } catch (_) {}
}

// ─── Search ───────────────────────────────────────────────

async function performSearch() {
    const keyword    = document.getElementById('keyword-input').value.trim();
    const categoryId = document.getElementById('category-select').value;

    if (!keyword && !categoryId) {
        showError('Ingresá una keyword o seleccioná una categoría para buscar.');
        return;
    }

    showError(null);
    setLoading(true);

    try {
        const resp = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query:        keyword,
                category_id:  categoryId,
                min_price:    numVal('min-price'),
                max_price:    numVal('max-price'),
                min_sold:     numVal('min-sold'),
                max_sellers:  numVal('max-sellers'),
                free_shipping: document.getElementById('free-shipping').checked,
            }),
        });

        const data = await resp.json();
        if (!resp.ok) { showError(data.error || 'Error en la búsqueda.'); return; }

        currentSearchId = data.search_id;
        renderResults(data);
        loadHistory();
    } catch (_) {
        showError('Error de conexión. Verificá tu internet e intentá de nuevo.');
    } finally {
        setLoading(false);
    }
}

function numVal(id) {
    const v = document.getElementById(id).value;
    return v !== '' ? parseFloat(v) : null;
}

// ─── Render ───────────────────────────────────────────────

function renderResults({ items, niche_stats, seller_ranking, source }) {
    const banner = document.getElementById('highlights-banner');
    banner.style.display = source === 'highlights' ? 'block' : 'none';

    lastNicheData = {
        niche_stats,
        top_items: items.slice(0, 20).map(i => ({
            title: i.title,
            price: i.price,
            sold_quantity: i.sold_quantity,
            seller_name: i.seller_name,
            free_shipping: i.free_shipping,
            opportunity_score: i.opportunity_score,
        })),
        top_sellers: seller_ranking.slice(0, 10),
    };

    renderNicheStats(niche_stats);
    renderItemsTable(items);
    renderSellerRanking(seller_ranking);

    const section = document.getElementById('results-section');
    section.style.display = 'block';
    document.getElementById('export-btn').style.display = 'inline-flex';
    document.getElementById('ai-btn').style.display = 'inline-flex';
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNicheStats(stats) {
    const cls = { Baja: 'good', Media: 'medium', Alta: 'bad', 'Muy Alta': 'bad' };
    const cc  = cls[stats.competition_level] || '';

    let html = `
        <div class="stat-card">
            <div class="stat-value">${stats.total_items}</div>
            <div class="stat-label">Productos</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.unique_sellers}</div>
            <div class="stat-label">Vendedores únicos</div>
        </div>
        <div class="stat-card ${cc}">
            <div class="stat-value">${esc(stats.competition_level)}</div>
            <div class="stat-label">Competencia</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${fmtPrice(stats.median_price)}</div>
            <div class="stat-label">Precio mediano</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${Math.round(stats.avg_sold)}</div>
            <div class="stat-label">Ventas prom.</div>
        </div>
    `;

    if (stats.competition_warning) {
        html += `<div class="niche-warning">⚠ ${esc(stats.competition_warning)}</div>`;
    }

    document.getElementById('niche-stats').innerHTML = html;
}

function renderItemsTable(items) {
    const tbody = document.getElementById('items-tbody');
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">Sin resultados para los filtros aplicados.</td></tr>';
        return;
    }

    tbody.innerHTML = items.slice(0, 50).map((item, i) => `
        <tr>
            <td class="rank">${i + 1}</td>
            <td><img src="${esc(item.thumbnail)}" alt="" class="thumb" loading="lazy" onerror="this.remove()"></td>
            <td><a href="${esc(item.permalink)}" target="_blank" rel="noopener noreferrer" class="item-link">${esc(item.title)}</a></td>
            <td class="price">${fmtPrice(item.price)}</td>
            <td class="num">${item.sold_quantity}</td>
            <td class="seller" title="${esc(item.seller_name)}">${esc(item.seller_name)}</td>
            <td>${item.free_shipping
                ? '<span class="badge free">Gratis</span>'
                : '<span class="badge paid">Pago</span>'}</td>
            <td><span class="score-badge ${scoreClass(item.opportunity_score)}">${item.opportunity_score}</span></td>
        </tr>
    `).join('');
}

function renderSellerRanking(sellers) {
    const tbody = document.getElementById('sellers-tbody');
    if (!sellers.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">Sin datos de vendedores.</td></tr>';
        return;
    }

    tbody.innerHTML = sellers.slice(0, 10).map((s, i) => `
        <tr>
            <td class="rank">${i + 1}</td>
            <td class="seller" title="${esc(s.name)}">${esc(s.name)}</td>
            <td class="num">${s.products}</td>
            <td class="num">${s.total_sold}</td>
            <td class="price">${fmtPrice(s.avg_price)}</td>
        </tr>
    `).join('');
}

// ─── History ──────────────────────────────────────────────

async function loadHistory() {
    try {
        const resp = await fetch('/api/history');
        if (!resp.ok) return;
        const history = await resp.json();
        const container = document.getElementById('history-list');

        if (!history.length) {
            container.innerHTML = '<p class="empty-msg">Sin búsquedas recientes</p>';
            return;
        }

        container.innerHTML = '';
        history.forEach(h => {
            const el = document.createElement('div');
            el.className = 'history-item';
            el.innerHTML = `
                <div class="history-query">${esc(h.query)}</div>
                <div class="history-meta">${h.results_count} resultados · ${fmtDate(h.timestamp)}</div>
            `;
            el.addEventListener('click', () => {
                document.getElementById('keyword-input').value = h.query || '';
                if (h.category_id) document.getElementById('category-select').value = h.category_id;
                performSearch();
            });
            container.appendChild(el);
        });
    } catch (_) {}
}

// ─── Filters toggle ───────────────────────────────────────

function toggleFilters() {
    const panel = document.getElementById('filters-panel');
    const arrow = document.getElementById('filter-arrow');
    const isOpen = panel.classList.toggle('open');
    arrow.textContent = isOpen ? '▲' : '▼';
}

// ─── AI Analysis ──────────────────────────────────────

async function analyzeWithAI() {
    if (!lastNicheData) return;
    const btn = document.getElementById('ai-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Analizando...';

    try {
        const resp = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ niche_data: lastNicheData }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            alert('Error: ' + (data.error || 'No se pudo obtener el análisis.'));
            return;
        }
        openModal(data.analysis, data.verdict);
    } catch (_) {
        alert('Error de conexión al intentar analizar con IA.');
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Analizar con IA';
    }
}

function openModal(text, verdict) {
    const banner = document.getElementById('ai-verdict-banner');
    const content = document.getElementById('ai-content');
    const labels = { green: '🟢 Recomendado', yellow: '🟡 Evaluar', red: '🔴 Evitar' };

    banner.className = 'ai-verdict-banner ' + (verdict || 'yellow');
    banner.textContent = labels[verdict] || labels.yellow;
    content.textContent = text;

    document.getElementById('ai-modal').style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('ai-modal').style.display = 'none';
    document.body.style.overflow = '';
}

// ─── Discover ────────────────────────────────────────────

async function discoverOpportunities() {
    const categoryId = document.getElementById('category-select').value;
    if (!categoryId) {
        showError('Seleccioná una categoría para descubrir oportunidades.');
        return;
    }

    showError(null);
    const btn = document.getElementById('discover-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Analizando subcategorías...';

    try {
        const resp = await fetch('/api/discover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category_id: categoryId }),
        });
        const data = await resp.json();
        if (!resp.ok) {
            showError(data.error || 'Error al descubrir oportunidades.');
            return;
        }

        const content = document.getElementById('discover-content');
        let html = `<p class="discover-meta">Se analizaron <strong>${data.subcategories_analyzed}</strong> subcategorías</p>`;
        html += `<div class="ai-text">${formatAIText(data.analysis)}</div>`;
        content.innerHTML = html;

        document.getElementById('discover-modal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    } catch (_) {
        showError('Error de conexión al descubrir oportunidades.');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Descubrir oportunidades';
    }
}

function closeDiscoverModal() {
    document.getElementById('discover-modal').style.display = 'none';
    document.body.style.overflow = '';
}

function formatAIText(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/^# (.+)$/gm, '<h2>$1</h2>')
        .replace(/\n/g, '<br>');
}

// ─── Helpers ──────────────────────────────────────────────

function scoreClass(s) {
    if (s >= 70) return 'score-high';
    if (s >= 40) return 'score-med';
    return 'score-low';
}

function fmtPrice(p) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
    }).format(p || 0);
}

function fmtDate(iso) {
    return new Date(iso).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
}

function esc(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showError(msg) {
    const el = document.getElementById('error-msg');
    if (msg) { el.textContent = msg; el.style.display = 'block'; }
    else el.style.display = 'none';
}

function setLoading(on) {
    document.getElementById('loading').style.display = on ? 'flex' : 'none';
    document.getElementById('search-btn').disabled = on;
}
