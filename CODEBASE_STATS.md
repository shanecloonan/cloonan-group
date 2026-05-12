# Codebase stats

Auto-generated snapshot of this repository (source and config-like text files under the repo root; `node_modules`, `.next`, build output, and common binary assets are excluded).

**Generated (UTC):** 2026-05-12T04:01:22.823Z

**Regenerate:** `npm run codebase-stats`

## Summary

| Metric | Value |
| --- | ---: |
| Source-like files scanned | 162 |
| Total lines (all scanned source-like files) | 51,536 |
| Non-empty lines | 46,899 |
| UTF-8 bytes (source-like) | 2,197,494 |
| Paths visited (before binary/huge skip) | 177 |
| Skipped (binary / non-UTF8 / over 4 MiB) | 1 |

## Lines of code by top-level directory

Directories are the first path segment (e.g. `app`, `lib`). Only source-like extensions are included in line counts.

| Directory | Files | Lines | Non-empty lines |
| --- | ---: | ---: | ---: |
| `app` | 64 | 26,985 | 24,964 |
| `lib` | 46 | 16,034 | 14,345 |
| `scripts` | 31 | 6,527 | 5,903 |
| `infra` | 9 | 913 | 733 |
| `bin` | 2 | 582 | 516 |
| `components` | 2 | 328 | 300 |
| `(root)` | 7 | 159 | 131 |
| `.cursor` | 1 | 8 | 7 |

## Lines of code by file extension

| Extension | Files | Lines | Non-empty lines | Bytes |
| --- | ---: | ---: | ---: | ---: |
| `.tsx` | 56 | 26,209 | 24,137 | 1,222,142 |
| `.ts` | 87 | 23,666 | 21,380 | 922,042 |
| `.mjs` | 5 | 582 | 509 | 17,816 |
| `.md` | 3 | 395 | 282 | 13,253 |
| `.sql` | 3 | 285 | 246 | 10,744 |
| `.yml` | 1 | 141 | 127 | 4,762 |
| `.sh` | 2 | 101 | 78 | 2,954 |
| `.json` | 3 | 84 | 81 | 1,940 |
| `.css` | 1 | 41 | 34 | 962 |
| `.service` | 1 | 32 | 25 | 879 |

## Largest source files (by line count)

| Lines | File |
| ---: | --- |
| 3,847 | `app/blockchain/blockchain-lab.tsx` |
| 1,874 | `app/about/whitepaper-content.tsx` |
| 1,487 | `app/simulate/simulate-app.tsx` |
| 1,486 | `app/about/about-app.tsx` |
| 1,462 | `app/gateway/gateway-content.tsx` |
| 1,338 | `app/admin/admin-dashboard.tsx` |
| 1,063 | `app/wallets/permawrite-repos.tsx` |
| 1,048 | `lib/network/block.ts` |
| 1,035 | `lib/permawrite.ts` |
| 982 | `app/dividends/dividends-app.tsx` |
| 943 | `lib/arweave.ts` |
| 856 | `app/wallets/wallets-app.tsx` |
| 778 | `app/storefront/storefront-app.tsx` |
| 774 | `app/wallets/arweave-history.tsx` |
| 772 | `app/etf/etf-app.tsx` |
| 710 | `lib/node/node.ts` |
| 709 | `app/auction/auction-app.tsx` |
| 705 | `app/dex/dex-app.tsx` |
| 683 | `lib/network/primitives.ts` |
| 679 | `lib/wallet/wallet.ts` |

## Notes

- **Lines** include blank lines and comments; **non-empty** ignores lines that are only whitespace.
- **Source-like** extensions: `.cjs`, `.css`, `.html`, `.js`, `.json`, `.jsx`, `.md`, `.mdx`, `.mjs`, `.rs`, `.scss`, `.service`, `.sh`, `.sql`, `.toml`, `.ts`, `.tsx`, `.yaml`, `.yml`.
- **Lockfiles** (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) are excluded from all tables so totals reflect authored source.
