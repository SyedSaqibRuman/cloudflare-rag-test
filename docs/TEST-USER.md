# PopularCert AI — Manual Test Cases

> **Purpose:** Real-world test cases for manually verifying the application works correctly.
> **Environment:** http://127.0.0.1:3000 (local dev server)
> **Credentials:** admin@popularcert.com / admin123

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Dashboard](#2-dashboard)
3. [Knowledge Bases](#3-knowledge-bases)
4. [KB Ingestion](#4-kb-ingestion)
5. [Custom Q&A](#5-custom-qa)
6. [Assistants](#6-assistants)
7. [Chatbots](#7-chatbots)
8. [Test AI (Ask Console)](#8-test-ai-ask-console)
9. [AI Providers](#9-ai-providers)
10. [Companies](#10-companies)
11. [Workflows](#11-workflows)
12. [Scheduler](#12-scheduler)
13. [Notifications (Webhooks)](#13-notifications-webhooks)
14. [Usage](#14-usage)
15. [Settings (Config)](#15-settings-config)
16. [Keyboard Shortcuts](#16-keyboard-shortcuts)
17. [Theme & UI](#17-theme--ui)
18. [Mobile Responsiveness](#18-mobile-responsiveness)
19. [Edge Cases](#19-edge-cases)
20. [End-to-End Workflows](#20-end-to-end-workflows)

---

## 1. Authentication

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 1.1 | Login page loads | Navigate to http://127.0.0.1:3000 | Shows "PopularCert AI" title, tagline "Build AI assistants that answer questions using your content", email/password fields, Sign In button | ⬜ |
| 1.2 | Login with valid credentials | Enter admin@popularcert.com / admin123 → Click Sign In | Redirects to Dashboard, no errors | ⬜ |
| 1.3 | Login with invalid password | Enter admin@popularcert.com / wrongpass → Click Sign In | Shows error message, stays on login page | ⬜ |
| 1.4 | Login with empty fields | Click Sign In without entering anything | Shows validation error | ⬜ |
| 1.5 | Login form Enter key | Enter credentials → Press Enter | Submits the form (same as clicking Sign In) | ⬜ |
| 1.6 | Sign out | Click profile menu → Click "Sign Out" | Returns to login page | ⬜ |
| 1.7 | Sign out clears session | Sign out → Navigate to /#dashboard | Redirects to login page | ⬜ |

---

## 2. Dashboard

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 2.1 | Dashboard loads | Log in → View Dashboard | Shows stat cards (Knowledge Bases, Documents, etc.), Quick Actions, Getting Started banner | ⬜ |
| 2.2 | Getting Started banner | View the banner on first login | Shows 4 steps: Add Knowledge → Create Assistant → Test AI → Deploy Chatbot | ⬜ |
| 2.3 | Getting Started step 1 | Click "Add Knowledge" button | Navigates to Knowledge page | ⬜ |
| 2.4 | Getting Started step 2 | Click "Create Assistant" button | Navigates to Assistants page | ⬜ |
| 2.5 | Getting Started step 3 | Click "Test AI" button | Navigates to Test AI page | ⬜ |
| 2.6 | Getting Started step 4 | Click "Deploy Chatbot" button | Navigates to Chatbots page | ⬜ |
| 2.7 | Getting Started dismiss | Click dismiss/close on the banner | Banner disappears | ⬜ |
| 2.8 | Getting Started persistence | Dismiss banner → Refresh page | Banner stays dismissed | ⬜ |
| 2.9 | Quick Actions | Click each quick action button | Navigates to the correct page | ⬜ |
| 2.10 | Stat cards show data | View stat cards | Numbers update based on current company's data | ⬜ |

---

## 3. Knowledge Bases

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 3.1 | KB list loads | Navigate to Knowledge | Shows list of KBs with name, status, document count, vector count | ⬜ |
| 3.2 | KB list empty state | Switch to company with no KBs | Shows empty state with "Create Knowledge Base" CTA | ⬜ |
| 3.3 | Search KBs | Type in search box | Filters list by name | ⬜ |
| 3.4 | Filter by status | Use status filter | Filters list by Active/Inactive/Indexing | ⬜ |
| 3.5 | Create KB — Basic flow | Click "+ Create KB" → Fill name → Continue through all 5 steps → Save | KB appears in list | ⬜ |
| 3.6 | Create KB — Step 1 (Basic Info) | Enter name, description | Name field is required, description is optional | ⬜ |
| 3.7 | Create KB — Step 2 (Data Source) | Select WordPress source | Shows URL field, content type checkboxes (Pages/Posts) | ⬜ |
| 3.8 | Create KB — Step 2 (URL source) | Select URL source | Shows URL field, custom limit option | ⬜ |
| 3.9 | Create KB — Step 2 (File upload) | Select File source | Shows file upload area | ⬜ |
| 3.10 | Create KB — Step 2 (Custom limit) | Select WordPress → Check "Custom limit" → Enter 10 | Shows limit input field | ⬜ |
| 3.11 | Create KB — Step 3 (Basic mode) | View Step 3 in Basic mode | Shows "Recommended Settings" with sensible defaults | ⬜ |
| 3.12 | Create KB — Step 3 (Advanced mode) | Click "Advanced Settings" toggle | Shows Vector Store, Embedding Model, Object Storage, Graph Database | ⬜ |
| 3.13 | Create KB — Step 3 (Back to Basic) | Click "Recommended Settings" toggle | Hides technical fields, shows defaults | ⬜ |
| 3.14 | Create KB — Step 4 (Processing) | View Step 4 | Shows chunk size, chunk overlap, top K, similarity threshold | ⬜ |
| 3.15 | Create KB — Step 5 (Review) | View Step 5 | Shows summary of all configuration before saving | ⬜ |
| 3.16 | Create KB — Cancel | Click Cancel at any step | Modal closes, no KB created | ⬜ |
| 3.17 | Create KB — Back button | Click Back at Step 3 | Returns to Step 2 with data preserved | ⬜ |
| 3.18 | Edit KB | Click KB name → Click Edit → Change name → Save | Name updates in list | ⬜ |
| 3.19 | Edit KB — Cancel | Open Edit modal → Click Cancel | No changes saved | ⬜ |
| 3.20 | Delete KB | Click KB → Click Delete → Confirm | KB removed from list | ⬜ |
| 3.21 | Delete KB — Cancel | Click Delete → Click Cancel in confirmation | KB not deleted | ⬜ |
| 3.22 | KB Detail — Overview tab | Open a KB → View Overview | Shows document count, vector count, infrastructure details | ⬜ |
| 3.23 | KB Detail — Documents tab | Click Documents tab | Lists ingested documents with titles and status | ⬜ |
| 3.24 | KB Detail — Ingestion tab | Click Ingestion tab | Shows ingestion controls, history, and progress | ⬜ |
| 3.25 | KB Detail — Configuration tab | Click Configuration tab | Shows all KB settings in read/edit mode | ⬜ |
| 3.26 | KB Detail — Custom Q&A tab | Click Custom Q&A tab | Shows Q&A pair list with add/edit/delete | ⬜ |

---

## 4. KB Ingestion

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 4.1 | Start WordPress ingestion | Open KB → Ingestion tab → Select "Full website" → Start | Ingestion begins, progress bar appears | ⬜ |
| 4.2 | Ingestion with custom limit | Select "Custom documents" → Enter 5 → Start | Ingestion processes max 5 documents | ⬜ |
| 4.3 | Ingestion progress updates | Start ingestion → Watch progress bar | Progress bar updates, document count increases | ⬜ |
| 4.4 | Ingestion completion | Wait for ingestion to finish | Status changes to "Completed", stats update | ⬜ |
| 4.5 | Ingestion history | After ingestion completes → View history tab | Shows run ID, mode, documents, chunks, status, date | ⬜ |
| 4.6 | Start URL ingestion | Create URL KB → Start ingestion with custom limit 10 | Processes max 10 HTML pages | ⬜ |
| 4.7 | Ingestion status indicators | View ingestion tab during/after run | Shows ✓ Completed, ◐ Running, ⚠ Error | ⬜ |
| 4.8 | Ingestion last run time | Complete an ingestion → View KB card | Shows "Last run: X minutes ago" | ⬜ |
| 4.9 | Cancel running ingestion | Start ingestion → Click Stop/Cancel | Ingestion stops, partial data preserved | ⬜ |
| 4.10 | Re-ingest | After first ingestion → Start another run | Processes only new/changed content (incremental) | ⬜ |

---

## 5. Custom Q&A

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 5.1 | Add Q&A pair | Open KB → Custom Q&A tab → Click Add → Enter Q&A → Save | Pair appears in list | ⬜ |
| 5.2 | Add Q&A with tags | Add pair → Enter tags (e.g., "contact,phone") → Save | Tags saved and displayed | ⬜ |
| 5.3 | Enable/disable Q&A | Toggle the enable switch on a pair | State updates, persists after refresh | ⬜ |
| 5.4 | Edit Q&A pair | Click Edit on a pair → Change answer → Save | Answer updates | ⬜ |
| 5.5 | Delete Q&A pair | Click Delete → Confirm | Pair removed from list | ⬜ |
| 5.6 | Test matcher | Click "Test Matcher" → Type a question | Shows matching Q&A pairs | ⬜ |
| 5.7 | Matcher exact match | Test matcher with exact question text | Shows the matching pair | ⬜ |
| 5.8 | Matcher partial match | Test matcher with partial question text | Shows matching pairs (substring match) | ⬜ |
| 5.9 | Matcher no match | Test matcher with unrelated question | Shows "No matches found" | ⬜ |
| 5.10 | Q&A persistence | Add pair → Refresh page → Check Custom Q&A tab | Pair still exists | ⬜ |

---

## 6. Assistants

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 6.1 | Assistants list loads | Navigate to Assistants | Shows list with name, model, status, KB | ⬜ |
| 6.2 | Empty state | Company with no assistants | Shows empty state with "Create Assistant" CTA | ⬜ |
| 6.3 | Create assistant | Click Create → Fill name, model, prompt → Save | Assistant appears in list | ⬜ |
| 6.4 | Create assistant — required fields | Click Save without filling name | Shows validation error | ⬜ |
| 6.5 | Edit assistant | Click assistant → Edit → Change model → Save | Model updates | ⬜ |
| 6.6 | Duplicate assistant | Click Duplicate → Confirm | Copy appears with "(copy)" suffix | ⬜ |
| 6.7 | Delete assistant | Click Delete → Confirm | Assistant removed from list | ⬜ |
| 6.8 | Assistant linked to KB | Create assistant → Select KB → Save | KB shown in assistant's row | ⬜ |
| 6.9 | Assistant streaming toggle | Toggle streaming on/off | Setting persists | ⬜ |
| 6.10 | Assistant temperature | Set temperature to 0.5 → Save | Value persists | ⬜ |

---

## 7. Chatbots

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 7.1 | Chatbots list loads | Navigate to Chatbots | Shows list with name, status, linked assistant | ⬜ |
| 7.2 | Empty state | Company with no chatbots | Shows empty state with "Create Chatbot" CTA | ⬜ |
| 7.3 | Create chatbot | Click Create → Fill name, description → Save | Chatbot appears in list | ⬜ |
| 7.4 | Edit chatbot | Click chatbot → Edit → Change welcome message → Save | Changes persist | ⬜ |
| 7.5 | Delete chatbot | Click Delete → Confirm | Chatbot removed from list | ⬜ |
| 7.6 | Chatbot linked to assistant | Create chatbot → Select assistant → Save | Assistant shown in chatbot's row | ⬜ |
| 7.7 | Chatbot theme colors | Edit chatbot → Change primary color → Save | Color picker works, color persists | ⬜ |
| 7.8 | Chatbot preview | Click "Preview" button | Shows chat widget preview with configured theme | ⬜ |

---

## 8. Test AI (Ask Console)

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 8.1 | Ask Console loads | Navigate to Test AI | Shows chat interface with message input | ⬜ |
| 8.2 | Send a question | Type "What is ISO 9001?" → Click Send | Response streams in token by token | ⬜ |
| 8.3 | Streaming response | Send a question → Watch response | Tokens appear progressively (not all at once) | ⬜ |
| 8.4 | Empty message | Click Send without typing anything | Button is disabled or shows validation | ⬜ |
| 8.5 | Long question | Type a very long question (200+ chars) → Send | Processes correctly, no UI break | ⬜ |
| 8.6 | Special characters | Type "What about <script>alert(1)</script>?" → Send | Handles safely, no XSS | ⬜ |
| 8.7 | Follow-up question | Send first question → Send follow-up | Context is maintained (if history enabled) | ⬜ |
| 8.8 | Sources shown | Send a question that matches ingested content | Sources panel shows referenced documents | ⬜ |
| 8.9 | Error handling | Send question with no KB configured | Shows meaningful error message | ⬜ |
| 8.10 | Clear conversation | Click "Clear" or refresh | Conversation resets | ⬜ |

---

## 9. AI Providers

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 9.1 | Providers list loads | Navigate to AI Providers | Shows list of providers with name, status, models | ⬜ |
| 9.2 | Search providers | Type "Cloudflare" in search | Filters to Cloudflare provider | ⬜ |
| 9.3 | Provider detail | Click on a provider | Shows auth form, resources, models | ⬜ |
| 9.4 | Add credentials | Click "Add Connection" → Fill form → Save | Connection appears in list | ⬜ |
| 9.5 | Edit credentials | Click connection → Edit → Change token → Save | Token updated | ⬜ |
| 9.6 | Verify connection | Click "Verify" on a connection | Shows success/failure status | ⬜ |
| 9.7 | Delete connection | Click Delete → Confirm | Connection removed | ⬜ |
| 9.8 | Model list | View models tab | Shows available models for the provider | ⬜ |
| 9.9 | Neo4j provider | Search "neo4j" | Shows Neo4j provider in list | ⬜ |

---

## 10. Companies

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 10.1 | Companies list loads | Navigate to Companies | Shows list of companies | ⬜ |
| 10.2 | Create company | Click Create → Enter name → Save | Company appears in list | ⬜ |
| 10.3 | Company name validation | Enter invalid name (e.g., "My Company!") | Shows validation error (must be lowercase, alphanumeric, hyphens) | ⬜ |
| 10.4 | Edit company | Click company → Edit → Change settings → Save | Changes persist | ⬜ |
| 10.5 | Delete company | Click Delete → Confirm | Company removed | ⬜ |
| 10.6 | Switch company | Use company selector in header | Data changes to reflect selected company | ⬜ |
| 10.7 | Company persistence | Switch company → Refresh page | Selected company persists | ⬜ |
| 10.8 | Company isolation | Create KB in Company A → Switch to Company B | Company B has no KBs from Company A | ⬜ |

---

## 11. Workflows

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 11.1 | Workflows list loads | Navigate to Workflows | Shows list or empty state | ⬜ |
| 11.2 | Create workflow | Click Create → Fill name → Save | Workflow appears in list | ⬜ |
| 11.3 | Edit workflow | Click workflow → Edit → Change name → Save | Name updates | ⬜ |
| 11.4 | Delete workflow | Click Delete → Confirm | Workflow removed | ⬜ |
| 11.5 | Workflow steps | Open workflow → Add steps | Steps appear in order | ⬜ |
| 11.6 | Run workflow manually | Click "Run" or "Execute" | Workflow starts executing | ⬜ |
| 11.7 | Workflow status | View workflow list | Shows status (active/inactive/error) | ⬜ |

---

## 12. Scheduler

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 12.1 | Scheduler loads | Navigate to Scheduler | Shows scheduler controls and job list | ⬜ |
| 12.2 | Start cron | Click "Start Cron" | Cron job starts, status updates | ⬜ |
| 12.3 | Stop cron | Click "Stop Cron" | Cron job stops | ⬜ |
| 12.4 | Running jobs | View running jobs section | Shows currently executing jobs | ⬜ |
| 12.5 | Job history | View job history | Shows completed/failed jobs with timestamps | ⬜ |
| 12.6 | Manual job start | Click "Start Job" → Select job type | Job starts executing | ⬜ |
| 12.7 | Stop manual job | Start a job → Click "Stop" | Job stops | ⬜ |

---

## 13. Notifications (Webhooks)

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 13.1 | Webhooks list loads | Navigate to Notifications | Shows list or empty state | ⬜ |
| 13.2 | Create webhook | Click Create → Enter URL → Save | Webhook appears in list | ⬜ |
| 13.3 | Edit webhook | Click webhook → Edit → Change URL → Save | URL updates | ⬜ |
| 13.4 | Delete webhook | Click Delete → Confirm | Webhook removed | ⬜ |
| 13.5 | Test webhook | Click "Test" button | Sends test payload to URL | ⬜ |
| 13.6 | Webhook events | View webhook configuration | Shows available event types | ⬜ |

---

## 14. Usage

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 14.1 | Usage page loads | Navigate to Usage | Shows stat cards (Total Requests, Tokens, Cost, Latency) | ⬜ |
| 14.2 | Stat cards with tooltips | Hover over each stat card label | Tooltip explains the metric | ⬜ |
| 14.3 | Usage data | View usage table | Shows recent requests with timestamp, model, tokens, cost | ⬜ |
| 14.4 | Filter usage | Use date range filter | Data filters by selected period | ⬜ |
| 14.5 | Empty usage | Company with no usage | Shows empty state | ⬜ |

---

## 15. Settings (Config)

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 15.1 | Settings page loads | Navigate to Settings | Shows configuration form with model, URL, prompt settings | ⬜ |
| 15.2 | Change model | Select different model from dropdown → Save | Model updates | ⬜ |
| 15.3 | Change URLs | Update website URL → Save | URL persists | ⬜ |
| 15.4 | System prompt | Edit system prompt → Save | Prompt persists | ⬜ |
| 15.5 | Cancel changes | Make changes → Click Cancel | Changes not saved | ⬜ |
| 15.6 | Reset settings | Click "Reset" → Confirm | Settings return to defaults | ⬜ |

---

## 16. Keyboard Shortcuts

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 16.1 | Ctrl+K opens palette | Press Ctrl+K (or Cmd+K on Mac) | Command palette opens | ⬜ |
| 16.2 | Command palette search | Type "knowledge" in palette | Filters to Knowledge page | ⬜ |
| 16.3 | Command palette navigation | Press arrow keys | Selection moves up/down | ⬜ |
| 16.4 | Command palette select | Press Enter on selected item | Navigates to that page | ⬜ |
| 16.5 | Command palette close | Press Esc | Palette closes | ⬜ |
| 16.6 | Command palette click outside | Click outside the palette | Palette closes | ⬜ |
| 16.7 | Search button in header | Click the search icon in header | Opens command palette | ⬜ |

---

## 17. Theme & UI

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 17.1 | Dark theme (default) | Load app | Dark theme applied | ⬜ |
| 17.2 | Switch to Light | Click theme toggle → Select "Light" | Light theme applied | ⬜ |
| 17.3 | Switch to Dark | Click theme toggle → Select "Dark" | Dark theme applied | ⬜ |
| 17.4 | Theme persistence | Switch theme → Refresh page | Theme persists | ⬜ |
| 17.5 | Sidebar collapse | Click collapse button on sidebar | Sidebar collapses to icons | ⬜ |
| 17.6 | Sidebar expand | Click expand button | Sidebar expands to full width | ⬜ |
| 17.7 | Sidebar persistence | Collapse sidebar → Refresh | Sidebar stays collapsed | ⬜ |
| 17.8 | Sidebar nav tooltips | Hover over collapsed sidebar items | Tooltips show item names | ⬜ |
| 17.9 | Profile menu | Click profile/avatar in header | Menu shows: API Docs, All Logs, Sign Out | ⬜ |
| 17.10 | API Docs link | Click "API Docs" in profile menu | Opens Swagger UI in new tab | ⬜ |
| 17.11 | All Logs link | Click "All Logs" in profile menu | Navigates to Logs page | ⬜ |

---

## 18. Mobile Responsiveness

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 18.1 | Mobile viewport (375px) | Resize browser to 375px width | Layout adjusts, no horizontal scroll | ⬜ |
| 18.2 | Mobile sidebar | Click hamburger menu | Sidebar opens as overlay | ⬜ |
| 18.3 | Mobile sidebar close | Click outside sidebar or X | Sidebar closes | ⬜ |
| 18.4 | Mobile navigation | Navigate between pages on mobile | Pages load correctly | ⬜ |
| 18.5 | Mobile forms | Fill out a form on mobile | Inputs are usable, keyboard doesn't overlap | ⬜ |
| 18.6 | Mobile modals | Open a modal on mobile | Modal fits on screen, buttons accessible | ⬜ |
| 18.7 | Mobile tables | View a table on mobile | Table scrolls horizontally or stacks | ⬜ |
| 18.8 | Mobile dropdowns | Open a dropdown on mobile | Dropdown fits on screen | ⬜ |
| 18.9 | Tablet viewport (768px) | Resize to 768px | Layout adjusts appropriately | ⬜ |
| 18.10 | Large viewport (1920px) | Resize to 1920px | Layout uses space well, no awkward stretching | ⬜ |

---

## 19. Edge Cases

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 19.1 | Very long name | Create KB with 60-character name | Name truncates gracefully in list | ⬜ |
| 19.2 | Special characters in name | Create KB named `test-<b>bold</b>` | Renders safely, no XSS | ⬜ |
| 19.3 | Unicode in name | Create KB named `知识库测试` | Renders correctly | ⬜ |
| 19.4 | Emoji in name | Create KB named `📚 My Docs` | Renders correctly | ⬜ |
| 19.5 | Empty description | Create KB with empty description | Saves without error | ⬜ |
| 19.6 | Rapid button clicks | Click "Save" button 5 times rapidly | Only one save request sent | ⬜ |
| 19.7 | Double-click modal | Double-click a modal button | No duplicate actions | ⬜ |
| 19.8 | Browser back button | Navigate to KB detail → Press Back | Returns to KB list | ⬜ |
| 19.9 | Browser forward button | Press Back → Press Forward | Returns to KB detail | ⬜ |
| 19.10 | Direct URL navigation | Navigate to /#knowledge directly | Page loads correctly | ⬜ |
| 19.11 | Refresh during loading | Start ingestion → Refresh page | Page recovers gracefully | ⬜ |
| 19.12 | Close modal during request | Open edit modal → Make changes → Click Save → Immediately click X | Request completes or cancels gracefully | ⬜ |
| 19.13 | Network disconnect | Start ingestion → Disconnect network → Reconnect | Error shown, app recovers | ⬜ |
| 19.14 | Very long Q&A answer | Add Q&A with 1000+ word answer | UI handles it without overflow | ⬜ |
| 19.15 | Multiple browser tabs | Open app in 2 tabs → Create KB in tab 1 → Check tab 2 | Tab 2 shows the new KB (after refresh) | ⬜ |

---

## 20. End-to-End Workflows

| # | Test Case | Steps | Expected Result | Status |
|---|-----------|-------|-----------------|--------|
| 20.1 | **Full KB → Assistant → Test flow** | 1. Create KB "e2e-kb" with WordPress source | KB created | ⬜ |
| | | 2. Ingest content (wait for completion) | Documents ingested | ⬜ |
| | | 3. Create Assistant "e2e-assistant" linked to "e2e-kb" | Assistant created | ⬜ |
| | | 4. Go to Test AI → Select "e2e-assistant" | Assistant selected | ⬜ |
| | | 5. Ask "What is this website about?" | Response references ingested content | ⬜ |
| 20.2 | **Custom Q&A intercept** | 1. Add Q&A pair: Q="What is your phone?" A="+91 98765 43210" | Pair saved | ⬜ |
| | | 2. Go to Test AI → Ask "What is your phone number?" | Returns the stored answer (no LLM call) | ⬜ |
| 20.3 | **Multi-company isolation** | 1. Create Company "test-a" | Company created | ⬜ |
| | | 2. Create KB in "test-a" | KB exists in test-a | ⬜ |
| | | 3. Switch to Company "test-b" | No KBs shown | ⬜ |
| | | 4. Switch back to "test-a" | KB still there | ⬜ |
| 20.4 | **Chatbot deployment flow** | 1. Create KB with content | KB ready | ⬜ |
| | | 2. Create Assistant linked to KB | Assistant ready | ⬜ |
| | | 3. Create Chatbot linked to Assistant | Chatbot ready | ⬜ |
| | | 4. Preview chatbot | Chat widget shows with correct theme | ⬜ |
| 20.5 | **Provider → KB → Ingest flow** | 1. Add Cloudflare credentials on Providers page | Credentials saved | ⬜ |
| | | 2. Create KB using Vectorize as vector store | KB created | ⬜ |
| | | 3. Ingest content | Vectors stored in Vectorize | ⬜ |
| | | 4. Ask question in Test AI | Response uses Vectorize data | ⬜ |
| 20.6 | **Onboarding wizard flow** | 1. Log in as new user (clear localStorage) | Getting Started banner shows | ⬜ |
| | | 2. Click "Add Knowledge" → Create KB | Step 1 complete | ⬜ |
| | | 3. Return to Dashboard → Click "Create Assistant" | Step 2 complete | ⬜ |
| | | 4. Return to Dashboard → Click "Test AI" | Step 3 complete | ⬜ |
| | | 5. Return to Dashboard → Click "Deploy Chatbot" | Step 4 complete | ⬜ |
| | | 6. Dashboard shows "All steps completed" | Onboarding done | ⬜ |
| 20.7 | **Ingestion with custom limit** | 1. Create KB with WordPress source | KB created | ⬜ |
| | | 2. Set custom limit to 3 | Limit set | ⬜ |
| | | 3. Start ingestion | Ingestion starts | ⬜ |
| | | 4. Wait for completion | Only 3 documents processed | ⬜ |
| | | 5. Check Documents tab | Exactly 3 documents listed | ⬜ |
| 20.8 | **Workflow execution** | 1. Create a workflow | Workflow created | ⬜ |
| | | 2. Add ingestion step | Step added | ⬜ |
| | | 3. Run workflow manually | Workflow executes | ⬜ |
| | | 4. Check execution status | Shows completion status | ⬜ |

---

## Bug Report Template

When you find a bug, use this format:

```
BUG-XXX: [Short title]

Severity: P0/P1/P2/P3/P4
Page: [Which page]
Steps to Reproduce:
1. [First step]
2. [Second step]
3. [Third step]

Expected: [What should happen]
Actual: [What actually happened]

Screenshot: [If applicable]
```

### Severity Levels

| Level | Meaning |
|-------|---------|
| **P0** | Critical — Application unusable |
| **P1** | High — Major feature broken |
| **P2** | Medium — Feature works incorrectly |
| **P3** | Low — Minor UI/UX issue |
| **P4** | Cosmetic — Very small visual issue |

---

## Quick Reference

### Pages and Routes

| Page | Route | Nav Label |
|------|-------|-----------|
| Dashboard | `#dashboard` | Dashboard |
| Knowledge | `#knowledge` | Knowledge |
| Assistants | `#assistants` | Assistants |
| Chatbots | `#chatbots` | Chatbots |
| Test AI | `#ask` | Test AI |
| Companies | `#companies` | Workspaces |
| Settings | `#config` | Settings |
| Workflows | `#workflows` | Workflows |
| Scheduler | `#scheduler` | Scheduler |
| Notifications | `#webhooks` | Notifications |
| Usage | `#usage` | Usage |
| AI Providers | `#catalog` | AI Providers |
| Logs | `#logs` | Logs |
| KB Detail | `#kbs/:key` | (nested) |
| Assistants Detail | `#assistants/:key` | (nested) |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `⌘K` | Open command palette |
| `Esc` | Close palette/modal |
| `Enter` | Submit form / Select item |
| `Tab` | Navigate between elements |
| `↑↓` | Navigate in lists/palettes |

---

*Last updated: September 2, 2026*
