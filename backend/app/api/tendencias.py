"""Tendencias — keyword research for trends + campaigns (2026-10-28).

HONESTY CONSTRAINT, READ FIRST: Google Trends, AnswerThePublic and the
Facebook Ad Library do NOT offer free public APIs, so this module never
pretends otherwise. It mixes:

1. REAL in-platform data: live Google autocomplete suggestions
   (suggestqueries.google.com, no key required) for question-style
   queries built from the user's keyword — the AnswerThePublic-style
   value ("what people actually search"), grouped by language. These
   are suggestion strings, NOT search volumes, trend scores or ad
   counts, and the UI says so.
2. Clearly labeled DEEP LINKS that open the external tools with the
   keyword already filled in: Google Trends (with query + hl=es),
   Facebook Ad Library (active ads for the keyword, US), and the
   AnswerThePublic homepage (no search-URL pattern is fabricated —
   ATP's URL scheme is not documented for deep linking, so only the
   homepage is linked, with copy explaining that the question cards
   above are the ATP-style value).

If the suggestion service fails or blocks, the endpoint returns empty
lists with a clear warning — it never fakes suggestions and never
crashes the panel. Any authenticated user may research (read-only +
external links, no admin gate). Searched keywords are saved per user
(keyword + date only) and listed back as recent searches. No seed
data, no invented keywords.
"""
from concurrent.futures import ThreadPoolExecutor, wait

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db
from app.models.tables import TrendSearch, User

router = APIRouter(prefix="/api/tendencias", tags=["tendencias"])

SUGGEST_URL = "https://suggestqueries.google.com/complete/search"
USER_AGENT = "Mozilla/5.0 (compatible; PlataformaTendencias/1.0)"
REQUEST_TIMEOUT = 3.0
OVERALL_TIMEOUT = 5.0
PER_LANGUAGE_CAP = 50

# Question prefixes combined with the keyword. "vs" is special: the
# natural query is "<keyword> vs", not "vs <keyword>".
PREFIXES = {
    "es": ["qué", "cómo", "por qué", "dónde", "cuándo", "cuánto", "mejor", "vs", "para qué"],
    "en": ["what", "how", "why", "where", "when", "best", "vs", "how to"],
}


def build_query(keyword: str, prefix: str) -> str:
    if prefix == "vs":
        return f"{keyword} vs"
    return f"{prefix} {keyword}"


def fetch_suggestions_for_query(query: str, http_get=None) -> tuple[list[str], bool]:
    """One autocomplete request.

    Returns (suggestions, ok): ok is True when the service answered
    HTTP 200 with a parseable payload — even if the suggestion list is
    empty (a real "no suggestions" answer). Any failure (non-200, bad
    JSON, network error) returns ([], False) and never raises, so a
    single failed prefix can't break the whole research call."""
    get = http_get or httpx.get
    try:
        resp = get(
            SUGGEST_URL,
            params={"client": "firefox", "q": query},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
            trust_env=False,
        )
        if resp.status_code != 200:
            return [], False
        data = resp.json()
        if not isinstance(data, list) or len(data) < 2:
            return [], False
        suggestions = data[1]
        if not isinstance(suggestions, list):
            return [], False
        return [s for s in suggestions if isinstance(s, str)], True
    except Exception:
        return [], False


def _dedupe(items: list[str], cap: int = PER_LANGUAGE_CAP) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        text = item.strip()
        key = text.lower()
        if text and key not in seen:
            seen.add(key)
            out.append(text)
        if len(out) >= cap:
            break
    return out


def fetch_question_suggestions(keyword: str, fetcher=None) -> tuple[dict[str, list[str]], bool]:
    """Fetch question-style suggestions for all prefixes, concurrently.

    Returns ({"es": [...], "en": [...]}, any_success). `any_success` is
    True when at least one prefix request got a usable answer from the
    service — so an empty result with any_success=False means "the
    service failed/blocked", not "nobody searches this". `fetcher` is an
    injectable (query -> (suggestions, ok)) used by tests; production
    uses the real autocomplete fetcher.
    """
    fetch = fetcher or fetch_suggestions_for_query
    jobs = [(lang, build_query(keyword, prefix)) for lang, prefixes in PREFIXES.items() for prefix in prefixes]
    results: dict[str, list[str]] = {"es": [], "en": []}
    any_success = False
    executor = ThreadPoolExecutor(max_workers=8)
    try:
        futures = {executor.submit(fetch, query): lang for lang, query in jobs}
        done, _ = wait(futures.keys(), timeout=OVERALL_TIMEOUT)
        for future in done:
            lang = futures[future]
            try:
                suggestions, ok = future.result()
            except Exception:
                continue
            if ok:
                any_success = True
            results[lang].extend(suggestions)
    finally:
        # Don't let slow prefixes hold the request past the budget.
        executor.shutdown(wait=False, cancel_futures=True)
    return {lang: _dedupe(items) for lang, items in results.items()}, any_success


class TrendResearchOut(BaseModel):
    keyword: str
    es: list[str]
    en: list[str]
    warning: str | None = None
    source_note: str = (
        "Preguntas reales de autocompletado de Google, no volúmenes de búsqueda. "
        "Google Trends, AnswerThePublic y Facebook Ad Library no tienen API pública "
        "gratuita: los botones abren esas herramientas con tu palabra ya puesta."
    )


class TrendSearchOut(BaseModel):
    id: int
    keyword: str
    created_at: str | None = None


def _validate_keyword(keyword: str) -> str:
    keyword = (keyword or "").strip()
    if not keyword:
        raise HTTPException(status_code=422, detail="Escribe una palabra clave.")
    if len(keyword) > 100:
        raise HTTPException(status_code=422, detail="La palabra clave es demasiado larga (máx. 100 caracteres).")
    return keyword


@router.get("/research", response_model=TrendResearchOut)
def research_trends(
    keyword: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    keyword = _validate_keyword(keyword)
    db.add(TrendSearch(user_id=user.id, keyword=keyword))
    db.commit()
    suggestions, any_success = fetch_question_suggestions(keyword)
    warning = None
    if not any_success:
        warning = (
            "No se pudo consultar el servicio de sugerencias de Google en este momento "
            "(puede estar bloqueado o sin respuesta). Intenta de nuevo más tarde; los "
            "enlaces externos abajo siguen funcionando con tu palabra clave."
        )
    return TrendResearchOut(keyword=keyword, es=suggestions["es"], en=suggestions["en"], warning=warning)


@router.get("/searches", response_model=list[TrendSearchOut])
def list_recent_searches(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(TrendSearch)
        .filter(TrendSearch.user_id == user.id)
        .order_by(TrendSearch.id.desc())
        .limit(20)
        .all()
    )
    return [
        TrendSearchOut(id=r.id, keyword=r.keyword, created_at=r.created_at.isoformat() if r.created_at else None)
        for r in rows
    ]
