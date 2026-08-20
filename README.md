# Opportunity AI Agent Demo

Client-demo Next.js application for the first phase of the Opportunity Agent.

## What it does

User enters natural language such as:

> Create an opportunity for Contoso worth 75K closing in October for CRM implementation.

The server-side API sends the prompt to Cursor's Cloud Agents API, converts it into a structured opportunity command, validates the response with Zod, and returns JSON to the UI.

This version does **not** execute CRM actions. It is the demo foundation for the next phase, where the validated command can call the existing Playwright/Dynamics automation.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.example` and set:

```text
CURSOR_API_KEY=your_cursor_api_key
```

3. Start the app:

```bash
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Add `CURSOR_API_KEY` under Project Settings → Environment Variables.
3. Keep the key server-side only; never use a `NEXT_PUBLIC_` variable for it.
4. Deploy.

The application uses Cursor as the default AI provider. Cursor's current Cloud Agents API accepts user API keys created from Cursor Dashboard → API Keys and supports no-repository agents, which is what this demo uses. See the Cursor Cloud Agents API documentation for current API details.

## Next phase

Recommended integration:

```text
Prompt
  ↓
Cursor Opportunity Agent
  ↓
Validated OpportunityCommand
  ↓
createOpportunity(command)
  ↓
Existing Playwright automation
  ↓
Dynamics CRM
```
