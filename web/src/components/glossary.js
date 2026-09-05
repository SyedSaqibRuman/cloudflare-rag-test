// --------------------------
// GLOSSARY — plain-language explanations for all technical terms.
// Used by tooltips throughout the application to help non-technical users.
// --------------------------

export const GLOSSARY = {
  // --- Knowledge Base terms ---
  "knowledge-base": {
    term: "Knowledge Base",
    short: "A collection of your content that the AI can search through",
    full: "A knowledge base stores your documents, website pages, or files. When someone asks a question, the AI searches this content to find relevant answers.",
  },
  "ingestion": {
    term: "Ingestion",
    short: "The process of importing your content into the system",
    full: "Ingestion reads your website, WordPress, or uploaded files, breaks them into small pieces (chunks), and stores them so the AI can search them later.",
  },
  "chunk": {
    term: "Chunk",
    short: "A small piece of your content used for searching",
    full: "Content is split into chunks (default 512 characters) so the AI can find the most relevant sections when answering questions, rather than searching entire documents.",
  },
  "chunk-size": {
    term: "Chunk Size",
    short: "How many characters each piece of content contains",
    full: "The maximum number of characters in each content piece. Smaller chunks = more precise search. Larger chunks = more context. Default is 512.",
  },
  "chunk-overlap": {
    term: "Chunk Overlap",
    short: "Characters shared between adjacent chunks for context",
    full: "The number of characters that overlap between consecutive chunks. This ensures important information at chunk boundaries isn't lost.",
  },
  "retrieval-top-k": {
    term: "Top K",
    short: "How many search results to consider when answering",
    full: "The number of most relevant content pieces to retrieve when answering a question. More = broader context. Fewer = more focused answers.",
  },
  "retrieval-score-threshold": {
    term: "Similarity Threshold",
    short: "Minimum relevance score for search results",
    full: "Content pieces must score above this threshold to be included. Higher = only very relevant content. Lower = more content included.",
  },
  "hybrid-search": {
    term: "Hybrid Search",
    short: "Combines AI-powered search with keyword matching",
    full: "Uses both semantic (meaning-based) search and keyword matching to find the most relevant content. More accurate than either method alone.",
  },

  // --- Vector / Embedding terms ---
  "vector-index": {
    term: "Vector Index",
    short: "The AI's search database for finding relevant content",
    full: "A vector index stores numerical representations (vectors) of your content. When a question is asked, it finds the most similar vectors to locate relevant answers.",
  },
  "embedding-model": {
    term: "Embedding Model",
    short: "The AI that converts text into searchable vectors",
    full: "An embedding model converts your text into numerical vectors that can be compared for similarity. This is how the AI understands which content matches a question.",
  },
  "embedding": {
    term: "Embedding",
    short: "A numerical representation of text that captures meaning",
    full: "An embedding is a list of numbers that represents the meaning of a piece of text. Similar texts have similar numbers, enabling semantic search.",
  },
  "dimensions": {
    term: "Dimensions",
    short: "The size of the vector representation",
    full: "The number of numerical values used to represent each piece of content. More dimensions = more precise but uses more storage.",
  },
  "vector-store": {
    term: "Vector Store",
    short: "Where the AI stores searchable content representations",
    full: "A vector store (like Cloudflare Vectorize, Pinecone, or Qdrant) holds all the numerical representations of your content for fast similarity search.",
  },

  // --- AI / Model terms ---
  "provider": {
    term: "AI Provider",
    short: "A service that provides AI capabilities (like Cloudflare, OpenAI)",
    full: "An AI provider is a company or service that offers AI models for text generation, embeddings, and other AI tasks. You connect your account to use their services.",
  },
  "model": {
    term: "AI Model",
    short: "The specific AI system that generates answers",
    full: "An AI model is the specific algorithm that processes questions and generates answers. Different models have different capabilities and costs.",
  },
  "temperature": {
    term: "Temperature",
    short: "How creative vs. factual the AI's answers are",
    full: "Controls randomness in AI responses. 0 = very factual and consistent. 1 = more creative and varied. For business use, 0-0.3 is recommended.",
  },
  "max-tokens": {
    term: "Max Tokens",
    short: "Maximum length of the AI's response",
    full: "The maximum number of words/tokens the AI can use in a single response. More tokens = longer answers but higher cost.",
  },
  "system-prompt": {
    term: "System Prompt",
    short: "Instructions that define how the AI behaves",
    full: "A set of instructions that tells the AI how to act, what tone to use, and how to format answers. Think of it as the AI's personality and rules.",
  },
  "function-calling": {
    term: "Function Calling",
    short: "Allow the AI to use tools and take actions",
    full: "When enabled, the AI can call external tools and APIs to perform actions like looking up data, sending emails, or updating records.",
  },
  "streaming": {
    term: "Streaming",
    short: "Show the AI's response word-by-word as it's generated",
    full: "Instead of waiting for the full answer, streaming shows each word as it's generated. This makes the AI feel faster and more responsive.",
  },

  // --- Storage terms ---
  "r2-bucket": {
    term: "R2 Bucket",
    short: "Cloud storage for your original documents",
    full: "An R2 bucket stores the original content files (documents, pages, chunks) so they can be retrieved when the AI finds a relevant answer.",
  },
  "object-storage": {
    term: "Object Storage",
    short: "Cloud storage for files and documents",
    full: "A service for storing files and documents in the cloud. Used to keep original content that the AI can reference when answering questions.",
  },

  // --- Graph / Knowledge Graph terms ---
  "graph-rag": {
    term: "Graph RAG",
    short: "Uses a knowledge graph to understand relationships",
    full: "Graph RAG (Retrieval-Augmented Generation) uses a knowledge graph to understand how concepts relate to each other, providing more connected and contextual answers.",
  },
  "graph-database": {
    term: "Graph Database",
    short: "Stores relationships between concepts",
    full: "A database that stores data as nodes (concepts) and edges (relationships). Used to understand how different pieces of information connect.",
  },
  "neo4j": {
    term: "Neo4j",
    short: "A graph database for storing knowledge relationships",
    full: "Neo4j is a popular graph database used to store and query relationships between concepts in your knowledge base.",
  },

  // --- Assistant / Chatbot terms ---
  "assistant": {
    term: "Assistant",
    short: "An AI configuration that combines your knowledge with an AI model",
    full: "An assistant is a configured AI that knows your content and follows your instructions. It's the 'brain' that answers questions.",
  },
  "persona": {
    term: "Persona",
    short: "The personality and behavior of your AI assistant",
    full: "The persona defines how your AI communicates — its tone, expertise level, and how it presents information.",
  },
  "fallback": {
    term: "Fallback",
    short: "What happens when the AI doesn't know the answer",
    full: "A fallback response is shown when the AI can't find relevant information in your knowledge base to answer a question.",
  },

  // --- Workflow / Automation terms ---
  "workflow": {
    term: "Workflow",
    short: "An automated sequence of AI tasks",
    full: "A workflow is a series of automated steps that run on a schedule or triggered by events. For example: automatically ingest new content every day.",
  },
  "webhook": {
    term: "Webhook",
    short: "An automated notification sent to another service",
    full: "A webhook sends a notification to a URL when something happens (like ingestion completing). Used to integrate with other tools.",
  },
  "scheduler": {
    term: "Scheduler",
    short: "Runs tasks automatically on a schedule",
    full: "The scheduler lets you set up recurring tasks like daily content imports or periodic health checks, so you don't have to do them manually.",
  },
  "trigger": {
    term: "Trigger",
    short: "An event that starts a workflow",
    full: "A trigger is an event that causes a workflow to run. Examples: a schedule (cron), a webhook call, or a manual button click.",
  },
  "cron": {
    term: "Cron Schedule",
    short: "A time-based schedule for recurring tasks",
    full: "A cron expression defines when a task should run automatically. For example: '0 2 * * *' means 'every day at 2 AM'.",
  },

  // --- Workspace / Company terms ---
  "company": {
    term: "Workspace",
    short: "An isolated environment for one organization",
    full: "A workspace (also called a company) is a separate environment with its own knowledge bases, assistants, and settings. Each organization gets its own workspace.",
  },
  "tenant": {
    term: "Tenant",
    short: "A customer or organization using the platform",
    full: "A tenant is an organization or customer that uses the platform. Each tenant has their own workspace with separate data and configuration.",
  },
  "multi-tenant": {
    term: "Multi-Tenant",
    short: "Supports multiple organizations on one platform",
    full: "The platform can serve multiple organizations simultaneously, keeping each one's data, AI models, and configurations completely separate.",
  },

  // --- Usage / Cost terms ---
  "token": {
    term: "Token",
    short: "A unit of text used for AI processing and billing",
    full: "Tokens are small pieces of text (roughly 3/4 of a word). AI models process text in tokens, and you're billed based on how many tokens are used.",
  },
  "input-tokens": {
    term: "Input Tokens",
    short: "Tokens in the question and context sent to the AI",
    full: "The tokens used in your question and the retrieved content. More context = more input tokens = higher cost.",
  },
  "output-tokens": {
    term: "Output Tokens",
    short: "Tokens in the AI's response",
    full: "The tokens in the AI's generated answer. Longer answers use more output tokens.",
  },
  "latency": {
    term: "Latency",
    short: "How long the AI takes to respond",
    full: "The time between sending a question and receiving the first word of the response. Lower latency = faster, more responsive AI.",
  },
  "cost-usd": {
    term: "Cost",
    short: "The dollar amount charged for AI usage",
    full: "The actual cost in US dollars for using AI models. Based on the number of tokens processed and the model's pricing.",
  },

  // --- Cloud / Infrastructure terms ---
  "cloudflare": {
    term: "Cloudflare",
    short: "A cloud platform providing AI, storage, and search services",
    full: "Cloudflare is a cloud platform that provides the AI models, vector search (Vectorize), and file storage (R2) used by this platform.",
  },
  "api-key": {
    term: "API Key",
    short: "A secret code that authenticates your account with a service",
    full: "An API key is a secret token that proves your identity when calling external services. Keep it private — it's like a password for your account.",
  },
  "api-token": {
    term: "API Token",
    short: "A credential for accessing cloud services",
    full: "An API token is used to authenticate requests to cloud services like Cloudflare. It controls what your application can access.",
  },
  "account-id": {
    term: "Account ID",
    short: "Your unique identifier with a cloud provider",
    full: "The unique identifier for your account with a cloud provider (like Cloudflare). Used to route requests to the correct account.",
  },
  "endpoint": {
    term: "Endpoint",
    short: "A URL where a service can be accessed",
    full: "An endpoint is a specific URL where you can send requests to a service. For example, the URL for the AI model or the vector search API.",
  },
  "resource": {
    term: "Resource",
    short: "A cloud service or component you've set up",
    full: "A resource is any cloud service or component you've created, like a vector index, storage bucket, or graph database.",
  },

  // --- RAG Pipeline terms ---
  "rag": {
    term: "RAG",
    short: "Retrieval-Augmented Generation — search then answer",
    full: "RAG is a technique where the AI first searches your knowledge base for relevant information, then generates an answer using that information. This ensures answers are based on your actual content.",
  },
  "semantic-search": {
    term: "Semantic Search",
    short: "Search by meaning, not just keywords",
    full: "Semantic search understands the meaning behind a question, not just exact keyword matches. 'How do I get certified?' would match content about 'certification process'.",
  },
  "context-window": {
    term: "Context Window",
    short: "How much information the AI can consider at once",
    full: "The maximum amount of text the AI can process in a single request, including the question, retrieved content, and instructions. Larger = more context but higher cost.",
  },
  "reranking": {
    term: "Reranking",
    short: "Reordering search results by relevance",
    full: "After initial search, reranking uses a more precise model to reorder results by how relevant they actually are to the question.",
  },
  "similarity": {
    term: "Similarity Score",
    short: "How closely a piece of content matches the question",
    full: "A number between 0 and 1 indicating how relevant a piece of content is to the question. Higher = more relevant. The threshold determines what gets included.",
  },
};

// ------------------------------------------------------------------
// Helper: get glossary entry by key
// ------------------------------------------------------------------
export function getGlossaryEntry(key) {
  return GLOSSARY[key] || null;
}

// ------------------------------------------------------------------
// Helper: get tooltip content for a term
// ------------------------------------------------------------------
export function getTermTooltip(key, level = "short") {
  const entry = GLOSSARY[key];
  if (!entry) return null;
  return level === "full" ? entry.full : entry.short;
}

// ------------------------------------------------------------------
// List of all term keys for quick reference
// ------------------------------------------------------------------
export const TERM_KEYS = Object.keys(GLOSSARY);
