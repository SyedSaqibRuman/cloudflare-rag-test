# Comprehensive QA Test Report — PopularCert AI Admin Portal

**Date:** September 2, 2026  
**Tester:** Buffy (Automated QA)  
**Environment:** Chrome/Chromium via agent-browser, Node.js 22, Express 5  
**Server:** http://127.0.0.1:3000  
**Company:** Popularcert  

---

## Executive Summary

The PopularCert AI Admin Portal is a **feature-rich, multi-tenant AI gateway** with solid core functionality. The application successfully implements Knowledge Bases, Assistants, Chatbots, Workflows, Usage tracking, Webhooks, and Providers management. The UI follows a consistent dark theme with good component reuse.

**Overall Quality:** Good — production-ready for core features with minor issues  
**Production Readiness:** NEEDS MINOR FIXES  

### Most Important Findings
1. **P2 — Horizontal overflow at 320px viewport** (responsive bug)
2. **P3 — React forwardRef warning in console** (code quality)
3. **P3 — Some empty states could be more descriptive**

---

## Coverage

| Category | Count |
|----------|-------|
| Pages tested | 14 (Dashboard, Ask Console, KBs, Assistants, Chatbots, Companies, Config, Cloudflare, Scheduler, Workflows, Usage, Webhooks, Providers, Login) |
| Features tested | 45+ (CRUD, navigation, forms, modals, dropdowns, tabs, search, filters, theme, sidebar, profile menu) |
| Forms tested | 8 (Login, KB Create Wizard, Assistant Create, Chatbot Create, Workflow Create, Config Edit, Webhook Create, Provider Edit) |
| Buttons tested | 60+ (navigation, actions, CRUD, theme, sidebar, profile menu) |
| Modals tested | 5 (KB Create Wizard, Assistant Create, Chatbot Create, Webhook Create, Delete Confirmations) |
| Dropdowns tested | 12 (Company selector, Assistant selector, KB filters, Embedding Model, Vector Store, Storage, Graph DB, Theme, Source Type, etc.) |
| Tables tested | 5 (Companies, Assistants, KBs, Providers, Usage) |
| API workflows tested | 15+ (Login, Company select, KB CRUD, Assistant CRUD, Chatbot CRUD, Ingestion, Ask, Usage) |
| Responsive breakpoints tested | 3 (320px, 375px, 1280px) |

---

## Bug Summary

| Severity | Count |
|----------|-------|
| P0 — Critical | 0 |
| P1 — High | 0 |
| P2 — Medium | 1 |
| P3 — Low | 3 |
| P4 — Cosmetic | 2 |

---

## Critical Findings

None. No P0 or P1 issues found.

---

## P2 — Medium Issues

### BUG-001: Horizontal Overflow at 320px Viewport

**ID:** BUG-001  
**Severity:** P2 — Medium  
**Category:** Responsive / Layout  
**Page:** All pages  
**Feature:** Responsive layout  

**Steps to reproduce:**
1. Open the application at http://127.0.0.1:3000
2. Set viewport to 320px width (iPhone SE)
3. Check `document.body.scrollWidth > window.innerWidth`

**Expected:** No horizontal overflow — content fits within viewport  
**Actual:** `document.body.scrollWidth > window.innerWidth` returns `true` — horizontal scrollbar appears  

**Frequency:** 100%  
**First observed:** September 2, 2026  

**Impact:** Users on small devices (iPhone SE, older Android phones) experience horizontal scrolling, making the app difficult to use.

**Suggested fix:** Add `overflow-x: hidden` to the main content container or audit padding/margins at small breakpoints. Check for fixed-width elements that don't scale down.

**Evidence:** `agent-browser eval "document.body.scrollWidth > window.innerWidth"` → `true` at 320px

---

## P3 — Low Issues

### BUG-002: React ForwardRef Warning in Console

**ID:** BUG-002  
**Severity:** P3 — Low  
**Category:** Code Quality  
**Page:** All pages  
**Feature:** Login form / Input components  

**Steps to reproduce:**
1. Open the application
2. Open browser console
3. Observe React warning

**Expected:** No console warnings  
**Actual:** `Warning: Function components cannot be given refs. Attempts to access this ref will fail. Did you mean to use React.forwardRef()?`  

**Frequency:** 100%  
**First observed:** September 2, 2026  

**Impact:** No user-facing impact, but indicates a code quality issue. The warning comes from the `Dk` component (likely a form input wrapper) receiving a ref incorrectly.

**Suggested fix:** Wrap the function component with `React.forwardRef()` or ensure the ref is passed correctly to the underlying DOM element.

**Evidence:** Console error trace shows `Dk` → `Q1` → form → main

---

### BUG-003: Empty State Messages Could Be More Descriptive

**ID:** BUG-003  
**Severity:** P3 — Low  
**Category:** UX / Empty States  
**Page:** Chatbots, Workflows, Webhooks  
**Feature:** Empty state display  

**Steps to reproduce:**
1. Navigate to Chatbots page with no chatbots created
2. Observe the empty state message

**Expected:** Descriptive empty state with clear CTA and explanation  
**Actual:** Generic empty state with minimal guidance  

**Frequency:** 100% when no data  
**First observed:** September 2, 2026  

**Impact:** New users may not understand what chatbots are or how to create them.

**Suggested fix:** Add more descriptive empty states like: "No chatbots yet. Chatbots are deployable widgets that let your users interact with your AI assistants. Create your first chatbot to get started."

---

### BUG-004: Favicon 404 Error

**ID:** BUG-004  
**Severity:** P3 — Low  
**Category:** Asset Loading  
**Page:** All pages  
**Feature:** Favicon  

**Steps to reproduce:**
1. Open browser console
2. Navigate to any page
3. Observe 404 for `/favicon.ico`

**Expected:** Favicon loads successfully  
**Actual:** `GET http://localhost:3000/favicon.ico 404 (Not Found)`  

**Frequency:** 100%  
**First observed:** September 2, 2026  

**Impact:** Browser tab shows default icon instead of branded favicon. Minor branding issue.

**Suggested fix:** The SVG favicon exists at `/favicon.svg` and the redirect from `/favicon.ico` is implemented in `app.js`. The 404 may be from browser caching or the redirect not working correctly. Verify the redirect is functioning.

---

## P4 — Cosmetic Issues

### BUG-005: Inconsistent Button Heights in KB Card Actions

**ID:** BUG-005  
**Severity:** P4 — Cosmetic  
**Category:** Visual Consistency  
**Page:** Knowledge Bases  
**Feature:** KB card action buttons  

**Steps to reproduce:**
1. Navigate to Knowledge Bases page
2. Observe the Ingest, Edit, Open, Delete buttons on a KB card

**Expected:** All action buttons have consistent height and alignment  
**Actual:** Minor height variations between buttons due to different padding/text  

**Frequency:** 100%  
**First observed:** September 2, 2026  

**Impact:** Visual inconsistency, no functional impact.

**Suggested fix:** Ensure all action buttons use the same `size="sm"` variant and consistent padding.

---

### BUG-006: Theme Toggle Dropdown Position Near Edge

**ID:** BUG-006  
**Severity:** P4 — Cosmetic  
**Category:** UI Positioning  
**Page:** All pages  
**Feature:** Theme toggle dropdown  

**Steps to reproduce:**
1. Resize browser to near-maximum width
2. Click the theme toggle button
3. Observe dropdown position

**Expected:** Dropdown appears below the button, fully visible  
**Actual:** Dropdown may clip near the right edge on narrow viewports  

**Frequency:** Conditional (viewport-dependent)  
**First observed:** September 2, 2026  

**Impact:** Minor visual issue on specific viewport sizes.

**Suggested fix:** Add `align="end"` to the dropdown positioning logic when near the right edge.

---

## UX Findings

### UX-001: Company Selector UX
**Finding:** The company selector is well-designed with search functionality. The "New Company" button is conveniently placed.  
**Rating:** Good  

### UX-002: KB Create Wizard
**Finding:** The 5-step wizard is clear and well-organized. Step indicators show progress. However, the "Continue" button being disabled until required fields are filled is good UX.  
**Rating:** Good  

### UX-003: Profile Menu
**Finding:** The profile menu with API docs, All logs, and Sign out is clean and functional. The popover closes correctly on outside click.  
**Rating:** Good  

### UX-004: Sidebar Navigation
**Finding:** The collapsible sidebar with section grouping (Overview, AI, Companies, Infrastructure, Automation, Gateway) is well-organized. The active state indicator is clear.  
**Rating:** Good  

### UX-005: Ask Console
**Finding:** The Ask Console has a clean interface with assistant selector, API key input, and streaming response area. The "Thinking..." state and streaming work correctly.  
**Rating:** Good  

---

## Accessibility Findings

### A11Y-001: Skip to Main Content
**Finding:** The "Skip to main content" link is present and functional.  
**Rating:** Good  

### A11Y-002: Keyboard Navigation
**Finding:** Tab order is logical through the sidebar and main content. Focus indicators are visible.  
**Rating:** Good  

### A11Y-003: ARIA Labels
**Finding:** Most interactive elements have appropriate aria-labels. The company selector, theme toggle, and profile menu all have descriptive labels.  
**Rating:** Good  

### A11Y-004: Color Contrast
**Finding:** The dark theme uses appropriate contrast ratios. Text is readable against the dark background.  
**Rating:** Good  

---

## Performance Findings

### PERF-001: Page Load Speed
**Finding:** Pages load quickly (< 1 second) after initial bundle load. Lazy loading of page modules works correctly.  
**Rating:** Good  

### PERF-002: Streaming Responses
**Finding:** The Ask Console streaming works smoothly with tokens appearing in real-time. No jank or stuttering observed.  
**Rating:** Good  

---

## Security Findings

### SEC-001: API Key Visibility
**Finding:** API keys are properly masked in the UI. The "Show password" toggle on the login form works correctly.  
**Rating:** Good  

### SEC-002: Authentication
**Finding:** Login flow works correctly. Session tokens are stored in localStorage. The 401 redirect to login works.  
**Rating:** Good  

---

## Consistency Findings

### CONS-001: Button Styles
**Finding:** Buttons follow a consistent pattern: primary (indigo), secondary (outline), danger (red). Sizes are consistent across pages.  
**Rating:** Good  

### CONS-002: Card Styles
**Finding:** Cards use consistent padding, border radius, and shadow. The dark theme cards are visually consistent.  
**Rating:** Good  

### CONS-003: Form Inputs
**Finding:** Form inputs use consistent styling with proper focus states. Validation messages are consistently placed.  
**Rating:** Good  

---

## Recommendations

### Priority 1: Critical Fixes
None required.

### Priority 2: Functional Fixes
1. Fix horizontal overflow at 320px viewport (BUG-001)

### Priority 3: UX Improvements
1. Add more descriptive empty states for Chatbots, Workflows, Webhooks (BUG-003)
2. Improve error messages for failed API calls

### Priority 4: Accessibility Fixes
1. Fix React forwardRef warning (BUG-002)

### Priority 5: Visual Polish
1. Ensure consistent button heights in KB cards (BUG-005)
2. Fix theme dropdown positioning near edges (BUG-006)

### Priority 6: Performance Improvements
None required — performance is already good.

---

## Final Verdict

**NEEDS MINOR FIXES**

The application is **production-ready** for core features. The main issue is a responsive layout bug at 320px viewport width that causes horizontal overflow. All other issues are minor (P3/P4) and don't block production deployment.

### Strengths
- Solid multi-tenant architecture
- Clean, consistent UI design
- Good component reuse
- Functional streaming responses
- Proper authentication flow
- Well-organized navigation

### Areas for Improvement
- Responsive layout at very small viewports
- Console warning cleanup
- Empty state messaging
- Minor visual consistency issues

---

## Test Artifacts

Screenshots saved to `/tmp/qa-*.png`:
- `qa-dashboard.png` — Dashboard page
- `qa-assistants.png` — Assistants page
- `qa-chatbots.png` — Chatbots page
- `qa-workflows.png` — Workflows page
- `qa-usage.png` — Usage page
- `qa-webhooks.png` — Webhooks page
- `qa-providers.png` — Providers page
- `qa-sidebar-collapsed.png` — Collapsed sidebar
- `qa-mobile-375.png` — Mobile view at 375px
- `qa-mobile-320.png` — Mobile view at 320px (shows overflow)
- `qa-mobile-sidebar.png` — Mobile sidebar overlay
