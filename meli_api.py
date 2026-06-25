import time
import requests

BASE_URL = "https://api.mercadolibre.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


def get_categories():
    try:
        resp = requests.get(f"{BASE_URL}/sites/MLA/categories", headers=HEADERS, timeout=10)
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
            resp = requests.get(f"{BASE_URL}/sites/MLA/search", headers=HEADERS, params=params, timeout=15)
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


def _parse_item(raw):
    seller = raw.get("seller", {})
    shipping = raw.get("shipping", {})
    return {
        "id": raw.get("id", ""),
        "title": raw.get("title", ""),
        "price": raw.get("price", 0) or 0,
        "currency": raw.get("currency_id", "ARS"),
        "sold_quantity": raw.get("sold_quantity", 0) or 0,
        "available_quantity": raw.get("available_quantity", 0) or 0,
        "condition": raw.get("condition", ""),
        "seller_id": seller.get("id", ""),
        "seller_name": seller.get("nickname", ""),
        "seller_level": seller.get("power_seller_status") or "",
        "free_shipping": bool(shipping.get("free_shipping")),
        "permalink": raw.get("permalink", ""),
        "thumbnail": raw.get("thumbnail", ""),
        "listing_type": raw.get("listing_type_id", ""),
    }
