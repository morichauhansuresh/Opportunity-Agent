# Opportunity AI Agent Demo

Client-demo Next.js application for the first phase of the Opportunity Agent.

## What it does

User enters natural language such as:

> Create an opportunity for Contoso worth 75K closing in October for CRM implementation.

The server-side API sends the prompt to the configured OpenAI model, converts it into a structured opportunity command, validates the response with Zod, and returns JSON to the UI.

This version does **not** execute CRM actions. It is the demo foundation for the next phase, where the validated command can call the existing Playwright/Dynamics automation.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example` and set:

```text
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5
```

3. Start the app:

```bash
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Push this project to GitHub.
2. Import the repository into Vercel.
3. Add `OPENAI_API_KEY` under Project Settings → Environment Variables.
4. Optionally add `OPENAI_MODEL` (default: `gpt-5`).
5. Deploy.

The OpenAI API key is only read by the server route and is never exposed through a `NEXT_PUBLIC_` variable.

## Next phase

Recommended integration:

```text
Prompt
  ↓
Opportunity Agent
  ↓
Validated OpportunityCommand
  ↓
createOpportunity(command)
  ↓
Existing Playwright automation
  ↓
Dynamics CRM
```
##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
