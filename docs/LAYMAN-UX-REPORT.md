# Layman / Real-User UX Test Report — PopularCert AI Admin Portal

**Date:** September 2, 2026  
**Tester:** Buffy (Acting as non-technical first-time user)  
**Environment:** Chrome/Chromium, http://127.0.0.1:3000  

---

## Overall Experience

**Score: 5/10**

This application is clearly built for technical users who understand AI, RAG, vector databases, and cloud infrastructure. A normal person would be completely lost. The terminology is heavily technical, the workflows assume prior knowledge, and there's no onboarding or help system.

---

## Could a First-Time User Use It?

**Only with documentation**

A non-technical user would not be able to use this application without significant help. The terminology alone (Vector Index, R2 Bucket, Ingestion, Embedding, Providers) would stop most people in their tracks.

---

## First-Time User Test

### What is this application?
**Answer:** I have no idea. The login page says "PopularCert Admin" and "Sign in to manage tenants, configuration, and pipelines." I don't know what "tenants" or "pipelines" means. Is this for managing a business? A website? An AI system?

### What can I do here?
**Answer:** After logging in, I see a sidebar with many options: Dashboard, Ask Console, Knowledge Bases, Assistants, Chatbots, Companies, Configuration, Scheduler, Workflows, Usage, Webhooks, Providers. I don't know what most of these mean.

### Where should I start?
**Answer:** I honestly don't know. There's no "Getting Started" guide, no tour, no tooltips explaining what anything does. The Dashboard shows "Quick Actions" but the actions are things like "Create Vector Index" and "Run Ingestion" — I don't know what those are.

---

## Navigation Test

### Sidebar Navigation
**Score: 3/5**

The sidebar is well-organized with clear sections (Overview, AI, Companies, Infrastructure, Automation, Gateway). However:

**Confusions:**
1. **"Ask Console"** — What is this? Is it a chat? A search? A test tool?
2. **"Knowledge Bases"** — What is a knowledge base? Is it a database? A document library?
3. **"Assistants"** — What are these? Are they chatbots? AI characters?
4. **"Chatbots"** — How is this different from "Assistants"?
5. **"Scheduler"** — What gets scheduled? Jobs? Tasks? Cron?
6. **"Workflows"** — What kind of workflows? Business processes? Automation?
7. **"Webhooks"** — What is a webhook? This is a very technical term.
8. **"Providers"** — Providers of what? AI services? Cloud services?

**Positive:**
- The section grouping makes sense logically
- Active state is clear
- Collapse/expand works well

---

## Button Test

### Dashboard Quick Actions
**Score: 2/5**

| Button | What I Think It Does | What It Actually Does | Confusion Level |
|--------|---------------------|----------------------|-----------------|
| "New Company — Register a tenant" | Create a new company account? | Creates a new tenant | High — what's a "tenant"? |
| "Create Vector Index — Provision a Vectorize index" | ??? | Creates a vector index | Very High — completely unclear |
| "Run Ingestion — Sync content from the source" | Sync something? Import data? | Starts content ingestion | High — what's "ingestion"? |
| "Open Ask Console — Test the assistant live" | Open a chat? Test something? | Opens the Ask Console | Medium — "assistant" is somewhat clear |

### Knowledge Bases Page
**Score: 3/5**

| Button | Clarity |
|--------|---------|
| "+ Create KB" | Clear — create a knowledge base |
| "Ingest" | Unclear — what does ingestion mean? |
| "Edit" | Clear |
| "Open" | Clear |
| "Delete" | Clear but scary — what gets deleted? |

---

## Icon Test

**Score: 3/5**

Most icons are standard and recognizable:
- ✅ Search icon (magnifying glass)
- ✅ Refresh icon (circular arrows)
- ✅ Delete icon (trash can)
- ✅ Edit icon (pencil)
- ✅ Close icon (X)

**Ambiguous icons:**
- ⚠️ The "Ingest" button has no icon — just text
- ⚠️ The "Workflow" icon in the sidebar is unclear
- ⚠️ The "Providers" icon doesn't clearly represent what it is

---

## Forms Test

### KB Create Wizard
**Score: 4/5**

The 5-step wizard is actually well-designed:
1. **Basic Info** — Name, Key, Description — clear fields
2. **Data Source** — WordPress, File, URL — clear options with icons
3. **Storage & Search** — Dropdowns for Vector Store, Storage, Embedding, Graph — but very technical
4. **Processing** — Chunk size, overlap — technical but has sensible defaults
5. **Review** — Summary before creation — good UX

**Issues:**
- The "Key" field auto-generates from name — good, but the explanation "Auto-generated from name · Editable in create mode" is technical
- Step 3 has terms like "Vector Store", "Embedding Model", "Graph Database" — a normal user wouldn't understand these

### Login Form
**Score: 4/5**

Simple and clean:
- Username field with placeholder
- Password field with show/hide toggle
- Clear "Sign In" button
- No "Forgot Password" link — could be a problem

---

## Error Test

**Score: 3/5**

When I tested the Ask Console with an empty question, the Send button was disabled — good UX, prevents errors.

However, if an API call fails, the error messages are technical:
- "Cannot reach the API server." — OK, but what should I do?
- "HTTP 422" — I wouldn't understand this
- "Request failed (HTTP 500)" — I wouldn't understand this

**Preferred error format:**
> "Something went wrong while saving your changes. Please try again in a few moments. If the problem persists, check your internet connection."

---

## Loading Test

**Score: 4/5**

Loading states are generally good:
- ✅ Spinners appear when pages are loading
- ✅ Buttons show loading states
- ✅ The Ask Console shows "Thinking..." during AI responses
- ✅ Streaming responses appear in real-time

**Issues:**
- Some page transitions have no loading indicator — the page just goes blank for a moment
- The KB Create wizard doesn't show a loading state when saving

---

## Success Test

**Score: 4/5**

Success feedback is generally good:
- ✅ Toast notifications appear after successful operations
- ✅ Pages refresh to show new data
- ✅ The Ask Console shows answers immediately

**Issues:**
- After creating a KB, the success message is brief — could show "KB created successfully! You can now ingest content from the Knowledge Bases page."
- No "What's next?" guidance after completing actions

---

## Empty Pages Test

**Score: 3/5**

Empty states vary:
- ✅ Knowledge Bases page shows "No knowledge bases yet" with a CTA
- ⚠️ Chatbots page shows a basic empty state
- ⚠️ Workflows page shows a basic empty state

**Issues:**
- Empty states don't explain what the feature does or why you'd want to use it
- No examples or templates to help users get started

---

## Delete / Dangerous Actions Test

**Score: 4/5**

Destructive actions are handled well:
- ✅ Delete buttons show confirmation dialogs
- ✅ Confirmations are clear ("Delete this KB?")
- ✅ Cancel is available
- ✅ The delete action requires typing or confirmation

**Issues:**
- The confirmation could be more explicit about what will be deleted ("This will permanently delete the KB 'pop-test' and all its data. This cannot be undone.")

---

## Search Test

**Score: 4/5**

Search functionality works well:
- ✅ KB page has a search box
- ✅ Search filters results in real-time
- ✅ Clear button is available

**Issues:**
- No search on some pages (Assistants, Chatbots)
- No search on the Providers page (which has 100+ items)

---

## Dropdown Test

**Score: 3/5**

Dropdowns are functional but have issues:

**Company Selector:**
- ✅ Clear label ("No company selected")
- ✅ Search functionality
- ✅ Shows company status

**KB Create Wizard Dropdowns:**
- ⚠️ "Vector Store" — What is this? The option "Company default (config)" doesn't explain anything
- ⚠️ "Embedding Model" — Options like "Jina AI · Jina Embeddings v2 Base Code" are very technical
- ⚠️ "Graph Database" — "Neo4j Graph DB · Neo4j" — I wouldn't know what Neo4j is

---

## Settings Test

**Score: 3/5**

Settings pages are functional but confusing:

**Configuration Page:**
- ⚠️ "Models" tab — What models? AI models? How do I configure them?
- ⚠️ "Playground" tab — What is this? A test area?
- ⚠️ "Security" tab — What security settings?

**Issues:**
- No explanations for what each setting does
- No tooltips or help text
- Technical terminology everywhere

---

## AI / Technical Terminology Test

**Score: 2/5**

This is the biggest problem. The application is filled with technical jargon:

| Term | What a Normal User Thinks | What It Actually Means |
|------|--------------------------|----------------------|
| **Provider** | A person or company that provides something | An AI service (Cloudflare, OpenAI, etc.) |
| **Model** | A 3D model? A car model? | An AI model (Llama, GPT, etc.) |
| **Token** | A coin? A pass? | A unit of text for AI processing |
| **Embedding** | A video embed? | A mathematical representation of text |
| **Vector** | A direction? An arrow? | A list of numbers representing meaning |
| **Vectorize** | Make into a vector? | Convert text to vector embeddings |
| **RAG** | A noise? | Retrieval-Augmented Generation |
| **Knowledge Base** | A encyclopedia? A database? | A collection of documents for AI search |
| **Ingestion** | Eating food? | Importing content into the system |
| **Endpoint** | A finish line? | An API URL address |
| **API** | ??? | Application Programming Interface |
| **Runtime** | A jogging track? | When the code is running |
| **Resource** | A natural resource? | A cloud service or configuration |
| **Workspace** | An office desk? | A company/tenant environment |
| **Agent** | A secret agent? | An AI assistant |
| **Fallback** | A backup plan? | A default when the primary fails |
| **Temperature** | Weather temperature? | How creative/random the AI response is |
| **Context** | Background information? | The conversation history |
| **Chunk** | A piece of something? | A split piece of a document |
| **Namespace** | A name space? | A container for organizing vectors |

**Recommendation:** Add tooltips, descriptions, or simpler alternatives for all technical terms.

---

## Visual Quality

**Score: 7/10**

The visual design is actually quite good:
- ✅ Consistent dark theme
- ✅ Good contrast and readability
- ✅ Clean card-based layout
- ✅ Consistent spacing and padding
- ✅ Professional typography

**Issues:**
- Some pages feel sparse with too much whitespace
- The sidebar could use icons to help with recognition
- Some buttons have inconsistent heights

---

## Mobile Test

**Score: 3/5**

Mobile experience has issues:
- ✅ Sidebar collapses to hamburger menu
- ✅ Cards stack vertically
- ⚠️ Tables are hard to read on small screens
- ⚠️ Some dropdowns get cropped near edges
- ⚠️ Horizontal scrolling at 320px width

---

## Frustration Test

**Moments of Frustration:**

1. **"What is a workspace?"** — I don't understand why I need to select a workspace
2. **"What does Ingest mean?"** — I want to add documents but I don't know what ingestion is
3. **"What's the difference between Assistants and Chatbots?"** — These seem like the same thing
4. **"What is a Vector Index?"** — I don't know why I need this
5. **"Where do I add documents?"** — I expected a simple upload, not this complex process
6. **"What does the Ask Console do?"** — Is it a chat? A search? A test?
7. **"What are Webhooks?"** — I've never heard of this
8. **"What is a Provider?"** — I thought this was about AI, not cloud services
9. **"How do I get started?"** — There's no onboarding or guide
10. **"What happens after I create a KB?"** — No guidance on next steps

---

## Real-World Task Simulation

### Task: "I want to add my website content so the AI can answer questions about it"

**Steps I took:**
1. Logged in ✓
2. Selected a company ✓ (but I didn't know what a "company" was)
3. Clicked "Knowledge Bases" ✓
4. Clicked "+ Create KB" ✓
5. Filled in the name ✓
6. Selected "WordPress" as source ✓ (but I have a regular website, not WordPress)
7. Tried to understand "Vector Store", "Embedding Model" — ❌ Confused
8. Gave up and closed the wizard

**Result:** FAILED — I couldn't complete the task because I didn't understand the technical requirements.

---

## Consistency Test

**Score: 4/5**

The application is generally consistent:
- ✅ Button styles are consistent
- ✅ Card layouts are consistent
- ✅ Form inputs are consistent
- ✅ Color scheme is consistent

**Inconsistencies:**
- Some pages use "Create" while others use "Add"
- Some pages have search, others don't
- Empty states vary in quality

---

## Learnability Test

**Score: 3/5**

After using the application for a while:
- ✅ Navigation becomes familiar
- ✅ Common actions (Create, Edit, Delete) are consistent
- ⚠️ Technical terminology remains confusing
- ⚠️ Workflows are not intuitive without documentation

---

## First-Time User Scores

| Feature | Score | Notes |
|---------|-------|-------|
| **Navigation** | 4/5 | Well-organized but too many options |
| **Dashboard** | 3/5 | Shows status but unclear what to do |
| **Knowledge Bases** | 3/5 | Good wizard but technical terms |
| **Assistants** | 2/5 | What are these? |
| **Chatbots** | 2/5 | How is this different from Assistants? |
| **Configuration** | 2/5 | Too many technical settings |
| **Providers** | 2/5 | What am I providing? |
| **Usage** | 3/5 | Shows stats but unclear what they mean |
| **Workflows** | 2/5 | What kind of workflows? |
| **Webhooks** | 1/5 | Completely unclear |

---

## Biggest Confusions

1. **What is this application for?** — The login page doesn't explain the purpose
2. **What is a "workspace" or "company"?** — The concept is unclear
3. **What is "Ingestion"?** — I expected "Upload" or "Import"
4. **What is the difference between Assistants and Chatbots?** — Seems redundant
5. **What is a "Vector Index"?** — I don't know why I need this
6. **What are "Providers"?** — I thought this was about AI, not cloud services
7. **What is "RAG"?** — The acronym is never explained
8. **What happens when I click "Ingest"?** — No explanation of the process
9. **How do I get my content into the system?** — The workflow is unclear
10. **What should I do after creating a KB?** — No guidance

---

## Biggest UX Problems

1. **No onboarding** — New users have no idea where to start
2. **Too much jargon** — Technical terms everywhere without explanations
3. **No help system** — No tooltips, no documentation links, no guides
4. **Unclear value proposition** — I don't know what this application does for me
5. **Complex workflows** — Simple tasks require many steps and technical knowledge

---

## Visual Problems

1. Some pages feel empty with too much whitespace
2. The sidebar could use icons for better recognition
3. Some buttons have inconsistent heights
4. Dropdowns can get cropped near screen edges

---

## Terminology Problems

**Critical terms that need simpler alternatives or explanations:**

| Current Term | Suggested Alternative | Or Add Tooltip |
|-------------|----------------------|----------------|
| Ingestion | Import / Sync | "Import content from your website" |
| Vector Index | Search Index | "Index that enables AI-powered search" |
| Embedding | AI Processing | "Convert text to AI-readable format" |
| Provider | AI Service | "Cloud AI service you're connected to" |
| RAG | AI Search | "AI-powered search and answer system" |
| Knowledge Base | Document Library | "Collection of documents for AI to reference" |
| Webhook | External Notification | "Send alerts to other services" |
| Endpoint | API Address | "URL where the AI service can be reached" |

---

## Workflow Problems

1. **Creating a KB** — Too many technical decisions (Vector Store, Embedding Model, Graph DB)
2. **Adding content** — "Ingestion" is confusing; should be "Import" or "Upload"
3. **Testing the AI** — "Ask Console" is unclear; should be "Test Chat" or "Try It"
4. **Connecting AI services** — "Providers" is vague; should be "AI Services" or "Connect AI"

---

## Positive Findings

1. ✅ The dark theme looks professional
2. ✅ The KB Create wizard is well-structured (5 steps)
3. ✅ The streaming AI responses are impressive
4. ✅ The company selector with search is well-designed
5. ✅ The profile menu with API docs and logs is convenient
6. ✅ The sidebar collapse/expand works smoothly
7. ✅ The theme toggle (Light/Dark) is easy to find
8. ✅ Loading states are generally good
9. ✅ Success toast notifications are helpful
10. ✅ The confirmation dialogs for destructive actions are clear

---

## Quick Wins

**These changes would provide the biggest UX improvement with minimal effort:**

1. **Add tooltips to all technical terms** — One-line explanations for jargon
2. **Rename "Ingestion" to "Import" or "Sync"** — More intuitive
3. **Add a "Getting Started" guide** — Step-by-step onboarding
4. **Explain the difference between Assistants and Chatbots** — Clear labels
5. **Add a "What's this?" link next to each sidebar item** — Quick explanations
6. **Show "What's next?" after completing actions** — Guide users to next steps
7. **Add a search bar to all list pages** — Consistent UX
8. **Simplify the KB Create wizard** — Fewer technical decisions
9. **Add examples in empty states** — Show what a completed setup looks like
10. **Add a help icon in the header** — Link to documentation

---

## Major Improvements

**Larger changes that would substantially improve usability:**

1. **Build an onboarding flow** — Walk new users through the first setup
2. **Create a "Simple Mode"** — Hide technical options for non-technical users
3. **Add a contextual help system** — Tooltips, guided tours, video tutorials
4. **Simplify the terminology throughout** — Use plain language everywhere
5. **Create template KBs** — Pre-configured setups for common use cases
6. **Add a "What does this do?" section to each page** — Explain the purpose
7. **Build a visual workflow builder** — Drag-and-drop instead of JSON config
8. **Add a chat-based setup wizard** — "Tell me about your website and I'll set it up"
9. **Create video tutorials** — Show real users how to complete tasks
10. **Add a feedback widget** — Let users report confusion directly

---

## Final Verdict

### 1. Can a first-time user understand the application?
**No.** The application assumes technical knowledge that most users don't have.

### 2. Can they navigate it without help?
**Partially.** The sidebar is organized, but the terms are confusing.

### 3. Can they complete the main tasks?
**Only with documentation.** The workflows require understanding technical concepts.

### 4. Do they understand errors?
**No.** Error messages are technical and don't explain what to do next.

### 5. Do they understand whether actions succeeded?
**Mostly.** Toast notifications help, but next steps are unclear.

### 6. Is the terminology appropriate?
**No.** The application is filled with technical jargon that would confuse most users.

### 7. Does the UI feel polished?
**Yes.** The visual design is professional and consistent.

### 8. Does anything feel unfinished?
**No.** The application feels complete, just overly technical.

### 9. What would make a user give up?
**The terminology and lack of onboarding.** A normal user would close the tab after seeing "Vector Index" and "Ingestion."

### 10. What are the top 5 things that should be fixed first?
1. Add tooltips/explanations for all technical terms
2. Rename "Ingestion" to "Import" or "Sync"
3. Add a "Getting Started" guide or onboarding flow
4. Explain the difference between Assistants and Chatbots
5. Add "What's next?" guidance after completing actions

---

## Conclusion

The PopularCert AI Admin Portal is a **powerful, well-built application** that is **clearly designed for technical users**. The visual design is professional, the workflows are logical, and the features are comprehensive.

However, for a **non-technical first-time user**, the application is **overwhelming and confusing**. The heavy use of technical jargon, lack of onboarding, and complex workflows would prevent most people from successfully using the application without documentation or training.

**To make this accessible to a wider audience, the application needs:**
1. A terminology simplification pass
2. An onboarding flow
3. Contextual help throughout
4. Plain-language alternatives for technical terms
5. Guided workflows for common tasks

**The good news:** The underlying functionality is solid. With better UX writing and some onboarding, this could be accessible to a much wider audience.
