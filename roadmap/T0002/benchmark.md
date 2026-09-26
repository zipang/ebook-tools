# Translation benchmark

- Source: `steve-krug-don-t-make-me-think-1984`
- Target language: `fr`
- Prompt version: `t0002-v1`
- Generated: 2026-09-26T19:14:10.104Z

## How to review

1. Open the stored translation linked in the `Unit` column. One file exists per model and per unit.
2. Give a quality note from 0 to 10 in the `Quality /10` column of the detail table.
3. Repeat for every unit, then fill `Avg Quality /10` and `Verdict` in the summary table.
4. Keep the cheapest model that reaches your quality bar.

The tool never fills the quality columns. A structure failure is reported in the `Notes` column.

## Detail

| Model | Unit | Chars | Duration (s) | Input tok | Output tok | Cost (USD) | Quality /10 | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `gpt-6-luna` | [`unit-011`](benchmark-output/gpt-6-luna/011-chapter-9.md) | 43430 | 59.41 | 9891 | 11564 | 0.0059 |  |  |
| `deepseek-v4-flash` | [`unit-011`](benchmark-output/deepseek-v4-flash/011-chapter-9.md) | 43430 | 126.88 | 10251 | 44360 | 0.0139 |  |  |
| `glm-5.3-flash` | [`unit-011`](benchmark-output/glm-5.3-flash/011-chapter-9.md) | 43430 | 86.94 | 9929 | 12274 | 0.0076 |  |  |
| `gpt-5.6-luna` | [`unit-011`](benchmark-output/gpt-5.6-luna/011-chapter-9.md) | 43430 | 69.72 | 3 | 11381 | 0.0137 |  |  |
| `deepseek-v4.1-flash` | [`unit-011`](benchmark-output/deepseek-v4.1-flash/011-chapter-9.md) | 43430 | 200.29 | 10173 | 13047 | 0.0187 |  |  |
| `minimax-m3` | [`unit-011`](benchmark-output/minimax-m3/011-chapter-9.md) | 43430 | 62.26 | 9897 | 11161 | 0.0163 |  |  |
| `gemini-3.5-flash-lite` | [`unit-011`](benchmark-output/gemini-3.5-flash-lite/011-chapter-9.md) | 43430 | 72.40 | 10586 | 12676 | 0.0349 |  |  |
| `gemini-3-flash` | [`unit-011`](benchmark-output/gemini-3-flash/011-chapter-9.md) | 43430 | 96.15 | 10586 | 13769 | 0.0466 |  | Block 1 changed. Expected {"kind":"heading","level":2} but found {"kind":"paragraph"}. Block 2 changed. Expected {"kind":"paragraph"} but found {"kind":"heading","level":2}. Block 13 changed. Expected {"kind":"heading","level":3} but found {"kind":"paragraph"}. Block 14 changed. Expected {"kind":"paragraph"} but found {"kind":"heading","level":3}. Block 25 changed. Expected {"kind":"heading","level":3} but found {"kind":"paragraph"}. More structural differences were omitted. Link target 8 changed. Expected "/read/unit-011#ch09fn4a" but found "/read/unit-011#ch09fn4". Link target 9 changed. Expected "/read/unit-011#ch09fn4" but found "http://nngroup.com/reports/tips/recruiting". Link target 10 changed. Expected "http://nngroup.com/reports/tips/recruiting" but found "http://rocketsurgerymadeeasy.com". Link target 14 changed. Expected "http://rocketsurgerymadeeasy.com" but found "/read/unit-011#ch09fn5a". Link target 15 changed. Expected "/read/unit-011#ch09fn5a" but found "/read/unit-011#ch09fn5". Link target 16 changed. Expected "/read/unit-011#ch09fn5" but found "nothing". |
| `glm-5.3` | [`unit-011`](benchmark-output/glm-5.3/011-chapter-9.md) | 43430 | 207.77 | 9929 | 16384 | 0.0860 |  | Model output was truncated at maxOutputTokens=16384 |

## Summary

| Model | Units | Total duration (s) | Total cost (USD) | Avg Quality /10 | Verdict |
| --- | --- | --- | --- | --- | --- |
| `gpt-6-luna` | 1 | 59.41 | 0.0059 |  |  |
| `deepseek-v4-flash` | 1 | 126.88 | 0.0139 |  |  |
| `glm-5.3-flash` | 1 | 86.94 | 0.0076 |  |  |
| `gpt-5.6-luna` | 1 | 69.72 | 0.0137 |  |  |
| `deepseek-v4.1-flash` | 1 | 200.29 | 0.0187 |  |  |
| `minimax-m3` | 1 | 62.26 | 0.0163 |  |  |
| `gemini-3.5-flash-lite` | 1 | 72.40 | 0.0349 |  |  |
| `gemini-3-flash` | 1 | 96.15 | 0.0466 |  |  |
| `glm-5.3` | 1 | 207.77 | 0.0860 |  |  |
