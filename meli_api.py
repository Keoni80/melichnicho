import os
import time
import requests

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
    if resp.status_code == 401 and _refresh_token():
        resp = requests.get(url, headers=_headers(), **kwargs)
    return resp


def get_categories():
    try:
        resp = _get(f"{BASE_URL}/sites/MLA/categories", timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return []


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
                return _highlights_fallback(category_id, max_results)
            resp.raise_for_status()
            data = resp.json()
        except requests.exceptions.Timeout:
            return {"error": "La API de MercadoLibre tardó demasiado. Intentá de nuevo."}
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


def _highlights_fallback(category_id, max_results=50):
    """Fallback via /highlights when /search is unavailable (403).
    Flow: highlights → product IDs → (product info + best listing) per product.
    Avoids /items endpoint which is also blocked for uncertified apps.
    """
    path = f"/highlights/MLA/category/{category_id}" if category_id else "/highlights/MLA"
    try:
        resp = _get(f"{BASE_URL}{path}", timeout=10)
        resp.raise_for_status()
        content = resp.json().get("content", [])
    except Exception as e:
        return {"error": f"Error al consultar MercadoLibre: {e}"}

    product_ids = [item["id"] for item in content[:min(max_results, 10)]]
    if not product_ids:
        return {"items": [], "total": 0, "source": "highlights"}

    items = []
    for pid in product_ids:
        try:
            r_prod = _get(f"{BASE_URL}/products/{pid}", timeout=8)
            if not r_prod.ok:
                continue
            prod = r_prod.json()

            r_listing = _get(f"{BASE_URL}/products/{pid}/items",
                             params={"limit": 1}, timeout=8)
            if not r_listing.ok:
                continue
            results = r_listing.json().get("results", [])
            if not results:
                continue
            listing = results[0]

            # Thumbnail from first picker variant
            thumbnail = ""
            pickers = prod.get("pickers", [])
            if pickers and pickers[0].get("products"):
                thumbnail = pickers[0]["products"][0].get("thumbnail", "")

            items.append({
                "id":                 listing.get("item_id", pid),
                "title":              prod.get("name", ""),
                "price":              listing.get("price", 0) or 0,
                "currency":           listing.get("currency_id", "ARS"),
                "sold_quantity":      0,
                "available_quantity": 0,
                "condition":          listing.get("condition", ""),
                "seller_id":          str(listing.get("seller_id", "")),
                "seller_name":        "",
                "seller_level":       "",
                "free_shipping":      listing.get("shipping", {}).get("free_shipping", False),
                "permalink":          f"https://www.mercadolibre.com.ar/p/{pid}",
                "thumbnail":          thumbnail,
                "listing_type":       listing.get("listing_type_id", ""),
            })
        except Exception:
            continue

    return {"items": items, "total": len(items), "source": "highlights"}


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
