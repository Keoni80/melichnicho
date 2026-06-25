def analyze_niche(items, filters=None):
    """Score items, compute niche stats, and rank sellers."""
    if not items:
        return [], {"total_items": 0, "unique_sellers": 0}, []

    filters = filters or {}
    items = _apply_filters(items, filters)

    if not items:
        return [], {"total_items": 0, "unique_sellers": 0}, []

    unique_sellers = len({i["seller_id"] for i in items if i.get("seller_id")})

    prices = [i["price"] for i in items if i.get("price", 0) > 0]
    sorted_prices = sorted(prices)
    median_price = sorted_prices[len(sorted_prices) // 2] if sorted_prices else 0
    avg_price = sum(prices) / len(prices) if prices else 0

    sold_list = [i.get("sold_quantity", 0) for i in items]
    max_sold = max(sold_list) if sold_list else 1
    avg_sold = sum(sold_list) / len(sold_list) if sold_list else 0

    for item in items:
        item["opportunity_score"] = _score(item, unique_sellers, median_price, max_sold)
        item["niche_sellers"] = unique_sellers
        item["median_price"] = round(median_price, 2)

    items.sort(key=lambda x: x["opportunity_score"], reverse=True)

    niche_stats = {
        "unique_sellers": unique_sellers,
        "total_items": len(items),
        "median_price": round(median_price, 2),
        "avg_price": round(avg_price, 2),
        "avg_sold": round(avg_sold, 1),
        "max_sold": max_sold,
        "competition_level": _classify(unique_sellers),
    }

    return items, niche_stats, _seller_ranking(items)


def _apply_filters(items, filters):
    min_price = float(filters.get("min_price") or 0)
    max_price = float(filters.get("max_price") or float("inf"))
    min_sold = int(filters.get("min_sold") or 0)
    free_only = bool(filters.get("free_shipping"))

    return [
        i for i in items
        if i.get("price", 0) >= min_price
        and i.get("price", 0) <= max_price
        and i.get("sold_quantity", 0) >= min_sold
        and (not free_only or i.get("free_shipping"))
    ]


def _score(item, unique_sellers, median_price, max_sold):
    sold = item.get("sold_quantity", 0)
    price = item.get("price", 0)

    # Demand (0–40): more sales = higher demand signal
    demand = (sold / max_sold) * 40 if max_sold > 0 else 0

    # Competition (0–40): fewer sellers = better opportunity window
    # 1 seller → 40 pts, 50+ sellers → 0 pts
    competition = max(0.0, 40.0 * (1.0 - (unique_sellers - 1) / 49.0))

    # Price positioning (0–15): within 50% of median scores highest
    if median_price > 0 and price > 0:
        diff_ratio = abs(price - median_price) / median_price
        price_pos = max(0.0, 15.0 * (1.0 - diff_ratio * 2.0))
    else:
        price_pos = 0.0

    # Free shipping bonus (0–5)
    shipping = 5.0 if item.get("free_shipping") else 0.0

    return round(demand + competition + price_pos + shipping, 1)


def _classify(unique_sellers):
    if unique_sellers <= 5:
        return "Baja"
    if unique_sellers <= 15:
        return "Media"
    if unique_sellers <= 30:
        return "Alta"
    return "Muy Alta"


def _seller_ranking(items):
    sellers = {}
    for item in items:
        sid = item.get("seller_id")
        if not sid:
            continue
        if sid not in sellers:
            sellers[sid] = {
                "id": sid,
                "name": item.get("seller_name", "Desconocido"),
                "products": 0,
                "total_sold": 0,
                "prices": [],
            }
        sellers[sid]["products"] += 1
        sellers[sid]["total_sold"] += item.get("sold_quantity", 0)
        sellers[sid]["prices"].append(item.get("price", 0))

    ranking = []
    for s in sellers.values():
        avg = sum(s["prices"]) / len(s["prices"]) if s["prices"] else 0
        ranking.append({
            "id": s["id"],
            "name": s["name"],
            "products": s["products"],
            "total_sold": s["total_sold"],
            "avg_price": round(avg, 2),
        })

    ranking.sort(key=lambda x: x["total_sold"], reverse=True)
    return ranking[:20]
