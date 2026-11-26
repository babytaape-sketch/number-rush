import unittest

from app.plate_knowledge import analyze_standard_plate


class StructuralRarityCandidateTests(unittest.TestCase):
    def test_control_examples(self):
        expected = {
            "А314ВЕ 23": "Common",
            "А777ВЕ 23": "Rare",
            "А911ЕКХ 77": "Uncommon",
            "А070ААА 70": "Epic",
            "А456АВА 77": "Epic",
            "А123ААА 77": "Legendary",
            "А001ААА 77": "Legendary",
            "А777ААА 77": "Legendary",
        }
        for number, tier in expected.items():
            with self.subTest(number=number):
                result = analyze_standard_plate(number)
                self.assertTrue(result["supported"])
                self.assertEqual(result["structural_rarity_candidate"], tier)
                self.assertEqual(result["structural_model"], "five_tier_exhaustive_v1")

    def test_market_and_history_do_not_change_structural_tier(self):
        ordinary = analyze_standard_plate("А777ВЕ 23")
        special_context = analyze_standard_plate("А777ЕКХ 77")
        self.assertEqual(ordinary["structural_rarity_candidate"], "Rare")
        self.assertEqual(special_context["structural_rarity_candidate"], "Rare")

    def test_unsupported_format_has_no_candidate(self):
        result = analyze_standard_plate("AB123CD 77")
        self.assertFalse(result["supported"])
        self.assertEqual(result["assessment_status"], "not_assessed")


if __name__ == "__main__":
    unittest.main()
