# Example receipts

This directory is intentionally empty. Generate the first fail-closed template with:

```bash
node ../../../bin/closure-ledger.mjs receipt-template T01 \
  --program ../program.json \
  --out ./T01.json
```

Replace every `REPLACE_WITH` value with exact evidence before running `status`. A template is not a completion receipt.
