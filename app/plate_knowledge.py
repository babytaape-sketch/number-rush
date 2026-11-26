"""Runtime knowledge layer backed by the curated research CSV files.

This module enriches standard private-vehicle plates with sourced facts. It deliberately
does not replace the production rarity classifier or infer undocumented issuance.
"""
import csv
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = ROOT / "research"
ALPHABET = set("АВЕКМНОРСТУХ")

DIGIT_LABELS = {
    "triple_same": "Три одинаковые цифры",
    "palindrome_outer": "Зеркальные цифры",
    "pair_last_two": "Повтор двух последних цифр",
    "pair_first_two": "Повтор двух первых цифр",
    "pair_outer": "Одинаковые крайние цифры",
    "round_ten": "Окончание на 0",
    "round_hundred": "Круглая сотня",
    "first_decade": "Число из первой десятки",
    "ascending_run": "Возрастающая лесенка",
    "descending_run": "Убывающая лесенка",
    "all_zero": "000",
    "market_reference_example": "Есть отдельное рыночное упоминание",
    "repeated_digit": "Повтор цифры",
}
LETTER_LABELS = {
    "triple_same": "Три одинаковые буквы",
    "pair_first_two": "Повтор первых двух букв",
    "pair_last_two": "Повтор последних двух букв",
    "mirror_outer": "Зеркальные крайние буквы",
    "palindrome_outer": "Крайние буквы совпадают",
}

def _read_csv(filename):
    path = RESEARCH / filename
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))

@lru_cache(maxsize=1)
def _datasets():
    digits = {row["digits"]: row for row in _read_csv("digit_patterns_000_999.csv")}
    letters = {row["letters"]: row for row in _read_csv("letter_patterns_1728.csv")}
    regions = {row["code"].zfill(2): row for row in _read_csv("region_codes_mvd_766.csv")}
    lexical = {row["letters"]: row for row in _read_csv("letter_lexical_review.csv")}
    history = _read_csv("historical_series_review.csv")
    market = _read_csv("market_listing_evidence.csv")
    return digits, letters, regions, lexical, history, market

def _labels(raw, mapping):
    tags = [tag for tag in (raw or "").split("|") if tag and tag != "no_structural_pattern"]
    return [mapping.get(tag, tag.replace("_", " ")) for tag in tags]

def analyze_standard_plate(number, game_rarity=None):
    """Return a transparent, research-backed profile for a standard Russian plate."""
    value = str(number or "").strip().upper().replace("Ё", "Е")
    match = re.fullmatch(r"([АВЕКМНОРСТУХ])(\d{3})([АВЕКМНОРСТУХ]{2})\s+(\d{2,3})", value)
    if not match:
        return {
            "supported": False,
            "format": "unsupported_or_unrecognized",
            "message": "Подробный справочник пока поддерживает стандартный формат частного автомобиля: А123ВС 77.",
            "game_rarity": game_rarity,
            "assessment_status": "not_assessed",
        }

    first, digits, last, region_code = match.groups()
    letters = first + last
    digit_data, letter_data, region_data, lexical_data, history_data, market_data = _datasets()
    digit_row = digit_data.get(digits, {})
    letter_row = letter_data.get(letters, {})
    region = region_data.get(region_code, {})
    lexical = lexical_data.get(letters)

    digit_tags = _labels(digit_row.get("tags"), DIGIT_LABELS)
    letter_tags = _labels(letter_row.get("tags"), LETTER_LABELS)
    history = []
    for row in history_data:
        codes = [part.strip() for part in row.get("region_codes", "").split(";")]
        if row.get("letters") == letters and region_code in codes:
            history.append({
                "association": row.get("claimed_association", ""),
                "evidence_level": row.get("evidence_level", "unrated"),
                "source": row.get("source_name", ""),
                "source_url": row.get("source_url", ""),
                "note": row.get("notes", ""),
            })

    market_mentions = []
    for row in market_data:
        category = row.get("category", "")
        relevant = (
            (digits == "777" and "777" in category)
            or (digits == "001" and "first_decade" in category)
            or (digits == "007" and "007" in category)
            or (len(set(digits)) == 1 and category == "three_identical_digits")
            or (digits[0] == digits[2] and category == "mirror_digits")
            or (digits.endswith("00") and category == "round_hundreds")
        )
        if relevant:
            market_mentions.append({
                "source": row.get("source", ""),
                "date": row.get("date", ""),
                "category": category,
                "sample_size": row.get("sample_size", ""),
                "metric_type": row.get("metric_type", ""),
                "relative_to_source_baseline": row.get("relative_to_source_baseline", ""),
                "url": row.get("url", ""),
                "caveat": row.get("notes", ""),
            })

    summary = []
    if digit_tags:
        summary.extend(digit_tags[:2])
    if letter_tags:
        summary.extend(letter_tags[:2])
    if lexical and lexical.get("confidence") in {"high", "medium"}:
        summary.append("Буквенное сочетание читается как «" + lexical.get("reading", letters.lower()) + "»")
    if history:
        summary.append("Есть историческая ассоциация серии для этого региона")

    return {
        "supported": True,
        "format": "standard_private_vehicle",
        "number": value,
        "letters": letters,
        "digits": digits,
        "region_code": region_code,
        "region": region.get("region", "") if region else "",
        "region_code_status": region.get("status", "not_in_current_mvd_appendix") if region else "not_in_current_mvd_appendix",
        "digit_patterns": digit_tags,
        "letter_patterns": letter_tags,
        "digit_pattern_codes": [x for x in digit_row.get("tags", "").split("|") if x and x != "no_structural_pattern"],
        "letter_pattern_codes": [x for x in letter_row.get("tags", "").split("|") if x and x != "no_structural_pattern"],
        "lexical": ({
            "reading": lexical.get("reading", ""),
            "class": lexical.get("lexical_class", ""),
            "meaning": lexical.get("meaning_or_note", ""),
            "confidence": lexical.get("confidence", ""),
            "source_url": lexical.get("source_url", ""),
            "scoring_guidance": lexical.get("scoring_guidance", ""),
        } if lexical else None),
        "historical_associations": history,
        "market_evidence": market_mentions,
        "theoretical_space": {
            "exact_digit_triplet": "1/1000",
            "exact_letter_triplet": "1/1728",
            "exact_digit_and_letter_triplets": "1/1728000",
            "assumption": "Равномерное независимое пространство символов; не фактическая частота выдачи и не шанс выпадения игрового уровня.",
        },
        "summary": summary,
        "game_rarity": game_rarity,
        "assessment_status": "research_enriched_not_retiered",
        "caveats": [
            "Историческая ассоциация не доказывает текущую ведомственную принадлежность.",
            "Рыночные данные относятся к объявлениям, а не обязательно к завершённым сделкам.",
            "Теоретическая частота комбинаций не равна частоте реальной выдачи или игровой вероятности.",
            "Примеры и исследовательские метки не подтверждают фактическую выдачу именно этого полного номера.",
        ],
    }
