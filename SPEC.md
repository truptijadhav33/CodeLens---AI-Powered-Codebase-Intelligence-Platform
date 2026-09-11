# CodeLens — AI-Powered Codebase Intelligence Platform

## 1. Problem Statement

Modern software applications are increasingly large and complex. Development teams often work with repositories containing thousands of files, multiple modules, third-party dependencies, APIs, databases, authentication layers, tests, and interconnected components.

For a developer joining an existing project, understanding such a codebase can be difficult and time-consuming. Developers typically have to manually explore files, trace dependencies, understand unfamiliar functions, inspect Git history, identify technical debt, and search through incomplete documentation before they can confidently make changes.

Existing developer tools provide assistance while writing or reviewing individual pieces of code, but developers still lack a centralized way to understand the overall architecture, health, behavior, and evolution of an entire repository.

**Core problem:** Developers need a faster way to answer questions such as: How does this codebase work? Where is authentication implemented? Which modules depend on each other? Which parts are difficult to maintain? Where is technical debt accumulating? What changed recently? Which areas should be understood before modifying a feature? Can useful documentation be generated automatically?

## 2. Proposed Solution

CodeLens is an AI-powered codebase intelligence platform that connects to a developer's GitHub repository, analyzes its source code and project structure, and converts the repository into an understandable, searchable, and measurable representation.

Rather than trying to replace an AI coding assistant, CodeLens focuses on repository-level intelligence: understanding architecture, measuring code health, identifying technical debt, tracking repository evolution, generating documentation, and allowing developers to ask context-aware questions about their own codebase.

**Core value proposition:** CodeLens helps developers understand, analyze, and track a software codebase from one centralized platform.

## 3. Core Features

1. **GitHub Repository Integration** — Users authenticate with GitHub, select a repository they are authorized to access, and CodeLens retrieves repository metadata and relevant source files.
2. **Repository & Technology Analysis** — Identify languages, frameworks, folders, modules, APIs, authentication mechanisms, dependencies, tests, and important configuration files.
3. **Codebase Health Dashboard** — Present measurable engineering signals such as maintainability, complexity, security findings, testing, documentation, and dependency health.
4. **Architecture & Dependency Visualization** — Build relationships between files and modules and present an interactive architecture/dependency view.
5. **AI Codebase Q&A** — Developers ask questions such as where authentication is implemented or how an order flow works. Relevant repository context is retrieved before the AI generates an answer.
6. **Technical Debt & Issue Detection** — Use deterministic analysis to identify duplicated logic, high complexity, missing tests, lint issues, dependency concerns, and maintainability problems; use AI to explain impact and suggest improvements.
7. **Repository Evolution** — Compare analysis results across repository versions and show how code quality and engineering metrics change over time.
8. **AI Documentation Generation** — Generate project overviews, architecture explanations, API descriptions, module summaries, setup information, and contribution guidance.

## 4. High-Level System Workflow

| Stage | What happens |
|---|---|
| 1. Authentication | User signs in with GitHub and authorizes repository access. |
| 2. Repository Ingestion | Node/Express backend retrieves repository metadata and source files through the GitHub API. |
| 3. Code Parsing | Source files are parsed to identify structure, imports, exports, symbols, and relationships. |
| 4. Static Analysis | Deterministic tools calculate metrics and detect measurable code-quality issues. |
| 5. Dependency Analysis | Relationships between modules, files, and packages are constructed. |
| 6. Retrieval / RAG | Relevant repository content is prepared and retrieved for AI questions. |
| 7. AI Analysis | Gemini API explains findings, answers repository questions, summarizes changes, and generates documentation. |
| 8. Dashboard | React presents health metrics, issues, architecture, history, and AI insights. |

## 5. Tech Stack (MERN + AI)

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React.js + Vite | Dashboard, repository explorer, AI chat, issue views, analytics. |
| UI | Tailwind CSS | Responsive and consistent interface. |
| Visualization | React Flow | Interactive architecture and dependency graphs. |
| Backend | Node.js + Express.js | REST APIs, authentication, repository processing, analysis orchestration, and AI integration. |
| Database | MongoDB Atlas | Users, repositories, analyses, issues, metrics, chat history, and generated documentation. |
| GitHub | GitHub OAuth + REST API | Authentication and authorized access to public/private repositories, metadata, commits, branches, and files. |
| AI | Gemini API | Code explanations, repository Q&A, summaries, recommendations, and documentation generation. |
| RAG | Embeddings + Vector Search | Retrieve relevant repository context before sending a question to Gemini. |
| Static Analysis | ESLint + custom JavaScript analysis | Deterministic quality, maintainability, and code-structure checks. |
| Auth | GitHub OAuth + JWT/session authentication | Secure user authentication and repository authorization. |
| Background Processing | Node.js worker (optional) | Run long repository analysis without blocking API requests. |
| Deployment | Vercel + a suitable free-tier backend host | Deploy the React frontend and Node/Express backend. |

## 6. AI Architecture

CodeLens should not use AI for every analysis task. It combines deterministic software-engineering analysis with AI reasoning.

- **Deterministic layer:** file metrics, complexity, dependency relationships, lint errors, package information, and other measurable signals.
- **AI layer:** contextual explanations, repository Q&A, refactoring recommendations, technical-debt explanations, change summaries, and documentation generation.
- **RAG flow:** repository files are processed into searchable chunks. For a user question, CodeLens retrieves relevant repository context and supplies it to the Gemini API so the answer is grounded in the user's codebase rather than relying only on general model knowledge.

**Deployment choice:** Gemini API is used instead of Ollama for the public deployment architecture because AI inference must work for users who open the deployed CodeLens website. Ollama may be used locally for experimentation, but it is not required by the production architecture.

## 7. MVP Scope

- User authentication with GitHub OAuth
- Connect and select an authorized GitHub repository
- Repository ingestion and basic code parsing
- Static code-quality analysis
- Codebase health dashboard
- Basic dependency and architecture visualization
- AI-powered codebase Q&A using RAG + Gemini API
- Issue explanations and recommendations
- Basic generated project documentation
- Deployable React + Node/Express application

## 8. Future Enhancements

- GitHub webhook-based automatic re-analysis
- Pull request analysis
- Team workspaces and role-based access
- Historical engineering-health trends
- AI-generated refactoring plans
- Custom quality rules
- CI/CD quality gates
- Support for multiple programming languages
- AI provider fallback such as Groq/OpenRouter

## 9. Cost & Deployment Strategy

The project is designed to be developed and demonstrated at $0 using free tiers and open-source tooling where practical. Gemini API can be used within its available free usage limits. Free-tier limits are not unlimited, so public usage should be rate-limited and protected with authentication, quotas, and repository-size limits.

The key deployment requirement is that users must be able to analyze remote GitHub repositories without installing software locally. Therefore, AI inference is handled through a cloud AI API rather than requiring Ollama on the user's machine.

## 10. Final Project Definition

CodeLens is a full-stack AI-powered developer platform that analyzes GitHub repositories to help developers understand how a codebase works, measure its engineering health, identify technical debt and quality issues, visualize architecture and dependencies, track repository evolution, generate documentation, and interact with the codebase through context-aware AI Q&A.

The project is intentionally positioned as a **codebase intelligence and developer productivity platform**, rather than a generic AI code-generation or Copilot clone.

---

## Build Status Log

Use this section to track progress across vibe coding sessions.

- [x] Phase 0 — Project scaffolding
- [x] Phase 1 — GitHub OAuth + Auth
- [x] Phase 2 — Repository Ingestion
- [x] Phase 3 — Code Parsing + Static Analysis
- [x] Phase 4 — Dependency Graph + Visualization
- [x] Phase 5 — RAG + Gemini Q&A
- [x] Phase 6 — Technical Debt Detection + AI Explanations
- [x] Phase 7 — AI Documentation Generation
- [ ] Phase 8 — Dashboard Polish + Deploy
