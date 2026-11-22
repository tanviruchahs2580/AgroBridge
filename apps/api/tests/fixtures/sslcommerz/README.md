# SSLCommerz webhook fixtures — provenance

Every fixture in this directory is **SYNTHETIC**: field names and value shapes are taken from the
official SSLCommerz developer documentation (IPN parameter sample and the Order Validation API
response), not from a real gateway capture.

| File | What it is | Derived from | Retrieved |
|---|---|---|---|
| `ipn-sample-docs-shape.txt` | Form-encoded IPN body following the documented sample field set (`status`, `tran_id`, `val_id`, `amount`, `currency`, `store_amount`, `store_id`, `tran_date`, card fields, `currency_*`, `bank_tran_id`, `risk_level`/`risk_title`, `value_a`–`value_d`, `base_fair`, `verify_key`). All values are invented; the card number is the standard VISA test number, masked. | <https://developer.sslcommerz.com/docs.html> (IPN section) | 2026-11-22 |

Real captured sandbox IPNs (owner action, OA-01) land here as additional fixtures and must keep the
same provenance table: capture date, store mode, and a statement that secrets (`store_passwd`,
`verify_sign` of the capture, card numbers) were redacted. The replay procedure is
`docs/runbooks/sslcommerz-sandbox-capture.md`.
