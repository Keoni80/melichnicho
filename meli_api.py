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

    max_pages = 1
    log.info("Falling back to Apify scraper: keyword='%s', maxPages=%d", query, max_pages)
    try:
        resp = requests.post(
            "https://api.apify.com/v2/acts/karamelo~mercadolibre-scraper-espanol-castellano/run-sync-get-dataset-items",
            params={"token": token},
            json={
                "keyword": query,
                "country": "https://listado.mercadolibre.com.ar/",
                "maxPages": max_pages,
            },
            timeout=160,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        log.error("Apify search failed: %s", e)
        return None

    log.info("Apify returned %d items", len(data))
    items = []
    for r in data:
        price_str = r.get("nuevoPrecio", "0") or "0"
        try:
            price = float(str(price_str).replace(".", "").replace(",", "."))
        except (ValueError, TypeError):
            price = 0
        envio = str(r.get("Envio", "")).lower()
        items.append({
            "id": r.get("SKU", ""),
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
            "permalink": r.get("zdireccion", ""),
            "thumbnail": r.get("imgDireccion", ""),
            "listing_type": "",
        })
    return items[:max_results] if items else None


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
                    return {"items": apify_items, "total": len(apify_items)}
                return {"error": "La búsqueda de MercadoLibre no está disponible y el scraper Apify falló."}
            resp.raise_for_status()
            data = resp.json()
        except requests.exceptions.Timeout:
            return {"error": "La API de MercadoLibre tardó demasiado. Intentá de nuevo."}
        except requests.exceptions.HTTPError:
            log.info("MeLi search HTTP error, trying Apify fallback")
            apify_items = _search_apify(query, category_id, max_results)
            if apify_items:
                return {"items": apify_items, "total": len(apify_items)}
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


def _parse_alibaba_price(price_str):
    import re
    if not price_str:
        return None, None
    cleaned = str(price_str).replace(",", "")
    nums = [float(n) for n in re.findall(r"\d+\.?\d*", cleaned) if float(n) > 0]
    if not nums:
        return None, None
    return min(nums), max(nums)


def _strip_html(text):
    import re
    return re.sub(r"<[^>]+>", "", text or "")


def _fix_ali_url(url):
    if not url:
        return ""
    if url.startswith("//"):
        return "https:" + url
    return url


def enrich_with_alibaba(items, alibaba_raw, query=""):
    parsed = []
    for a in alibaba_raw:
        pmin = a.get("price_min")
        pmax = a.get("price_max") or pmin
        if pmin is None:
            continue
        parsed.append({
            "price_min": float(pmin),
            "price_max": float(pmax),
            "url": a.get("product_url", ""),
        })

    if not parsed:
        for item in items:
            item["alibaba_price_min"] = None
            item["alibaba_price_max"] = None
            item["alibaba_url"] = None
        return items

    global_min = min(p["price_min"] for p in parsed)
    global_max = max(p["price_max"] for p in parsed)
    ali_search_url = f"https://www.alibaba.com/trade/search?SearchText={requests.utils.quote(query)}"

    for item in items:
        item["alibaba_price_min"] = global_min
        item["alibaba_price_max"] = global_max
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
