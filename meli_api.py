import logging
import os
import time
import requests

log = logging.getLogger(__name__)

BASE_URL = "https://api.mercadolibre.com"
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

_access_token = None


def _load_env():
    global _access_token
    if os.path.exists(_ENV_PATH):
        with open(_ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip())
    _access_token = os.environ.get("MELI_ACCESS_TOKEN")


_load_env()


def _refresh_token():
    global _access_token
    client_id     = os.environ.get("MELI_CLIENT_ID")
    client_secret = os.environ.get("MELI_CLIENT_SECRET")
    refresh       = os.environ.get("MELI_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh]):
        return False

    try:
        resp = requests.post(
            f"{BASE_URL}/oauth/token",
            data={
                "grant_type":    "refresh_token",
                "client_id":     client_id,
                "client_secret": client_secret,
                "refresh_token": refresh,
            },
            timeout=10,
        )
        resp.raise_for_status()
    except Exception:
        return False

    data = resp.json()
    new_access  = data.get("access_token")
    new_refresh = data.get("refresh_token")

    if not new_access:
        return False

    _access_token = new_access
    os.environ["MELI_ACCESS_TOKEN"] = new_access
    if new_refresh:
        os.environ["MELI_REFRESH_TOKEN"] = new_refresh

    _write_env(new_access, new_refresh)
    return True


def _write_env(new_access, new_refresh):
    if not os.path.exists(_ENV_PATH):
        return
    with open(_ENV_PATH) as f:
        lines = f.readlines()

    replacements = {"MELI_ACCESS_TOKEN": new_access}
    if new_refresh:
        replacements["MELI_REFRESH_TOKEN"] = new_refresh

    out = []
    for line in lines:
        key = line.partition("=")[0].strip()
        if key in replacements:
            out.append(f"{key}={replacements[key]}\n")
        else:
            out.append(line)

    with open(_ENV_PATH, "w") as f:
        f.writelines(out)


def _headers():
    h = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "application/json",
    }
    if _access_token:
        h["Authorization"] = f"Bearer {_access_token}"
    return h


def _get(url, **kwargs):
    resp = requests.get(url, headers=_headers(), **kwargs)
    if resp.status_code in (401, 403) and _refresh_token():
        log.info("Token refreshed, retrying %s", url)
        resp = requests.get(url, headers=_headers(), **kwargs)
    return resp



def get_categories():
    try:
        resp = _get(f"{BASE_URL}/sites/MLA/categories", timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


def _search_apify(query="", category_id="", max_results=100):
    token = os.environ.get("APIFY_API_TOKEN")
    if not token:
        log.error("APIFY_API_TOKEN not set")
        return None

    if not query:
        return None

    log.info("Apify scraper: keyword='%s'", query)
    try:
        resp = requests.post(
            "https://api.apify.com/v2/acts/karamelo~mercadolibre-scraper-espanol-castellano/run-sync-get-dataset-items",
            params={"token": token},
            json={
                "keyword": query,
                "country": "https://listado.mercadolibre.com.ar/",
                "maxPages": 1,
            },
            timeout=160,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.error("Apify search failed: %s", e)
        return None

    log.info("Apify returned %d items", len(data))
    import re
    items = []
    for r in data:
        price_str = r.get("nuevoPrecio", "0") or "0"
        try:
            price = float(str(price_str).replace(".", "").replace(",", "."))
        except (ValueError, TypeError):
            price = 0
        envio = str(r.get("Envio", "")).lower()
        url = r.get("zdireccion", "")

        # Apify returns two URL types:
        # 1. articulo.mercadolibre.com.ar/MLA-1234567890-... → individual listing ID (works with /visits/items)
        # 2. mercadolibre.com.ar/.../p/MLA12345678 → catalog product ID (doesn't work with /visits/items)
        # Store both so enrich_with_visits can resolve catalog IDs to real listing IDs.
        raw_id = r.get("SKU", "")
        is_catalog = bool(re.search(r'/p/MLA', url))

        items.append({
            "id": raw_id,
            "title": r.get("articuloTitulo", ""),
            "price": price,
            "currency": r.get("Moneda", "ARS"),
            "sold_quantity": 0,
            "available_quantity": 0,
            "condition": "",
            "seller_id": r.get("sellerID", ""),
            "seller_name": r.get("Vendedor", "") or r.get("productoMarca", ""),
            "seller_level": "",
            "free_shipping": "gratis" in envio or "free" in envio or "full" in envio,
            "permalink": url,
            "thumbnail": r.get("imgDireccion", ""),
            "listing_type": "catalog" if is_catalog else "",
            "visits": 0,
            "_is_catalog": is_catalog,
        })
    return items[:max_results] if items else None


def _resolve_catalog_to_listing(product_id):
    """Resolve a catalog product ID to its top listing ID and unique seller count.

    Returns (listing_id, seller_count) or (None, 0).
    """
    try:
        resp = _get(
            f"{BASE_URL}/products/{product_id}/items",
            params={"limit": 10, "status": "active"},
            timeout=8,
        )
        if resp.ok:
            data = resp.json()
            results = data.get("results", [])
            if not results:
                return None, 0
            listing_id = results[0].get("item_id")
            unique_sellers = len({r.get("seller_id") for r in results if r.get("seller_id")})
            # paging.total tells us how many total listings exist for this product
            total_listings = data.get("paging", {}).get("total", unique_sellers)
            return listing_id, max(unique_sellers, 1)
    except Exception as e:
        log.warning("catalog resolve failed for %s: %s", product_id, e)
    return None, 0


def enrich_with_visits(items):
    """Add visit counts to items using MeLi's /visits/items endpoint (1 ID per request).

    Catalog product IDs (from /p/ URLs) are resolved to individual listing IDs first
    so the visits endpoint can return real data.
    """
    for item in items:
        item_id = item.get("id")
        if not item_id:
            continue

        # Catalog items need resolution to individual listing IDs
        if item.get("_is_catalog"):
            listing_id, seller_count = _resolve_catalog_to_listing(item_id)
            if listing_id:
                item["_resolved_id"] = listing_id
                item["catalog_seller_count"] = seller_count
                log.info("Resolved catalog %s → listing %s (%d sellers)", item_id, listing_id, seller_count)
            time.sleep(0.1)

    visits_map = {}
    for item in items:
        query_id = item.get("_resolved_id") or item.get("id")
        if not query_id:
            continue
        try:
            resp = _get(
                f"{BASE_URL}/visits/items",
                params={"ids": query_id},
                timeout=8,
            )
            if resp.ok:
                v = resp.json().get(query_id, 0)
                visits_map[item["id"]] = v
        except Exception as e:
            log.warning("visits enrichment failed for %s: %s", query_id, e)
        time.sleep(0.1)

    hits = sum(1 for v in visits_map.values() if v > 0)
    log.info("Visits enrichment: %d items, %d with actual visits", len(visits_map), hits)

    for item in items:
        item["visits"] = visits_map.get(item["id"], 0)
        item.pop("_is_catalog", None)
        item.pop("_resolved_id", None)

    return items


def search_meli(query="", category_id="", max_results=100):
    params = {"limit": 50}
    if query:
        params["q"] = query
    if category_id:
        params["category"] = category_id

    all_items = []
    offset = 0

    while len(all_items) < max_results:
        params["offset"] = offset
        try:
            resp = _get(f"{BASE_URL}/sites/MLA/search", params=params, timeout=15)
            if resp.status_code == 403:
                log.info("MeLi search returned 403, trying Apify fallback")
                apify_items = _search_apify(query, category_id, max_results)
                if apify_items:
                    enriched = enrich_with_visits(apify_items)
                    return {"items": enriched, "total": len(enriched)}
                return {"error": "La búsqueda de MercadoLibre no está disponible y el scraper Apify falló."}
            resp.raise_for_status()
            data = resp.json()
        except requests.exceptions.Timeout:
            return {"error": "La API de MercadoLibre tardó demasiado. Intentá de nuevo."}
        except requests.exceptions.HTTPError:
            log.info("MeLi search HTTP error, trying Apify fallback")
            apify_items = _search_apify(query, category_id, max_results)
            if apify_items:
                enriched = enrich_with_visits(apify_items)
                return {"items": enriched, "total": len(enriched)}
            return {"error": "Error al consultar MercadoLibre y el scraper Apify falló."}
        except Exception as e:
            return {"error": f"Error al consultar MercadoLibre: {e}"}

        results = data.get("results", [])
        if not results:
            break

        all_items.extend(_parse_item(r) for r in results)
        offset += len(results)

        total = data.get("paging", {}).get("total", 0)
        if offset >= total or offset >= max_results:
            break

        time.sleep(0.25)

    return {"items": all_items[:max_results], "total": len(all_items)}


def get_subcategories(category_id):
    try:
        resp = _get(f"{BASE_URL}/categories/{category_id}", timeout=10)
        resp.raise_for_status()
        data = resp.json()
        children = data.get("children_categories", [])
        log.info("get_subcategories %s → %d children", category_id, len(children))
        return [{"id": c["id"], "name": c["name"], "total_items_in_this_category": c.get("total_items_in_this_category", 0)} for c in children]
    except Exception as e:
        log.error("get_subcategories %s failed: %s", category_id, e)
        return []


def sample_subcategory(category_id, limit=5):
    path = f"/highlights/MLA/category/{category_id}"
    try:
        resp = _get(f"{BASE_URL}{path}", timeout=10)
        resp.raise_for_status()
        content = resp.json().get("content", [])
    except Exception as e:
        log.error("sample_subcategory highlights %s failed: %s", category_id, e)
        return None

    product_ids = [item["id"] for item in content[:limit]]
    if not product_ids:
        return None

    items = []
    for pid in product_ids:
        try:
            r_prod = _get(f"{BASE_URL}/products/{pid}", timeout=8)
            if not r_prod.ok:
                continue
            prod = r_prod.json()

            r_listing = _get(f"{BASE_URL}/products/{pid}/items", params={"limit": 1}, timeout=8)
            if not r_listing.ok:
                continue
            results = r_listing.json().get("results", [])
            if not results:
                continue
            listing = results[0]

            items.append({
                "title": prod.get("name", ""),
                "price": listing.get("price", 0) or 0,
                "sold_quantity": 0,
                "seller_id": str(listing.get("seller_id", "")),
                "seller_name": "",
            })
        except Exception:
            continue

    if not items:
        return None

    sellers = {i["seller_id"] for i in items if i.get("seller_id")}
    prices = [i["price"] for i in items if i.get("price", 0) > 0]

    return {
        "sampled": len(items),
        "unique_sellers": len(sellers),
        "avg_price": round(sum(prices) / len(prices), 2) if prices else 0,
        "median_price": round(sorted(prices)[len(prices) // 2], 2) if prices else 0,
        "top_items": [{"title": i["title"], "price": i["price"]} for i in items[:5]],
    }


def get_my_user_id():
    resp = _get(f"{BASE_URL}/users/me", timeout=10)
    if not resp.ok:
        return None
    return resp.json().get("id")


def fetch_orders_total(user_id, date_from, date_to):
    """Returns (total_amount, order_count) for paid orders in the given date range."""
    total_amount = 0.0
    order_count = 0
    offset = 0
    while True:
        r = _get(f"{BASE_URL}/orders/search", params={
            "seller": user_id,
            "order.date_created.from": date_from,
            "order.date_created.to": date_to,
            "limit": 50,
            "offset": offset,
        }, timeout=15)
        if not r.ok:
            log.warning("orders/search failed: %s %s", r.status_code, r.text[:200])
            break
        data = r.json()
        results = data.get("results", [])
        if not results:
            break
        for order in results:
            status = order.get("status", "")
            if status == "paid":
                total_amount += float(order.get("total_amount", 0) or 0)
                order_count += 1
            elif status == "partially_refunded":
                # paid_amount ya descuenta lo reembolsado
                total_amount += float(order.get("paid_amount", 0) or 0)
                order_count += 1
        total = data.get("paging", {}).get("total", 0)
        offset += len(results)
        if offset >= total:
            break
        time.sleep(0.05)
    return round(total_amount), order_count


def get_my_store_items():
    """Fetch all seller's own items with sold_quantity via authenticated API."""
    resp = _get(f"{BASE_URL}/users/me", timeout=10)
    if not resp.ok:
        return None, "Token inválido. Actualizá el MELI_ACCESS_TOKEN."
    user_id = resp.json().get("id")
    if not user_id:
        return None, "No se pudo obtener el user_id."

    all_ids = []
    offset = 0
    while True:
        r = _get(
            f"{BASE_URL}/users/{user_id}/items/search",
            params={"limit": 100, "offset": offset},
            timeout=15,
        )
        if not r.ok:
            break
        data = r.json()
        results = data.get("results", [])
        if not results:
            break
        all_ids.extend(results)
        total = data.get("paging", {}).get("total", 0)
        offset += len(results)
        if offset >= total:
            break
        time.sleep(0.1)

    if not all_ids:
        return [], None

    attrs = "id,title,price,sold_quantity,available_quantity,status,category_id,thumbnail,permalink"
    items = []
    for i in range(0, len(all_ids), 20):
        batch = all_ids[i:i+20]
        r = _get(
            f"{BASE_URL}/items",
            params={"ids": ",".join(batch), "attributes": attrs},
            timeout=15,
        )
        if r.ok:
            for entry in r.json():
                if entry.get("code") == 200:
                    b = entry.get("body", {})
                    price = b.get("price", 0) or 0
                    sold  = b.get("sold_quantity", 0) or 0
                    items.append({
                        "id":                 b.get("id", ""),
                        "title":              b.get("title", ""),
                        "price":              price,
                        "sold_quantity":      sold,
                        "available_quantity": b.get("available_quantity", 0) or 0,
                        "status":             b.get("status", ""),
                        "category_id":        b.get("category_id", ""),
                        "thumbnail":          (b.get("thumbnail") or "").replace("http://", "https://"),
                        "permalink":          b.get("permalink", ""),
                        "revenue":            round(price * sold),
                    })
        time.sleep(0.15)

    items.sort(key=lambda x: -x["revenue"])
    return items, None


def search_alibaba(query, limit=20):
    token = os.environ.get("APIFY_API_TOKEN")
    if not token or not query:
        return []
    log.info("Searching Alibaba via Apify: '%s'", query)
    try:
        resp = requests.post(
            "https://api.apify.com/v2/acts/devcake~alibaba-products-scraper/run-sync-get-dataset-items",
            params={"token": token},
            json={"queries": [query], "max_pages": 1},
            timeout=160,
        )
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list):
            log.error("Alibaba Apify unexpected response: %s", data)
            return []
        log.info("Alibaba Apify returned %d items", len(data))
        return data
    except Exception as e:
        log.error("Alibaba Apify search failed: %s", e)
        return []


_ES_STOP = {
    "de", "en", "para", "con", "el", "la", "los", "las", "un", "una", "y", "a",
    "por", "del", "al", "se", "su", "lo", "le", "es", "no", "si", "the", "for",
    "and", "with", "new", "hombre", "mujer", "color", "negro", "blanco", "rojo",
    "azul", "verde", "talla", "talle", "marca", "modelo", "nuevo", "original",
}


def _match_score(meli_title, ali_name):
    import re
    def tokens(t):
        out = set()
        for w in re.split(r"[\s/,()\-]+", t):
            w = w.strip(".").lower()
            if not w or w in _ES_STOP:
                continue
            # Keep: proper nouns, model numbers (contain digit), or long words
            if w[0].isupper() or any(c.isdigit() for c in w) or len(w) >= 5:
                out.add(w)
        return out

    mt = tokens(meli_title)
    at = tokens(ali_name)
    if not mt:
        return 0.0
    return len(mt & at) / len(mt)


def enrich_with_alibaba(items, alibaba_raw, query=""):
    parsed = []
    for a in alibaba_raw:
        pmin = a.get("price_min")
        pmax = a.get("price_max") or pmin
        if pmin is None:
            continue
        parsed.append({
            "name": a.get("name", ""),
            "price_min": float(pmin),
            "price_max": float(pmax),
            "url": a.get("product_url", ""),
        })

    ali_search_url = f"https://www.alibaba.com/trade/search?SearchText={requests.utils.quote(query)}"

    if not parsed:
        for item in items:
            item["alibaba_price_min"] = None
            item["alibaba_price_max"] = None
            item["alibaba_url"] = None
        return items

    # Fallback: P25-P75 range across all results
    mids = sorted((p["price_min"] + p["price_max"]) / 2 for p in parsed)
    n = len(mids)
    fallback_min = round(mids[max(0, n // 4)], 2)
    fallback_max = round(mids[min(n - 1, (3 * n) // 4)], 2)

    for item in items:
        best_score = 0.0
        best = None
        for a in parsed:
            score = _match_score(item.get("title", ""), a["name"])
            if score > best_score:
                best_score = score
                best = a

        if best_score >= 0.3 and best:
            item["alibaba_price_min"] = round(best["price_min"], 2)
            item["alibaba_price_max"] = round(best["price_max"], 2)
            item["alibaba_url"] = best["url"] or ali_search_url
        else:
            item["alibaba_price_min"] = fallback_min
            item["alibaba_price_max"] = fallback_max
            item["alibaba_url"] = ali_search_url

    return items


def _parse_item(raw):
    seller   = raw.get("seller", {})
    shipping = raw.get("shipping", {})
    return {
        "id":                 raw.get("id", ""),
        "title":              raw.get("title", ""),
        "price":              raw.get("price", 0) or 0,
        "currency":           raw.get("currency_id", "ARS"),
        "sold_quantity":      raw.get("sold_quantity", 0) or 0,
        "available_quantity": raw.get("available_quantity", 0) or 0,
        "condition":          raw.get("condition", ""),
        "seller_id":          seller.get("id", ""),
        "seller_name":        seller.get("nickname", ""),
        "seller_level":       seller.get("power_seller_status") or "",
        "free_shipping":      bool(shipping.get("free_shipping")),
        "permalink":          raw.get("permalink", ""),
        "thumbnail":          raw.get("thumbnail", ""),
        "listing_type":       raw.get("listing_type_id", ""),
    }


# ─── Competitors module ───────────────────────────────────────────────────

def get_seller_info(seller_id):
    """Public seller profile via /users/{id}: nickname, reputation, historic transactions."""
    try:
        resp = _get(f"{BASE_URL}/users/{seller_id}", timeout=8)
        if resp.ok:
            d = resp.json()
            rep = d.get("seller_reputation") or {}
            trans = rep.get("transactions") or {}
            return {
                "seller_id": str(d.get("id", seller_id)),
                "nickname": d.get("nickname", ""),
                "permalink": d.get("permalink", ""),
                "level_id": rep.get("level_id") or "",
                "power_seller_status": rep.get("power_seller_status") or "",
                "transactions_total": trans.get("total", 0) or 0,
            }
    except Exception as e:
        log.warning("get_seller_info failed for %s: %s", seller_id, e)
    return None


def resolve_seller_alias(alias):
    """Resolve a seller alias to its numeric ID by scraping the public profile page.

    Works from residential IPs; MeLi's anti-bot usually blocks datacenter IPs
    (Railway), so callers must handle None and ask for a _CustId_ URL instead.
    """
    import re
    try:
        resp = requests.get(
            f"https://www.mercadolibre.com.ar/perfil/{alias}",
            headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            },
            timeout=12,
        )
        if resp.ok:
            m = re.search(r"_CustId_(\d+)", resp.text)
            if m:
                return m.group(1)
    except Exception as e:
        log.warning("alias resolution failed for %s: %s", alias, e)
    return None


def fetch_seller_catalog(seller_id, max_items=0, timeout_secs=600):
    """Scrape a seller's FULL active catalog via Apify (sourabhbgp actor, seller mode).

    max_items=0 scrapes the whole catalog (sellers routinely have hundreds or
    thousands of listings). Uses an async actor run + polling — the sync endpoint
    caps at ~300s which large catalogs exceed. Cost ~$5/1000 rows.

    Returns a list of normalized items or None on failure. Most rows carry a
    catalog product ID (…/p/MLA…) that must be resolved to the seller's own
    listing ID before querying visits.
    """
    token = os.environ.get("APIFY_API_TOKEN")
    if not token:
        log.error("APIFY_API_TOKEN not set")
        return None

    run_input = {
        "mode": "seller",
        "country": "AR",
        "sellerUrls": [f"https://listado.mercadolibre.com.ar/_CustId_{seller_id}"],
        "includeSellerProfile": False,
        "useResidentialProxy": True,
    }
    if max_items:
        run_input["maxItemsPerSeller"] = max_items

    log.info("Apify seller catalog: seller_id=%s max_items=%s", seller_id, max_items or "ALL")
    try:
        resp = requests.post(
            "https://api.apify.com/v2/acts/sourabhbgp~mercadolibre-scraper/runs",
            params={"token": token, "timeout": timeout_secs},
            json=run_input,
            timeout=30,
        )
        resp.raise_for_status()
        run = resp.json()["data"]
        run_id, dataset_id = run["id"], run["defaultDatasetId"]
    except Exception as e:
        log.error("Apify seller catalog run start failed: %s", e)
        return None

    deadline = time.time() + timeout_secs
    status = ""
    while time.time() < deadline:
        time.sleep(5)
        try:
            r = requests.get(
                f"https://api.apify.com/v2/actor-runs/{run_id}",
                params={"token": token},
                timeout=15,
            )
            status = r.json()["data"]["status"]
        except Exception:
            continue
        if status == "SUCCEEDED":
            break
        if status in ("FAILED", "ABORTED", "TIMED-OUT"):
            log.error("Apify seller catalog run %s ended %s", run_id, status)
            return None
    if status != "SUCCEEDED":
        log.error("Apify seller catalog run %s still %s after %ds, aborting", run_id, status, timeout_secs)
        try:
            requests.post(
                f"https://api.apify.com/v2/actor-runs/{run_id}/abort",
                params={"token": token},
                timeout=15,
            )
        except Exception:
            pass
        return None

    try:
        resp = requests.get(
            f"https://api.apify.com/v2/datasets/{dataset_id}/items",
            params={"token": token, "format": "json"},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.error("Apify seller catalog dataset fetch failed: %s", e)
        return None

    if not isinstance(data, list):
        log.error("Apify seller catalog unexpected response: %s", data)
        return None

    import re
    items = []
    for r in data:
        if r.get("kind") != "item":
            continue
        url = r.get("url") or ""
        item_id = r.get("productId") or ""
        if not item_id:
            m = re.search(r"(MLA-?\d{6,})", url) if "articulo." in url else None
            if m:
                item_id = m.group(1).replace("-", "")
        items.append({
            "catalog_id": r.get("catalogProductId") or "",
            "item_id": item_id,
            "title": r.get("title", ""),
            "price": float(r.get("price") or 0),
            "currency": r.get("currency", "ARS"),
            "free_shipping": bool(r.get("freeShipping")),
            "permalink": url,
            "thumbnail": r.get("thumbnail", ""),
            "position": r.get("position", 0),
        })
    log.info("Apify seller catalog returned %d items", len(items))
    return items


def _resolve_catalog_for_seller(catalog_id, seller_id):
    """Return the listing ID that belongs to THIS seller for a catalog product.

    Unlike _resolve_catalog_to_listing, never falls back to another seller's
    listing — wrong-seller visits would poison the metrics.
    """
    try:
        resp = _get(
            f"{BASE_URL}/products/{catalog_id}/items",
            params={"limit": 20, "status": "active"},
            timeout=8,
        )
        if resp.ok:
            for r in resp.json().get("results", []):
                if str(r.get("seller_id")) == str(seller_id):
                    return r.get("item_id")
    except Exception as e:
        log.warning("catalog-for-seller resolve failed for %s: %s", catalog_id, e)
    return None


def get_visits_history(item_id, last=150):
    """Daily visit history via /visits/time_window (max 150 days back, any item).

    Returns {"total", "v30", "v30_prev", "weekly": [{"w": iso_week_start, "v": n}]}
    or None.
    """
    from datetime import datetime, timedelta, timezone
    try:
        resp = _get(
            f"{BASE_URL}/items/{item_id}/visits/time_window",
            params={"last": last, "unit": "day"},
            timeout=10,
        )
        if not resp.ok:
            return None
        d = resp.json()
    except Exception as e:
        log.warning("visits history failed for %s: %s", item_id, e)
        return None

    now = datetime.now(timezone.utc)
    v30 = v30_prev = 0
    weekly = {}
    for r in d.get("results") or []:
        try:
            dt = datetime.fromisoformat(r["date"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        total = r.get("total", 0) or 0
        age = (now - dt).days
        if age <= 30:
            v30 += total
        elif age <= 60:
            v30_prev += total
        week_start = (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
        weekly[week_start] = weekly.get(week_start, 0) + total

    return {
        "total": d.get("total_visits", 0) or 0,
        "v30": v30,
        "v30_prev": v30_prev,
        "weekly": [{"w": k, "v": weekly[k]} for k in sorted(weekly)],
    }


def snapshot_seller(seller_id, max_items=0, progress=None):
    """Full competitor snapshot: catalog + seller reputation + per-item visit history.

    max_items=0 = full catalog. Designed to run in a background thread — large
    catalogs (thousands of listings) take several minutes. `progress(pct, msg)`
    is called along the way if provided.

    Returns {"seller": {...}|None, "items": [...]} or {"error": msg}.
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor

    def report(pct, msg):
        if progress:
            try:
                progress(pct, msg)
            except Exception:
                pass

    report(3, "Consultando perfil del vendedor…")
    # Sequential first call: triggers token refresh if needed, before the
    # parallel phase (parallel refreshes would race on the single-use token).
    info = get_seller_info(seller_id)

    report(8, "Scrapeando catálogo completo (puede tardar varios minutos)…")
    catalog = fetch_seller_catalog(seller_id, max_items)
    if catalog is None:
        return {"error": "No se pudo obtener el catálogo del vendedor (Apify falló o sin token)."}
    if not catalog:
        return {"error": "El scraper no devolvió publicaciones para este vendedor."}

    total = len(catalog)
    report(40, f"Catálogo: {total} publicaciones. Consultando historial de visitas…")
    done = {"n": 0}
    lock = threading.Lock()

    def enrich(item):
        item_id = item.get("item_id")
        if not item_id and item.get("catalog_id"):
            item_id = _resolve_catalog_for_seller(item["catalog_id"], seller_id)
            item["item_id"] = item_id or ""
        if item_id:
            hist = get_visits_history(item_id)
            if hist:
                item["visits_total"] = hist["total"]
                item["v30"] = hist["v30"]
                item["v30_prev"] = hist["v30_prev"]
                item["weekly"] = hist["weekly"]
        with lock:
            done["n"] += 1
            if done["n"] % 20 == 0:
                report(40 + int(58 * done["n"] / total), f"Visitas: {done['n']}/{total} publicaciones…")
        return item

    with ThreadPoolExecutor(max_workers=8) as ex:
        items = list(ex.map(enrich, catalog))

    enriched = sum(1 for i in items if "v30" in i)
    log.info("Snapshot seller %s: %d items, %d with visit history", seller_id, len(items), enriched)
    report(99, "Guardando snapshot…")
    return {"seller": info, "items": items}
