# Layman / Real-User UX Test Report — Second Pass

**Date:** September 2, 2026  
**Tester:** Buffy (Acting as non-technical first-time user)  
**Environment:** Chrome/Chromium, http://127.0.0.1:3000  

---

## Overall First-Time User Experience

**Score: 4/10**

This application is a **powerful AI management platform** that is **overwhelmingly technical** for a non-technical user. The terminology, workflows, and configuration options assume significant technical knowledge. A normal person would be completely lost within seconds of logging in.

---

## Can a Non-Technical User Use It?

**Only with documentation**

A non-technical user would not be able to use this application without significant help. The terminology alone (Vector Index, R2 Bucket, Ingestion, Embedding, Providers) would stop most people in their tracks.

---

## Top 10 Confusing Things

| Rank | Confusion | Where | Why |
|------|-----------|-------|-----|
| 1 | **"What is this application?"** | Login page | No explanation of what the app does |
| 2 | **"What is a workspace?"** | Dashboard | The concept is unclear |
| 3 | **"What is Ingestion?"** | KB page | Should be "Import" or "Upload" |
| 4 | **"What is a Vector Index?"** | Dashboard | I don't know why I need this |
| 5 | **"What's the difference between Assistants and Chatbots?"** | Sidebar | Seems redundant |
| 6 | **"What are Providers?"** | Sidebar | I thought this was about AI, not cloud services |
| 7 | **"What is RAG?"** | Everywhere | The acronym is never explained |
| 8 | **"What happens when I click Ingest?"** | KB page | No explanation of the process |
| 9 | **"How do I get my content into the system?"** | KB page | The workflow is unclear |
| 10 | **"What should I do after creating a KB?"** | KB page | No guidance |

---

## Top 10 Frustrating Things

| Rank | Frustration | Where | Why |
|------|-------------|-------|-----|
| 1 | **No onboarding** | Everywhere | No idea where to start |
| 2 | **Too much jargon** | Everywhere | Technical terms without explanations |
| 3 | **No help system** | Everywhere | No tooltips, no guides |
| 4 | **Unclear value proposition** | Login | I don't know what this does for me |
| 5 | **Complex workflows** | KB Create | Simple tasks require many steps |
| 6 | **Technical dropdown options** | KB Create | "Jina AI · Jina Embeddings v2 Base Code" is meaningless |
| 7 | **No "What's next?" guidance** | After actions | No guidance on next steps |
| 8 | **Unclear error messages** | Errors | "HTTP 422" means nothing to me |
| 9 | **Missing search on some pages** | Assistants, Chatbots | Can't find what I'm looking for |
| 10 | **No examples or templates** | Empty pages | Don't know what a completed setup looks like |

---

## Top 10 Things Done Well

| Rank | Positive | Where | Why |
|------|----------|-------|-----|
| 1 | **Professional visual design** | Everywhere | Dark theme looks polished |
| 2 | **KB Create wizard** | KB page | 5-step wizard is well-structured |
| 3 | **Streaming AI responses** | Ask Console | Real-time responses are impressive |
| 4 | **Company selector** | Header | Search functionality works well |
| 5 | **Profile menu** | Header | API docs and logs are convenient |
| 6 | **Sidebar collapse** | Sidebar | Smooth animation |
| 7 | **Theme toggle** | Header | Easy to find and use |
| 8 | **Loading states** | Everywhere | Spinners appear when loading |
| 9 | **Success notifications** | Everywhere | Toast messages confirm actions |
| 10 | **Confirmation dialogs** | Delete actions | Clear confirmations for destructive actions |

---

## Most Confusing Terminology

| Term | Where | Why confusing | Suggested explanation |
|------|-------|---------------|----------------------|
| **Ingestion** | KB page | Sounds like eating food | "Import content from your website" |
| **Vector Index** | Dashboard | I don't know what a vector is | "Index that enables AI-powered search" |
| **Embedding Model** | KB Create | Very technical | "Convert text to AI-readable format" |
| **Provider** | Sidebar | Vague | "Cloud AI service you're connected to" |
| **RAG** | Everywhere | Acronym never explained | "AI-powered search and answer system" |
| **Knowledge Base** | Sidebar | Could be clearer | "Collection of documents for AI to reference" |
| **Webhook** | Sidebar | Very technical | "Send alerts to other services" |
| **Endpoint** | Providers | Technical | "URL where the AI service can be reached" |
| **Graph Database** | KB Create | Very technical | "Database for storing relationships" |
| **Workspace** | Header | Unclear concept | "Your company's environment" |

---

## Workflow Results

| Task | Result | Confusion | Notes |
|------|--------|----------:|-------|
| **Create Knowledge Base** | SUCCESS — Difficult | 3/5 | Wizard is good but step 3 is confusing |
| **Configure AI** | BLOCKED | 5/5 | Don't understand Providers/Models |
| **Create Assistant** | SUCCESS — With Guessing | 4/5 | Don't understand the difference from Chatbots |
| **Create Chatbot** | SUCCESS — With Guessing | 4/5 | Don't understand the difference from Assistants |
| **Create Workflow** | BLOCKED | 5/5 | Don't understand what workflows are |
| **Configure Webhook** | BLOCKED | 5/5 | Don't understand what webhooks are |
| **Check Usage** | SUCCESS — Difficult | 2/5 | See numbers but don't understand what they mean |

---

## Pages With UX Problems

### 1. Login Page
**Problem:** No explanation of what the application does  
**Impact:** User doesn't know if they're in the right place  
**Score: 2/5**

### 2. Dashboard
**Problem:** "No company selected" is confusing. "Vector Index" and "R2 Bucket" columns are meaningless.  
**Impact:** User doesn't know what to do first  
**Score: 2/5**

### 3. Knowledge Bases — Step 3
**Problem:** "Vector Store", "Embedding Model", "Graph Database" are very technical  
**Impact:** User can't make informed decisions  
**Score: 2/5**

### 4. Providers
**Problem:** 113 AI providers with no explanation of what they do  
**Impact:** Overwhelming choice with no guidance  
**Score: 2/5**

### 5. Configuration
**Problem:** "Models", "Playground", "Security" tabs are unclear  
**Impact:** User doesn't know what to configure  
**Score: 2/5**

---

## Pages That Are Excellent

### 1. KB Create Wizard (Steps 1, 2, 4, 5)
**Why:** Clear progression, sensible defaults, good review step  
**Score: 4/5**

### 2. Ask Console
**Why:** Clean interface, streaming works well, clear send button  
**Score: 4/5**

### 3. Profile Menu
**Why:** API docs, logs, sign out are clearly labeled  
**Score: 4/5**

### 4. Sidebar Navigation
**Why:** Well-organized sections, clear active state  
**Score: 4/5**

---

## Mobile Experience

**Score: 3/5**

### What Works
- ✅ Sidebar collapses to hamburger menu
- ✅ Cards stack vertically
- ✅ Buttons are tappable
- ✅ Text is readable

### What Doesn't Work
- ⚠️ Tables are hard to read
- ⚠️ Some dropdowns get cropped
- ⚠️ Horizontal scrolling at 320px
- ⚠️ Forms feel cramped

---

## Visual Polish

**Score: 7/10**

### What Looks Good
- ✅ Consistent dark theme
- ✅ Good contrast
- ✅ Clean card layouts
- ✅ Professional typography
- ✅ Consistent spacing

### What Could Be Better
- ⚠️ Some pages feel sparse
- ⚠️ Icons could be more descriptive
- ⚠️ Empty states could be more engaging

---

## Learnability

**Score: 3/5**

### What I Learned
- ✅ Navigation structure
- ✅ Common actions (Create, Edit, Delete)
- ✅ Theme toggle location

### What I Didn't Learn
- ❌ What the application does
- ❌ What the technical terms mean
- ❌ How to complete the main workflow
- ❌ What the difference is between similar features

---

## Real User Task Success

### Task: "I want to add my website content so the AI can answer questions about it"

**Steps I took:**
1. Logged in ✓
2. Selected a company ✓ (but didn't know what it meant)
3. Clicked "Knowledge Bases" ✓
4. Clicked "+ Create KB" ✓
5. Filled in the name ✓
6. Selected "URL" as source ✓
7. Got to Step 3 — "Vector Store", "Embedding Model", "Graph Database" ❌
8. Gave up

**Result: BLOCKED**

I couldn't complete the task because I didn't understand the technical requirements in Step 3.

---

## Most Important Question

### "If you gave this application to a normal person and gave them NO documentation, where would they get stuck first?"

**Answer:** They would get stuck at the **login page** because they wouldn't know what the application does. If they somehow got past login, they would get stuck at the **Dashboard** because they wouldn't understand "Vector Index" or "R2 Bucket". If they tried to create a Knowledge Base, they would get stuck at **Step 3** because they wouldn't understand "Vector Store", "Embedding Model", or "Graph Database".

### "What is the single biggest change that would make this application easier for a normal person to use?"

**Answer:** **Add a "Getting Started" wizard** that guides users through the first setup without requiring them to understand technical terminology. The wizard should:
1. Explain what the application does in plain language
2. Ask simple questions like "What is your website URL?"
3. Auto-configure the technical settings behind the scenes
4. Show a clear "What's next?" after completion

---

## Summary

The PopularCert AI Admin Portal is a **well-built, feature-rich application** that is **clearly designed for technical users**. The visual design is professional, the workflows are logical, and the features are comprehensive.

However, for a **non-technical first-time user**, the application is **overwhelming and confusing**. The heavy use of technical jargon, lack of onboarding, and complex workflows would prevent most people from successfully using the application without documentation or training.

**To make this accessible to a wider audience, the application needs:**
1. A "Getting Started" wizard for non-technical users
2. Plain-language alternatives for all technical terms
3. Contextual help throughout
4. Examples and templates for common use cases
5. Clear "What's next?" guidance after completing actions

**The good news:** The underlying functionality is solid. With better UX writing and some onboarding, this could be accessible to a much wider audience.
