'use strict';

let currentSearchId = null;
let lastNicheData = null;
let lastRtItems = null;
let rtPendingFile = null;
let nubiPendingFile = null;

document.addEventListener('DOMContentLoaded', () => {
    loadCategories();
    loadHistory();
    loadSalesSummary();

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
    document.getElementById('close-rt-modal').addEventListener('click', closeRtModal);
    document.getElementById('ai-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('discover-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeDiscoverModal();
    });
    document.getElementById('rt-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeRtModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeModal(); closeDiscoverModal(); closeRtModal();
            document.getElementById('nubi-modal').style.display = 'none';
            document.getElementById('store-modal').style.display = 'none';
        }
    });

    // RT Upload
    document.getElementById('rt-btn').addEventListener('click', () => {
        document.getElementById('rt-modal').style.display = 'flex';
    });
    document.getElementById('rt-file-btn').addEventListener('click', () => {
        document.getElementById('rt-file-input').click();
    });
    document.getElementById('rt-file-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            rtPendingFile = file;
            document.getElementById('rt-file-name').textContent = file.name;
            document.getElementById('rt-upload-btn').style.display = 'inline-block';
        }
    });
    document.getElementById('rt-upload-btn').addEventListener('click', uploadRtFile);
    document.getElementById('rt-analyze-btn').addEventListener('click', analyzeRtWithAI);

    // RT Drag & Drop
    setupDropZone('rt-drop-zone', '.xlsx,.xls', file => {
        rtPendingFile = file;
        document.getElementById('rt-file-name').textContent = file.name;
        document.getElementById('rt-upload-btn').style.display = 'inline-block';
    });

    // Nubimetrics
    document.getElementById('nubi-btn').addEventListener('click', () => {
        document.getElementById('nubi-modal').style.display = 'flex';
    });
    document.getElementById('close-nubi-modal').addEventListener('click', () => {
        document.getElementById('nubi-modal').style.display = 'none';
    });
    document.getElementById('nubi-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) document.getElementById('nubi-modal').style.display = 'none';
    });
    document.getElementById('nubi-file-btn').addEventListener('click', () => {
        document.getElementById('nubi-file-input').click();
    });
    document.getElementById('nubi-file-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            nubiPendingFile = file;
            document.getElementById('nubi-file-name').textContent = file.name;
            document.getElementById('nubi-upload-btn').style.display = 'inline-block';
        }
    });
    document.getElementById('nubi-upload-btn').addEventListener('click', uploadNubiFile);
    document.getElementById('nubi-analyze-btn').addEventListener('click', analyzeNubiWithAI);
    document.getElementById('nubi-export-btn').addEventListener('click', exportNubiExcel);

    // Nubimetrics Drag & Drop
    setupDropZone('nubi-drop-zone', '.csv', file => {
        nubiPendingFile = file;
        document.getElementById('nubi-file-name').textContent = file.name;
        document.getElementById('nubi-upload-btn').style.display = 'inline-block';
    });

    // Mi Tienda
    document.getElementById('store-btn').addEventListener('click', openStoreModal);
    document.getElementById('close-store-modal').addEventListener('click', () => {
        document.getElementById('store-modal').style.display = 'none';
    });
    document.getElementById('store-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) document.getElementById('store-modal').style.display = 'none';
    });
    document.getElementById('store-analyze-btn').addEventListener('click', analyzeStoreWithAI);

    // Sourcing
    document.getElementById('sourcing-btn').addEventListener('click', () => {
        document.getElementById('sourcing-modal').style.display = 'flex';
    });
    document.getElementById('close-sourcing-modal').addEventListener('click', () => {
        document.getElementById('sourcing-modal').style.display = 'none';
    });
    document.getElementById('sourcing-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) document.getElementById('sourcing-modal').style.display = 'none';
    });
    document.getElementById('sourcing-file-input').addEventListener('change', e => {
        handleSourcingFiles(e.target.files);
    });
    document.getElementById('sourcing-analyze-btn').addEventListener('click', analyzeSourcingWithAI);
    document.getElementById('sourcing-target').addEventListener('input', e => {
        const digits = e.target.value.replace(/\D/g, '');
        e.target.value = digits ? parseInt(digits, 10).toLocaleString('es-AR') : '';
    });

    // Sourcing drag & drop
    const dz = document.getElementById('sourcing-dropzone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('drag-over');
        handleSourcingFiles(e.dataTransfer.files);
    });
    dz.addEventListener('click', () => document.getElementById('sourcing-file-input').click());
});

// ─── Sales Dashboard ──────────────────────────────────────

async function loadSalesSummary() {
    try {
        const resp = await fetch('/api/sales-summary');
        if (!resp.ok) return;
        const data = await resp.json();

        document.getElementById('today-amount').textContent = fmtPrice(data.today.amount);
        document.getElementById('today-orders').textContent =
            `${data.today.orders} orden${data.today.orders !== 1 ? 'es' : ''} · ${data.as_of}hs`;

        document.getElementById('month-amount').textContent = fmtPrice(data.month.amount);
        document.getElementById('month-orders').textContent =
            `${data.month.orders} orden${data.month.orders !== 1 ? 'es' : ''} en el mes`;
    } catch (_) {}
}

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

function renderResults({ items, niche_stats, seller_ranking }) {
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
            <td class="num">${item.visits > 0 ? item.visits.toLocaleString('es-AR') : '–'}</td>
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

let _progressInterval = null;

const _PROGRESS_STEPS = [
    [0,     2,  'Iniciando búsqueda...'],
    [3000,  18, 'Buscando en MercadoLibre...'],
    [10000, 45, 'Descargando resultados...'],
    [20000, 68, 'Enriqueciendo con visitas...'],
    [26000, 85, 'Calculando oportunidades...'],
    [30000, 93, 'Casi listo...'],
];

function setLoading(on) {
    document.getElementById('search-btn').disabled = on;
    if (on) {
        document.getElementById('loading').style.display = 'block';
        _startProgress();
    } else {
        _stopProgress();
    }
}

function _startProgress() {
    const fill  = document.getElementById('progress-fill');
    const label = document.getElementById('progress-label');
    const timeEl = document.getElementById('progress-time');
    const EXPECTED = 35000;
    const start = Date.now();

    fill.style.transition = 'none';
    fill.style.width = '2%';
    label.textContent = _PROGRESS_STEPS[0][2];
    timeEl.textContent = '~35s';

    _progressInterval = setInterval(() => {
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, Math.round((EXPECTED - elapsed) / 1000));

        const step = _PROGRESS_STEPS.filter(([t]) => elapsed >= t).pop();
        const pct = Math.min(95, step[1] + Math.round((elapsed - step[0]) / 1000));
        fill.style.transition = 'width .5s ease';
        fill.style.width = pct + '%';

        label.textContent = step[2];
        timeEl.textContent = remaining > 0 ? `~${remaining}s` : '';
    }, 500);
}

function _stopProgress() {
    clearInterval(_progressInterval);
    _progressInterval = null;
    const fill = document.getElementById('progress-fill');
    fill.style.transition = 'width .3s ease';
    fill.style.width = '100%';
    setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
        fill.style.transition = 'none';
        fill.style.width = '0%';
    }, 350);
}

// ─── Drop Zone ────────────────────────────────────────────────

function setupDropZone(zoneId, accept, onFile) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;

    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drop-zone-active');
    });
    zone.addEventListener('dragleave', e => {
        if (!zone.contains(e.relatedTarget)) zone.classList.remove('drop-zone-active');
    });
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drop-zone-active');
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!accept.split(',').includes(ext)) {
            zone.classList.add('drop-zone-error');
            setTimeout(() => zone.classList.remove('drop-zone-error'), 1200);
            return;
        }
        onFile(file);
    });
}

// ─── Real Trends Upload ───────────────────────────────────────

function closeRtModal() {
    document.getElementById('rt-modal').style.display = 'none';
}

async function uploadRtFile() {
    const file = rtPendingFile || document.getElementById('rt-file-input').files[0];
    if (!file) return;

    const errorEl  = document.getElementById('rt-error');
    const loadEl   = document.getElementById('rt-loading');
    const resultsEl = document.getElementById('rt-results');

    errorEl.style.display = 'none';
    resultsEl.style.display = 'none';
    loadEl.style.display = 'block';

    const fd = new FormData();
    fd.append('file', file);

    try {
        const resp = await fetch('/api/rt-upload', { method: 'POST', body: fd });
        const data = await resp.json();
        loadEl.style.display = 'none';

        if (!resp.ok || data.error) {
            errorEl.textContent = data.error || 'Error procesando el archivo.';
            errorEl.style.display = 'block';
            return;
        }

        document.getElementById('rt-summary').textContent =
            `${data.total} publicaciones encontradas · ordenadas por unidades vendidas`;

        const tbody = document.getElementById('rt-tbody');
        tbody.innerHTML = data.items.map((item, i) => `
            <tr>
                <td>${i + 1}</td>
                <td style="max-width:320px;white-space:normal">${item.title}</td>
                <td>${item.seller}</td>
                <td>${item.price > 0 ? '$' + item.price.toLocaleString('es-AR', {maximumFractionDigits:0}) : '–'}</td>
                <td><strong>${item.units.toLocaleString('es-AR')}</strong></td>
                <td>${item.revenue > 0 ? '$' + item.revenue.toLocaleString('es-AR', {maximumFractionDigits:0}) : '–'}</td>
            </tr>
        `).join('');

        lastRtItems = data.items;
        document.getElementById('rt-ai-result').style.display = 'none';
        resultsEl.style.display = 'block';
    } catch (e) {
        loadEl.style.display = 'none';
        errorEl.textContent = 'Error de red al subir el archivo.';
        errorEl.style.display = 'block';
    }
}

async function analyzeRtWithAI() {
    if (!lastRtItems) return;
    const btn = document.getElementById('rt-analyze-btn');
    const aiDiv = document.getElementById('rt-ai-result');

    btn.disabled = true;
    btn.textContent = '⏳ Analizando...';
    aiDiv.style.display = 'none';

    try {
        const resp = await fetch('/api/rt-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: lastRtItems }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            aiDiv.textContent = 'Error: ' + (data.error || 'No se pudo analizar.');
            aiDiv.style.display = 'block';
            return;
        }
        aiDiv.innerHTML = mdToHtml(data.analysis);
        aiDiv.style.display = 'block';
        aiDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {
        aiDiv.textContent = 'Error de conexión.';
        aiDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Analizar oportunidades con IA';
    }
}

function mdToHtml(md) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const lines = md.split('\n');
    const out = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Tables
        if (line.trim().startsWith('|')) {
            if (!inTable) { out.push('<table class="data-table" style="margin:.5rem 0;font-size:.85rem"><tbody>'); inTable = true; }
            if (/^\|[-| :]+\|$/.test(line.trim())) continue; // separator row
            const cells = line.trim().replace(/^\||\|$/g,'').split('|').map(c => c.trim());
            const isHeader = i > 0 && lines[i-1] && !lines[i-1].trim().startsWith('|') || (i+1 < lines.length && /^\|[-| :]+\|$/.test(lines[i+1]?.trim()));
            const tag = isHeader ? 'th' : 'td';
            out.push('<tr>' + cells.map(c => `<${tag}>${renderInline(c)}</${tag}>`).join('') + '</tr>');
            continue;
        } else if (inTable) {
            out.push('</tbody></table>');
            inTable = false;
        }

        if (/^### /.test(line)) { out.push(`<h4 style="color:#FFE600;margin:.8rem 0 .3rem">${esc(line.slice(4))}</h4>`); }
        else if (/^## /.test(line)) { out.push(`<h3 style="color:#FFE600;margin:1rem 0 .4rem;font-size:1rem">${esc(line.slice(3))}</h3>`); }
        else if (/^# /.test(line))  { out.push(`<h2 style="color:#FFE600;margin:1rem 0 .4rem;font-size:1.05rem">${esc(line.slice(2))}</h2>`); }
        else if (/^---/.test(line.trim())) { out.push('<hr style="border-color:#0F3460;margin:.5rem 0">'); }
        else if (line.trim() === '') { out.push('<br>'); }
        else { out.push(`<p style="margin:.2rem 0">${renderInline(line)}</p>`); }
    }
    if (inTable) out.push('</tbody></table>');
    return out.join('');
}

function renderInline(text) {
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code style="background:#1A1A2E;padding:.1em .3em;border-radius:3px">$1</code>');
}

// ─── Nubimetrics Upload & Analysis ───────────────────────────

let lastNubiData = null;

async function uploadNubiFile() {
    const input = document.getElementById('nubi-file-input');
    const inputFile = input.files[0];
    if (!nubiPendingFile && !inputFile) return;
    const file = nubiPendingFile || inputFile;

    const loadEl    = document.getElementById('nubi-loading');
    const msgEl     = document.getElementById('nubi-loading-msg');
    const progEl    = document.getElementById('nubi-progress');
    const errorEl   = document.getElementById('nubi-error');
    const resultsEl = document.getElementById('nubi-results');

    errorEl.style.display   = 'none';
    resultsEl.style.display = 'none';
    loadEl.style.display    = 'block';
    progEl.style.width      = '0%';

    try {
        // ── Leer CSV en el browser (sin subir al servidor) ──
        msgEl.textContent    = 'Leyendo archivo...';
        progEl.style.width   = '10%';

        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file, 'UTF-8');
        });

        msgEl.textContent  = 'Parseando CSV...';
        progEl.style.width = '30%';

        // Parsear CSV simple (respeta comillas)
        const rows = parseCSV(text);
        if (rows.length < 2) throw new Error('El archivo no tiene datos.');

        msgEl.textContent  = `Agregando ${(rows.length - 1).toLocaleString('es-AR')} productos...`;
        progEl.style.width = '50%';

        // ── Agregar por subcategoría ──
        const data = aggregateNubi(rows);

        progEl.style.width = '95%';
        await new Promise(r => setTimeout(r, 200));
        progEl.style.width = '100%';
        await new Promise(r => setTimeout(r, 300));
        loadEl.style.display = 'none';
        progEl.style.width   = '0%';

        lastNubiData = data;
        localStorage.setItem('nubiResultsData', JSON.stringify(data));
        document.getElementById('nubi-modal').style.display = 'none';
        window.open('/nubi-results', '_blank');

    } catch (e) {
        loadEl.style.display    = 'none';
        errorEl.textContent     = 'Error procesando el archivo: ' + e.message;
        errorEl.style.display   = 'block';
    }
}

function parseCSV(text) {
    const lines = text.split('\n');
    const result = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const cols = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQ = !inQ; }
            else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
            else { cur += ch; }
        }
        cols.push(cur);
        result.push(cols);
    }
    return result;
}

function aggregateNubi(rows) {
    const headers = rows[0].map(h => h.trim().replace(/^"|"$/g, ''));

    const idx = name => headers.indexOf(name);
    const iCat4    = idx('Categoria_Nivel_4');
    const iCat3    = idx('Categoria_Nivel_3');
    const iCat2    = idx('Categoria_Nivel_2');
    const iCat1    = idx('Categoria_Nivel_1');
    const iTitle   = idx('Titulo_Publicacion');
    const iSeller  = idx('Nickname_Vendedor');
    const iUnits   = idx('Unidades_Vendidas');
    const iRev     = idx('Monto_Vendido_Moneda_Local');
    const iPrice   = idx('PrecioMonedaLocal');
    const iFull    = idx('OfreceFull');
    const iFship   = idx('Ofrece_Envio_Gratis');
    const iMes     = idx('Mes');

    const fnum = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const fint = v => Math.round(fnum(v));
    const clean = v => (v || '').trim().replace(/^"|"$/g, '');

    const subcats = {};
    const allProds = {};
    let totalUnits = 0, totalRevenue = 0;
    const globalSellers = new Set();
    let catName = '', period = '';

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.length < 5) continue;

        let cat = clean(r[iCat4]);
        if (!cat || cat === '-') cat = clean(r[iCat3]) || 'Otros';

        const u     = fint(r[iUnits]);
        const rev   = fnum(r[iRev]);
        const price = fnum(r[iPrice]);
        const seller = clean(r[iSeller]);
        const title  = clean(r[iTitle]).slice(0, 80);

        totalUnits   += u;
        totalRevenue += rev;
        globalSellers.add(seller);
        if (!catName) catName = clean(r[iCat2]) || clean(r[iCat1]);
        if (!period && iMes >= 0) period = clean(r[iMes]).slice(0, 7);

        if (!subcats[cat]) subcats[cat] = {units:0,revenue:0,listings:0,prices:[],full:0,fship:0,sellers:{},products:{}};
        const d = subcats[cat];
        d.units    += u;
        d.revenue  += rev;
        d.listings += 1;
        if (price > 0) d.prices.push(price);
        if (clean(r[iFull]) === 'Si')    d.full++;
        if (clean(r[iFship]) === 'true') d.fship++;
        d.sellers[seller] = (d.sellers[seller] || 0) + u;
        if (!d.products[title]) d.products[title] = {units:0, price:0, seller};
        d.products[title].units += u;
        if (price > d.products[title].price) d.products[title].price = price;

        if (!allProds[title]) allProds[title] = {units:0, price:0, seller, cat};
        allProds[title].units += u;
        if (price > allProds[title].price) allProds[title].price = price;
    }

    const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a,b)=>a-b); return Math.round(s[Math.floor(s.length/2)]); };
    const mean   = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;

    const subcatList = Object.entries(subcats).map(([name, d]) => {
        const n = d.listings, u = d.units;
        const topSellers  = Object.entries(d.sellers).sort((a,b)=>b[1]-a[1]).slice(0,3);
        const top3Units   = topSellers.reduce((s,x)=>s+x[1],0);
        const topProducts = Object.entries(d.products).sort((a,b)=>b[1].units-a[1].units).slice(0,5);
        return {
            name, listings: n, unique_sellers: Object.keys(d.sellers).length,
            total_units: u, total_revenue: Math.round(d.revenue),
            avg_price: mean(d.prices), median_price: median(d.prices),
            pct_full: n ? Math.round(d.full/n*100) : 0,
            pct_free_ship: n ? Math.round(d.fship/n*100) : 0,
            top3_concentration: u ? Math.round(top3Units/u*100) : 0,
            top_sellers:  topSellers.map(([s,v]) => ({seller:s, units:v})),
            top_products: topProducts.map(([t,p]) => ({title:t, units:p.units, price:Math.round(p.price), seller:p.seller})),
        };
    }).sort((a,b) => b.total_units - a.total_units);

    const topGlobal = Object.entries(allProds).sort((a,b)=>b[1].units-a[1].units).slice(0,15)
        .map(([t,p]) => ({title:t, ...p, price: Math.round(p.price)}));

    const segs = {'<10k':[0,0],'10k-25k':[0,0],'25k-50k':[0,0],'50k-100k':[0,0],'100k-200k':[0,0],'+200k':[0,0]};
    // (simplified — use subcategory avg prices as proxy)

    return {
        meta: { category_name: catName, period, total_listings: rows.length - 1,
                total_units: totalUnits, total_revenue_ars: Math.round(totalRevenue),
                unique_sellers: globalSellers.size },
        subcategories: subcatList,
        top_products:  topGlobal,
        price_segments: segs,
    };
}

function renderNubiResults(data) {
    const m = data.meta;
    document.getElementById('nubi-meta-bar').innerHTML = `
        <span><strong style="color:#FFE600">${m.category_name || 'Categoría'}</strong> · ${m.period}</span>
        <span>📦 <strong>${m.total_listings.toLocaleString('es-AR')}</strong> listings</span>
        <span>🛒 <strong>${m.total_units.toLocaleString('es-AR')}</strong> unidades</span>
        <span>💰 <strong>$${(m.total_revenue_ars/1e9).toFixed(1)}B</strong> ARS</span>
        <span>👥 <strong>${m.unique_sellers.toLocaleString('es-AR')}</strong> vendedores</span>
    `;
    const tbody = document.getElementById('nubi-tbody');
    tbody.innerHTML = data.subcategories.map(s => {
        const c = s.top3_concentration > 60 ? '#F44336' : s.top3_concentration > 40 ? '#FF9800' : '#4CAF50';
        return `<tr>
            <td style="font-weight:600">${s.name}</td>
            <td>${s.listings.toLocaleString('es-AR')}</td>
            <td>${s.unique_sellers.toLocaleString('es-AR')}</td>
            <td><strong>${s.total_units.toLocaleString('es-AR')}</strong></td>
            <td>$${(s.total_revenue/1e6).toFixed(0)}M</td>
            <td>$${s.median_price.toLocaleString('es-AR')}</td>
            <td style="color:${c};font-weight:600">${s.top3_concentration}%</td>
            <td>${s.pct_full}%</td>
        </tr>`;
    }).join('');
    document.getElementById('nubi-ai-result').style.display = 'none';
    document.getElementById('nubi-results').style.display = 'block';
}

async function analyzeNubiWithAI() {
    if (!lastNubiData) return;
    const btn   = document.getElementById('nubi-analyze-btn');
    const aiDiv = document.getElementById('nubi-ai-result');

    btn.disabled = true;
    btn.textContent = '⏳ Analizando...';
    aiDiv.style.display = 'none';

    try {
        const resp = await fetch('/api/nubi-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: lastNubiData }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            aiDiv.textContent = 'Error: ' + (data.error || 'No se pudo analizar.');
            aiDiv.style.display = 'block';
            return;
        }
        aiDiv.innerHTML = mdToHtml(data.analysis);
        aiDiv.style.display = 'block';
        aiDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {
        aiDiv.textContent = 'Error de conexión.';
        aiDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Analizar oportunidades con IA';
    }
}

// ─── Mi Tienda ────────────────────────────────────────────

let lastStoreItems = null;
let _storeProgressInterval = null;

async function openStoreModal() {
    document.getElementById('store-modal').style.display = 'flex';
    if (lastStoreItems) return; // ya cargado
    await loadStoreItems();
}

async function loadStoreItems() {
    const loadEl    = document.getElementById('store-loading');
    const msgEl     = document.getElementById('store-loading-msg');
    const progEl    = document.getElementById('store-progress');
    const errorEl   = document.getElementById('store-error');
    const resultsEl = document.getElementById('store-results');

    errorEl.style.display   = 'none';
    resultsEl.style.display  = 'none';
    loadEl.style.display     = 'block';
    progEl.style.width       = '0%';

    // Fake progress over ~8 seconds
    const start = Date.now();
    _storeProgressInterval = setInterval(() => {
        const elapsed = Math.min(Date.now() - start, 8000);
        const pct = Math.round((elapsed / 8000) * 90);
        progEl.style.width = pct + '%';
        if (elapsed < 2000)       msgEl.textContent = 'Conectando con MercadoLibre...';
        else if (elapsed < 5000)  msgEl.textContent = 'Descargando publicaciones...';
        else                       msgEl.textContent = 'Procesando datos...';
    }, 300);

    try {
        const resp = await fetch('/api/my-store');
        const data = await resp.json();

        clearInterval(_storeProgressInterval);
        progEl.style.width = '100%';
        await new Promise(r => setTimeout(r, 300));
        loadEl.style.display = 'none';

        if (!resp.ok || data.error) {
            errorEl.textContent = data.error || 'Error cargando la tienda.';
            errorEl.style.display = 'block';
            return;
        }

        lastStoreItems = data.items;
        renderStoreResults(data);
    } catch (e) {
        clearInterval(_storeProgressInterval);
        loadEl.style.display = 'none';
        errorEl.textContent = 'Error de conexión al cargar la tienda.';
        errorEl.style.display = 'block';
    }
}

function renderStoreResults(data) {
    const totalRev = data.total_revenue_est;
    document.getElementById('store-meta-bar').innerHTML = `
        <span>📦 <strong>${data.total.toLocaleString('es-AR')}</strong> publicaciones</span>
        <span>✅ <strong>${data.active_count.toLocaleString('es-AR')}</strong> activas</span>
        <span>💰 Revenue hist. est. <strong>$${(totalRev/1e6).toFixed(0)}M ARS</strong></span>
    `;

    const tbody = document.getElementById('store-tbody');
    tbody.innerHTML = data.items.slice(0, 200).map((item, i) => {
        const statusColor = item.status === 'active' ? '#4CAF50' : '#7A8499';
        const statusLabel = item.status === 'active' ? 'Activa' : item.status === 'closed' ? 'Cerrada' : item.status;
        return `<tr>
            <td class="rank">${i + 1}</td>
            <td><img src="${esc(item.thumbnail)}" alt="" class="thumb" loading="lazy" onerror="this.style.display='none'"></td>
            <td><a href="${esc(item.permalink)}" target="_blank" rel="noopener noreferrer" class="item-link">${esc(item.title)}</a></td>
            <td class="price">${fmtPrice(item.price)}</td>
            <td class="num">${item.sold_quantity.toLocaleString('es-AR')}</td>
            <td class="price">${item.revenue > 0 ? '$' + item.revenue.toLocaleString('es-AR') : '–'}</td>
            <td class="num">${item.available_quantity}</td>
            <td style="color:${statusColor};font-size:.78rem;font-weight:600">${statusLabel}</td>
        </tr>`;
    }).join('');

    document.getElementById('store-ai-result').style.display = 'none';
    document.getElementById('store-results').style.display = 'block';
}

async function analyzeStoreWithAI() {
    if (!lastStoreItems) return;
    const btn   = document.getElementById('store-analyze-btn');
    const aiDiv = document.getElementById('store-ai-result');

    btn.disabled = true;
    btn.textContent = '⏳ Analizando portfolio...';
    aiDiv.style.display = 'none';

    try {
        const resp = await fetch('/api/my-store-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: lastStoreItems, target_revenue: 30_000_000 }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            aiDiv.textContent = 'Error: ' + (data.error || 'No se pudo analizar.');
            aiDiv.style.display = 'block';
            return;
        }
        aiDiv.innerHTML = mdToHtml(data.analysis);
        aiDiv.style.display = 'block';
        aiDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {
        aiDiv.textContent = 'Error de conexión.';
        aiDiv.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Recomendar productos para crecer';
    }
}

async function exportNubiExcel() {
    if (!lastNubiData) return;
    const btn = document.getElementById('nubi-export-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Generando...';

    const analysisText = document.getElementById('nubi-ai-result').textContent || '';

    try {
        const resp = await fetch('/api/nubi-export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: lastNubiData, analysis: analysisText }),
        });
        if (!resp.ok) {
            const err = await resp.json();
            alert('Error: ' + (err.error || 'No se pudo generar el archivo.'));
            return;
        }
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        const cd   = resp.headers.get('Content-Disposition') || '';
        const name = cd.match(/filename=([^;]+)/)?.[1] || 'nubimetrics_export.xlsx';
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
    } catch (_) {
        alert('Error de conexión al exportar.');
    } finally {
        btn.disabled = false;
        btn.textContent = '↓ Exportar Excel';
    }
}

// ─── Sourcing Report Tab ─────────────────────────────────

function openSourcingReport(analysisText, simulation, criteria) {
    const shippingLabel = criteria.shipping === 'courier' ? '✈️ Courier' : '🚢 Marítimo';
    const targetFmt = criteria.target.toLocaleString('es-AR');
    const now = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

    const chips = `
        <span class="chip">🎯 Objetivo <strong>$${targetFmt} ARS</strong></span>
        <span class="chip">📦 <strong>${criteria.minProd}–${criteria.maxProd}</strong> productos</span>
        <span class="chip">${shippingLabel}</span>
        <span class="chip">💵 TC <strong>${criteria.tc.toLocaleString('es-AR')}</strong></span>
        <span class="chip">🕐 ${now}</span>`;

    let simHtml = '';
    if (simulation && simulation.length) {
        const fmtARS = n => '$' + Math.round(n).toLocaleString('es-AR');
        const total = simulation.reduce((s, p) => s + (p.revenue_mes || 0), 0);
        const diff = total - criteria.target;
        const diffLabel = diff >= 0
            ? `<span class="sim-ok">+${fmtARS(diff)} sobre el objetivo ✓</span>`
            : `<span class="sim-gap">${fmtARS(Math.abs(diff))} por debajo del objetivo</span>`;

        const rows = simulation.map(p => `
            <tr>
                <td class="sim-prod">${p.producto}</td>
                <td>${fmtARS(p.precio_ars)}</td>
                <td class="sim-units">${p.unidades_mes}</td>
                <td>${fmtARS(p.revenue_mes)}</td>
            </tr>`).join('');

        simHtml = `
        <div class="sim-box">
            <div class="sim-title">🎯 Simulación — cómo llegar a $${targetFmt} ARS/mes</div>
            <table class="sim-table">
                <thead><tr>
                    <th>Producto</th>
                    <th>Precio de venta</th>
                    <th>Unidades / mes</th>
                    <th>Revenue mensual</th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr class="sim-total">
                    <td colspan="2"><strong>TOTAL</strong></td>
                    <td><strong>${simulation.reduce((s,p) => s + p.unidades_mes, 0)}</strong></td>
                    <td><strong>${fmtARS(total)}</strong><br>${diffLabel}</td>
                </tr></tfoot>
            </table>
        </div>`;
    }

    localStorage.setItem('sourcing_report_data', JSON.stringify({
        html: mdToHtml(analysisText) + simHtml,
        chips,
    }));
}

// ─── Sourcing Module ──────────────────────────────────────

let sourcingAllRows = [];   // accumulates rows from all parsed CSVs
let sourcingFileCount = 0;

function handleSourcingFiles(files) {
    if (!files || !files.length) return;
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = e => {
            const rows = parseCSV(e.target.result);
            if (rows.length > 1) {
                sourcingAllRows = sourcingAllRows.concat(rows.slice(1)); // skip header each time
                sourcingFileCount++;
                addSourcingFileItem(file.name, rows.length - 1);
                document.getElementById('sourcing-criteria').style.display = 'block';
            }
        };
        reader.readAsText(file, 'utf-8');
    });
}

function addSourcingFileItem(name, rowCount) {
    const list = document.getElementById('sourcing-file-list');
    const item = document.createElement('div');
    item.className = 'sourcing-file-item';
    item.innerHTML = `
        <span class="sourcing-file-ok">✓</span>
        <span class="sourcing-file-name">${name}</span>
        <span class="sourcing-file-count">${rowCount.toLocaleString('es-AR')} registros</span>
    `;
    list.appendChild(item);
}

function aggregateSourcingProducts(rows, headerRow) {
    // Find column indices from the first CSV's header (stored separately)
    const h = headerRow;
    const ci = k => h.findIndex(c => c.toLowerCase().includes(k.toLowerCase()));

    const iTitle  = ci('Titulo_Publicacion');
    const iPrice  = ci('PrecioMonedaLocal') !== -1 ? ci('PrecioMonedaLocal') : ci('Precio_Original');
    const iUnits  = ci('unidades_vendidas');
    const iRev    = ci('monto_vendido_moneda_local');
    const iSeller = ci('nickname_vendedor');
    const iFull   = ci('ofrecefull');
    const iFship  = ci('ofrece_envio_gratis');
    const iCat4   = ci('categoria_nivel_4');
    const iCat3   = ci('categoria_nivel_3');
    const iCat2   = ci('categoria_nivel_2');

    const clean = v => (v || '').trim();
    const fnum  = v => { try { return parseFloat(v) || 0; } catch { return 0; } };
    const fint  = v => { try { return parseInt(v) || 0; } catch { return 0; } };

    const products = {};

    for (const r of rows) {
        const title  = clean(r[iTitle]).slice(0, 80);
        if (!title) continue;

        const price  = fnum(r[iPrice]);
        const units  = fint(r[iUnits]);
        const rev    = fnum(r[iRev]);
        const seller = clean(r[iSeller]);
        const full   = clean(r[iFull]) === 'Si';
        const cat    = clean(r[iCat4]) || clean(r[iCat3]) || clean(r[iCat2]) || '';

        if (!products[title]) {
            products[title] = { units: 0, revenue: 0, prices: [], sellers: new Set(), full_count: 0, cat };
        }
        const p = products[title];
        p.units   += units;
        p.revenue += rev;
        if (price > 0) p.prices.push(price);
        p.sellers.add(seller);
        if (full) p.full_count++;
    }

    const mean = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    return Object.entries(products)
        .map(([title, p]) => ({
            título:            title,
            precio_promedio:   mean(p.prices),
            total_unidades:    p.units,
            total_revenue_ARS: Math.round(p.revenue),
            vendedores_únicos: p.sellers.size,
            pct_full:          p.prices.length ? Math.round(p.full_count / p.prices.length * 100) : 0,
            categoría:         p.cat,
        }))
        .filter(p => p.total_unidades > 0)
        .sort((a, b) => b.total_unidades - a.total_unidades)
        .slice(0, 80);
}

async function analyzeSourcingWithAI() {
    if (!sourcingAllRows.length) {
        document.getElementById('sourcing-error').textContent = 'Subí al menos un CSV primero.';
        document.getElementById('sourcing-error').style.display = 'block';
        return;
    }

    const target   = parseInt(document.getElementById('sourcing-target').value.replace(/\D/g, '')) || 0;
    const minProd  = parseInt(document.getElementById('sourcing-min-prod').value) || 1;
    const maxProd  = parseInt(document.getElementById('sourcing-max-prod').value) || 3;
    const tc       = parseInt(document.getElementById('sourcing-tc').value) || 1500;
    const shipping = document.querySelector('input[name="sourcing-shipping"]:checked')?.value || 'courier';

    if (!target) {
        document.getElementById('sourcing-error').textContent = 'Ingresá un objetivo de facturación mensual.';
        document.getElementById('sourcing-error').style.display = 'block';
        return;
    }

    document.getElementById('sourcing-error').style.display = 'none';

    // Parse header from first file to get column indices
    // We need to re-read the first file header — use the known Nubimetrics columns
    const knownHeader = [
        'Categoria_Nivel_1','Categoria_Nivel_2','Categoria_Nivel_3','Categoria_Nivel_4',
        'Categoria_Nivel_5','Categoria_Nivel_6','Categoria_Nivel_7',
        'Codigo_Categoria_Nivel1','Codigo_Categoria_Nivel2','Codigo_Categoria_Nivel3',
        'Codigo_Categoria_Nivel4','Codigo_Categoria_Nivel5','Codigo_Categoria_Nivel6',
        'Codigo_Categoria_Nivel7','Categoria_Completa','Codigo_de_Publicacion','Sitio',
        'Titulo_Publicacion','Codigo_Vendedor','Nickname_Vendedor','Tipo_Vendedor',
        'Categoria_del_Vendedor','Vendedor_No_Profesional','Vendedor_Profesional',
        'Precio_Original','Moneda','Foto_Publicacion','Link_a_Publicacion',
        'Esta_en_Oferta','Nuevo','Usado','Estado','Ofrece_MercadoPago',
        'Provincia','Ciudad','Codigo_Tienda_Oficial','Nombre_Tienda_Oficial',
        'Ofrece_Envio_Gratis','Ofrece_MercadoEnvios','Marca','catalog_product_id',
        'catalog_family_name','catalog_name','Compra_Internacional','sku','gtin',
        'oem','número de pieza','modelo','AI_CODE_ID','AI_Product_Name',
        'OfreceFlex','OfreceFull','Supermercado','site','category_Id','categoryLevel',
        'categoryName','categoryPath','categoryLevel1','level1_name','categoryLevel2',
        'level2_name','categoryLevel3','level3_name','categoryLevel4','level4_name',
        'categoryLevel5','level5_name','categoryLevel6','level6_name','categoryLevel7',
        'level7_name','Mes','Tipo_de_Exposicion','Unidades_Vendidas',
        'Monto_Vendido_Moneda_Local','Monto_Vendido_USD','PrecioMonedaLocal','PrecioUsd',
        'Cancelaciones_Unidades','Cancelaciones_Moneda_Local','Cancelaciones_USD',
        'Tasa_de_conversion'
    ];

    const btn = document.getElementById('sourcing-analyze-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Procesando datos...';
    document.getElementById('sourcing-loading').style.display = 'block';
    document.getElementById('sourcing-ai-result').style.display = 'none';

    // Abrir pestaña sincrónica (antes del await) para no ser bloqueada por el popup blocker
    const reportTab = window.open('/sourcing-report', '_blank');

    const products = aggregateSourcingProducts(sourcingAllRows, knownHeader);

    btn.textContent = '⏳ Consultando IA...';

    try {
        const resp = await fetch('/api/sourcing-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ products, target_revenue: target, min_products: minProd, max_products: maxProd, shipping, tc }),
        });
        document.getElementById('sourcing-loading').style.display = 'none';

        const aiDiv = document.getElementById('sourcing-ai-result');
        if (!resp.ok) {
            let errMsg = `Error del servidor (${resp.status})`;
            try { const e = await resp.json(); errMsg = e.error || errMsg; } catch {}
            document.getElementById('sourcing-error').textContent = errMsg;
            document.getElementById('sourcing-error').style.display = 'block';
        } else {
            const result = await resp.json();
            if (result.error) {
                document.getElementById('sourcing-error').textContent = result.error;
                document.getElementById('sourcing-error').style.display = 'block';
            } else {
                openSourcingReport(result.analysis, result.simulation || [], { target, minProd, maxProd, shipping, tc });
            }
        }
    } catch (err) {
        document.getElementById('sourcing-loading').style.display = 'none';
        document.getElementById('sourcing-error').textContent = 'Error: ' + (err.message || 'Error de conexión. Intentá de nuevo.');
        document.getElementById('sourcing-error').style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = '🤖 Analizar y recomendar productos';
    }
}
