### Module: AccountEditForm (components/accounts/AccountEditForm.tsx)

- Purpose: Independent edit form for a single Account (name/type/provider/balance/is_active); minimal dependencies, direct API calls.
- Added files:
  - `apps/web/components/accounts/AccountEditForm.tsx`
- Page composition:
  - Imported in `app/(acct)/accounts/page.tsx` via client-only dynamic import (ssr: false).
- Implementation notes:
  - No external/shared UI, no `lib/api.ts`. Form fields held in local state. Currency is readonly KRW.
  - GET `/api/accounts/{id}` to populate; PUT `/api/accounts/{id}` to save. Shows inline success/error messages.
  - `Account ID` is displayed as readonly inside the form; a separate small loader control lets users input the target id and fetch.
- Verification:
  - Next.js production build: PASS with the module composed alongside `AccountsList` and `TransactionPanel`.
- Future integration:
  - Introduce `useSelectedAccount` hook to drive ID from AccountsList selection; then hide the manual loader.
  - After all modules are stable, rewrap with shared layout components via a safe bridge wrapper.

### Module: TransactionPanel (components/accounts/TransactionPanel.tsx)

- Purpose: Display account transactions for selected members with a minimal, safe client module. Users can input Account ID, load transactions via direct fetch, see summary and a scrollable list.
- Added files:
  - `apps/web/components/accounts/TransactionPanel.tsx`
- Page composition:
  - Imported in `app/(acct)/accounts/page.tsx` via client-only dynamic import (ssr: false).
- Implementation notes:
  - No `clsx`, no shared layout (`SectionCard`, `StickyAside`) and no `lib/api.ts` wrapper to keep the module graph minimal and avoid the prior webpack JSON parse issue.
  - Uses direct `fetch` to `${NEXT_PUBLIC_BACKEND_URL}/api/transactions` with user_id[]=*, account_id, and page_size=500.
  - Simple inline UI for robustness; sorting by date desc, then time desc, then id desc.
- Verification:
  - Next.js production build: PASS after adding module and composing into `/accounts`.
  - Route stats show `/accounts` size modestly increased; still stable.
- Future integration:
  - Swap inline UI for shared UI bridge components after all feature modules are stable.
  - Connect to a real account selection source (module-to-module contract) instead of manual Account ID input.

# Next.js build error: "Unexpected end of JSON input" – investigation report

## Summary
- Symptom: Next.js 15.5.4 production build fails with `Unexpected end of JSON input` during webpack compile when the route `/accounts` includes client code that imports external packages (e.g., `clsx`, `date-fns`).
- Scope observations:
  - Repro on original `app/accounts/page.tsx` with a single `clsx` import → FAIL.
  - Repro on original page even if external import is moved into a child client component → FAIL.
  - Not reproduced on a separate client route `app/smoke/page.tsx` with the same imports → PASS.
  - Not reproduced when moving the route under a route group: `app/(acct)/accounts/page.tsx` with `clsx` → PASS.
  - Using the full, monolithic original accounts page content still → FAIL, even under route group; however importing the page’s individual dependencies (PageHeader, SectionCard, StickyAside, MemberSelector, usePersistentState, api.ts) together under `(acct)/accounts` → PASS. This points to something in the original file’s structure/size/pattern tickling a bundler bug.
  - A separate calendar page syntax issue existed; we replaced it temporarily with a placeholder to unblock builds.

## Isolation timeline (key points)
1. Build PASS: `/accounts` as React-only stub; calendar disabled.
2. Add `clsx` to `/accounts` page → FAIL with `Unexpected end of JSON input`.
3. Swap to `date-fns` → FAIL.
4. `smoke` route with `clsx` → PASS (route-specific).
5. Move `/accounts` under route group `(acct)` as `app/(acct)/accounts/page.tsx`:
  - Minimal with `clsx` → PASS.
  - Import layout trio (PageHeader/SectionCard/StickyAside) + MemberSelector + usePersistentState + api.ts → PASS.
  - Restore full original monolithic page content → FAIL.
6. Clearing `.next` and `npm ci` had no effect on the original path behavior.
7. Repo JSON sanity check: no malformed JSON under the repo scope (excluding node_modules).

## Working theory
- The failure is a Next/webpack manifest/loader issue triggered by the `/accounts` route’s client bundling path when the page is large and imports external deps. The message suggests an internal JSON manifest (e.g., a module map or route manifest) being empty/truncated during parse.
- Moving the page under a route group changes the internal segment identifiers and avoids the failure for the reduced (modular) page, but the original monolithic file still triggers the bug. This indicates the defect correlates with file size/structure/patterns inside that single module rather than specific library imports.

## Current state
- `/accounts` lives under `app/(acct)/accounts/page.tsx` and compiles with: layout trio + MemberSelector + usePersistentState + api import. We will continue extracting the remaining original logic into smaller subcomponents.
- `app/calendar/page.tsx` is temporarily a placeholder; will be restored after finishing the accounts refactor.

## Fix path implemented
1. Verified the minimal failing condition was specific to `/accounts` original route (not general to imports).
2. Moved the route under a route group `(acct)` to alter internal segment naming while keeping the URL `/accounts`.
3. Rebuilt the page from smaller, known-good pieces (layout trio, MemberSelector, usePersistentState, api.ts) and confirmed PASS.
4. Plan: Extract remaining logic from the monolithic original file into smaller client components and compose them under `(acct)/accounts`.
5. Re-enabled `typedRoutes` and fixed typed links (removed non-existent `/transactions`).
6. Temporarily replaced calendar page with a placeholder; to be restored with a proper fix.

## Notes
- Calendar page will be restored after we finish the accounts refactor; current placeholder builds fine.
- No `swcMinify` or other experimental flags are used that could affect this.

### Module: useSelectedAccount Hook Integration

- Purpose: Unified account selection state management across AccountsList, TransactionPanel, and AccountEditForm modules using React Context API.
- Added files:
  - `apps/web/components/accounts/useSelectedAccount.tsx` - Context provider and hook for account selection state
- Modified files:
  - `apps/web/components/accounts/AccountsList.tsx` - Added click handlers for row selection, visual highlighting
  - `apps/web/components/accounts/TransactionPanel.tsx` - Removed manual Account ID input, auto-loads based on selected account
  - `apps/web/components/accounts/AccountEditForm.tsx` - Removed manual Account ID input, auto-loads form when account selected
  - `apps/web/app/(acct)/accounts/page.tsx` - Wrapped page in SelectedAccountProvider context
- Implementation notes:
  - React Context pattern for clean module-to-module communication without prop drilling
  - AccountsList displays selected row with blue highlighting (`bg-indigo-50`)
  - TransactionPanel and AccountEditForm show "계좌를 선택하세요" when no account selected
  - Auto-loading via useEffect when selectedId changes, eliminates manual "불러오기" workflow
  - Each module maintains minimal dependencies principle (no shared UI imports)
- Verification:
  - Next.js production build: PASS with all modules integrated and context provider wrapped
  - User workflow: Click account row → TransactionPanel and AccountEditForm auto-populate
- Future integration:
  - Ready for Card Settlement/Statement Panel module to use same selectedId hook
  - Context pattern scales for additional account-related features without props complexity
  - After all features stable, consider shared UI bridge layer integration

## Next Steps
- Card Settlement/Statement Panel modularization using same selectedId integration pattern
- Gradual shared UI reintroduction via safe bridge wrapper components
- Final integration of lib/api.ts wrapper once all modules proven stable

### Module: CardPanel (components/accounts/CardPanel.tsx)

- Purpose: Credit card summary, statements, and settlement history display module integrated with account selection context.
- Added files:
  - `apps/web/components/accounts/CardPanel.tsx`
- Page composition:
  - Imported in `app/(acct)/accounts/page.tsx` via client-only dynamic import (ssr: false), positioned after AccountEditForm
- Implementation notes:
  - Uses `useSelectedAccount` hook for automatic account selection synchronization
  - Three data sections with independent loading states: Summary (total spend, due amount, available credit), Statements (billing history sorted by date desc), Settlements (payment history)
  - Direct fetch to placeholder endpoints: `/api/cards/{id}/summary`, `/api/cards/{id}/statements`, `/api/cards/{id}/settlements`
  - Auto-loads all card data when selectedId changes, resets when no account selected
  - Minimal inline UI: simple tables, status badges (PAID/PENDING/OVERDUE), no shared layout dependencies
- Verification:
  - Next.js production build: PASS with CardPanel integrated alongside existing modules
  - JSON parse error: No regression, modular architecture maintains stability
  - User workflow: Select credit card account → CardPanel auto-populates with card data
- Future integration:
  - Connect to real backend card endpoints once API contracts established
  - Add settlement action buttons (pay now, view details) when business logic ready
  - Ready for shared UI bridge wrapper integration with other modules

## Accounts Page Modularization Complete
The `/accounts` page now consists of:
1. **AccountsList** - Account selection with context integration
2. **TransactionPanel** - Transaction history auto-sync 
3. **AccountEditForm** - Account editing auto-sync
4. **CardPanel** - Credit card data auto-sync
5. **useSelectedAccount** - Unified state management via React Context

All modules follow consistent patterns: minimal dependencies, direct fetch, useSelectedAccount integration, Next.js build stability maintained.

