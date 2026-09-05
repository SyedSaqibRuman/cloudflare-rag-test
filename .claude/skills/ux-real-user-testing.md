# Skill: Real-User / Layman UX Testing

## Purpose

Test PopularCert AI as a completely non-technical first-time user.

## Philosophy

> **Think like a human, not a QA engineer.**

Do not ask: "Is the API working?"
Ask: **"Would I know that it worked?"**

Do not ask: "Is this component implemented correctly?"
Ask: **"Do I understand what this control does?"**

## Testing Approach

### 1. Start Fresh

Open the application as though you have never seen it before.

Answer:
- What do I think this application does?
- What is the first thing I think I should do?
- Is that obvious?
- What is the most important action?
- Do I understand the navigation?
- Do I understand the terminology?

### 2. Test Like a Real Person

For every feature:
1. Look at the screen
2. Decide what you think you should do
3. Click what seems most logical
4. Continue without assuming hidden functionality
5. If you make a mistake, see whether you can recover
6. See whether the application clearly explains what happened

### 3. Real-World Tasks

Test these tasks without documentation:

| Task | Expected Flow |
|------|---------------|
| "I want my AI to answer questions about my website" | Create KB → Ingest → Create Assistant → Test |
| "I want to create an AI assistant" | Go to Assistants → Create → Configure |
| "I want to put it on my website" | Create Chatbot → Get embed code |
| "I want to connect an AI service" | Go to Providers → Add credentials |
| "I want to automate something" | Go to Workflows → Create |
| "I want to check my usage" | Go to Usage → View stats |

### 4. Confusion Tracking

Record every moment where you think:
- "Hmm..."
- "Where is it?"
- "What does that mean?"
- "Why?"
- "What now?"
- "Did it work?"
- "Which one should I select?"
- "How do I get back?"

### 5. Scoring

Score each feature 1-5:

| Score | Meaning |
|-------|---------|
| 5 | Immediately understandable |
| 4 | Easy with minor hesitation |
| 3 | Understandable but requires thought |
| 2 | Confusing |
| 1 | Very difficult / impossible |

## What to Evaluate

### Terminology

| Term | Question |
|------|----------|
| Provider | Would a normal user understand this? |
| Model | Would a normal user understand this? |
| Embedding | Would a normal user understand this? |
| Vector Store | Would a normal user understand this? |
| Ingestion | Would a normal user understand this? |
| RAG | Would a normal user understand this? |
| Assistant | Would a normal user understand this? |
| Chatbot | Would a normal user understand this? |
| Knowledge Base | Would a normal user understand this? |

### Navigation

- Can I find what I need?
- Is the sidebar clear?
- Do I know where I am?
- Can I go back?

### Forms

- Do I understand what each field asks for?
- Do I know what information belongs here?
- Are required fields obvious?
- Do I understand error messages?

### Feedback

- Do I know that my action worked?
- Do I see confirmation?
- Do I understand what happened?

## Report Format

```markdown
## Overall Experience: X/10

## Could a First-Time User Use It?
- Yes, easily
- Yes, with some learning
- Only with documentation
- Very difficult
- No

## Top 10 Confusing Things
1. ...
2. ...

## Top 10 Things Done Well
1. ...
2. ...

## Most Confusing Terminology
| Term | Where | Why confusing | Suggestion |
|------|-------|---------------|------------|

## Quick Wins
1. ...
2. ...
```
