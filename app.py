import csv
import hashlib
import io
import json
import logging
import os
import secrets
import sqlite3
import time

logging.basicConfig(level=logging.INFO)

import anthropic
from flask import Flask, Response, jsonify, redirect, render_template, request, session, url_for
from functools import wraps

from analyzer import analyze_niche
from meli_api import get_categories, get_subcategories, sample_subcategory, search_meli

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(32))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "melichnicho.db")


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS searches (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                query       TEXT,
                category_id TEXT,
                filters     TEXT,
                results_count INTEGER,
                niche_stats TEXT,
                timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS search_results (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                search_id        INTEGER,
                item_id          TEXT,
                title            TEXT,
                price            REAL,
                sold_quantity    INTEGER,
                seller_id        TEXT,
                seller_name      TEXT,
                opportunity_score REAL,
                free_shipping    INTEGER,
                permalink        TEXT,
                thumbnail        TEXT,
                FOREIGN KEY (search_id) REFERENCES searches(id)
            );
        """)


def init_users_table():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        admin_user = os.environ.get("ADMIN_USER")
        admin_pass = os.environ.get("ADMIN_PASSWORD")
        if admin_user and admin_pass:
            pw_hash = hashlib.sha256(admin_pass.encode()).hexdigest()
            conn.execute(
                "INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)",
                (admin_user, pw_hash),
            )


init_db()
init_users_table()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "No autorizado"}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


@app.route("/login", methods=["GET", "POST"])
def login():
    if "user" in session:
        return redirect(url_for("index"))
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                "SELECT id FROM users WHERE username = ? AND password_hash = ?",
                (username, pw_hash),
            ).fetchone()
        if row:
            session["user"] = username
            return redirect(url_for("index"))
        error = "Usuario o contraseña incorrectos"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.pop("user", None)
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html")



@app.route("/api/categories")
@login_required
def categories():
    return jsonify(get_categories())


@app.route("/api/search", methods=["POST"])
@login_required
def search():
    data = request.get_json() or {}
    query = (data.get("query") or "").strip()
    category_id = (data.get("category_id") or "").strip()

    if not query and not category_id:
        return jsonify({"error": "Ingresá una keyword o seleccioná una categoría."}), 400

    filters = {
        "min_price": data.get("min_price"),
        "max_price": data.get("max_price"),
        "min_sold": data.get("min_sold", 0),
        "max_sellers": data.get("max_sellers"),
        "free_shipping": data.get("free_shipping", False),
    }

    raw = search_meli(query=query, category_id=category_id)
    if "error" in raw:
        return jsonify(raw), 502

    items, niche_stats, seller_ranking = analyze_niche(raw["items"], filters)

    max_sellers = filters.get("max_sellers")
    if max_sellers and niche_stats.get("unique_sellers", 0) > int(max_sellers):
        niche_stats["competition_warning"] = (
            f"Nicho con {niche_stats['unique_sellers']} vendedores "
            f"(tu límite: {int(max_sellers)})"
        )

    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute(
            "INSERT INTO searches (query, category_id, filters, results_count, niche_stats)"
            " VALUES (?,?,?,?,?)",
            (query or category_id, category_id, json.dumps(filters),
             len(items), json.dumps(niche_stats)),
        )
        search_id = c.lastrowid
        c.executemany(
            "INSERT INTO search_results"
            " (search_id, item_id, title, price, sold_quantity, seller_id, seller_name,"
            "  opportunity_score, free_shipping, permalink, thumbnail)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [
                (search_id, i["id"], i["title"], i["price"], i.get("sold_quantity", 0),
                 str(i.get("seller_id", "")), i.get("seller_name", ""),
                 i.get("opportunity_score", 0), 1 if i.get("free_shipping") else 0,
                 i.get("permalink", ""), i.get("thumbnail", ""))
                for i in items
            ],
        )

    return jsonify({
        "search_id": search_id,
        "items": items,
        "niche_stats": niche_stats,
        "seller_ranking": seller_ranking,
    })


@app.route("/api/history")
@login_required
def history():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, query, category_id, results_count, timestamp"
            " FROM searches ORDER BY timestamp DESC LIMIT 20"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/export/<int:search_id>")
@login_required
def export_csv(search_id):
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM search_results WHERE search_id = ?"
            " ORDER BY opportunity_score DESC",
            (search_id,),
        ).fetchall()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Título", "Precio (ARS)", "Vendidos", "Vendedor",
                "Score Oportunidad", "Envío Gratis", "Link"])
    for r in rows:
        w.writerow([
            r["title"], r["price"], r["sold_quantity"], r["seller_name"],
            r["opportunity_score"], "Sí" if r["free_shipping"] else "No", r["permalink"],
        ])

    return Response(
        "﻿" + buf.getvalue(),  # BOM for Excel
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=melichnicho_{search_id}.csv"},
    )


@app.route("/api/discover", methods=["POST"])
@login_required
def discover():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY no configurada en el servidor."}), 500

    data = request.get_json() or {}
    category_id = (data.get("category_id") or "").strip()
    if not category_id:
        return jsonify({"error": "Seleccioná una categoría."}), 400

    subcats = get_subcategories(category_id)
    if not subcats:
        return jsonify({"error": "No se encontraron subcategorías para analizar."}), 404

    subcats_with_data = []
    for sc in subcats[:8]:
        metrics = sample_subcategory(sc["id"])
        if metrics:
            subcats_with_data.append({
                "id": sc["id"],
                "name": sc["name"],
                "total_items_in_category": sc.get("total_items_in_this_category", 0),
                **metrics,
            })
        time.sleep(0.3)

    if not subcats_with_data:
        return jsonify({"error": "No se pudieron obtener datos de las subcategorías."}), 502

    datos_str = json.dumps(subcats_with_data, ensure_ascii=False, indent=2)
    prompt = (
        "Sos un experto en e-commerce en MercadoLibre Argentina.\n"
        "Te paso datos de subcategorías dentro de una categoría.\n"
        "Analizá y encontrá las MEJORES OPORTUNIDADES de nicho, priorizando:\n"
        "1. Pocos vendedores únicos (baja competencia)\n"
        "2. Buena demanda (ventas promedio decentes)\n"
        "3. Precios que permitan margen\n\n"
        "Devolvé un informe en español con:\n"
        "- Top 3-5 nichos recomendados, ordenados de mejor a peor oportunidad\n"
        "- Para cada uno: nombre de la subcategoría, por qué es buena oportunidad, "
        "nivel de competencia, rango de precios sugerido, y un veredicto "
        "(🟢 Entrar / 🟡 Evaluar / 🔴 Evitar)\n"
        "- Un resumen final con tu recomendación principal\n\n"
        f"Datos de subcategorías:\n{datos_str}"
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        analysis_text = response.content[0].text
        return jsonify({
            "analysis": analysis_text,
            "subcategories_analyzed": len(subcats_with_data),
            "data": subcats_with_data,
        })
    except anthropic.APIError as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/analyze", methods=["POST"])
@login_required
def analyze_ai():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "ANTHROPIC_API_KEY no configurada en el servidor."}), 500

    data = request.get_json() or {}
    niche_data = data.get("niche_data", {})
    datos_str = json.dumps(niche_data, ensure_ascii=False, indent=2)

    prompt = (
        "Sos un experto en e-commerce en MercadoLibre Argentina.\n"
        "Analizá este nicho y devolvé un informe breve en español con:\n"
        "1. Resumen del mercado\n"
        "2. Nivel de competencia (bajo/medio/alto)\n"
        "3. Oportunidad de entrada\n"
        "4. Precio recomendado para entrar\n"
        "5. Veredicto final: una de estas tres opciones exactas → "
        "🟢 Recomendado / 🟡 Evaluar / 🔴 Evitar\n\n"
        f"Datos del nicho: {datos_str}"
    )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        analysis_text = response.content[0].text

        tail = analysis_text[-600:].lower()
        if "🟢" in analysis_text[-600:] or "recomendado" in tail:
            verdict = "green"
        elif "🔴" in analysis_text[-600:] or "evitar" in tail:
            verdict = "red"
        else:
            verdict = "yellow"

        return jsonify({"analysis": analysis_text, "verdict": verdict})
    except anthropic.APIError as e:
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=port)
