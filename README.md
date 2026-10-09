# Women Tech Quest 2026

Built with Next.js 16 (TypeScript, Tailwind CSS), powered by **Gemini 3.5 Flash-Lite** (`gemini-3.5-flash-lite`).

## Setup
```
npm install
copy .env.example .env   # then put your Gemini API key in .env
```

## Run
```
npm run test:api   # check the API key
npm run dev        # start the app at http://localhost:3000
```

## How it fits together
- `src/app/page.tsx`: the page in the browser. It sends the prompt to `/api/ask`.
- `src/app/api/ask/route.ts`: the backend endpoint (like a Spring controller). It calls Gemini.
- `src/lib/gemini.ts`: `ask(prompt, system)`, the one place that talks to Gemini. The API key is only read here, on the server.
