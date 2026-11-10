# web-site
the only website you'll ever need.

"vi ska ha med allt... allt" - BiN

## Groq AI demo

The menu's **Groq AI demo** sends prompts to Groq's `openai/gpt-oss-120b` model through `/api/groq-chat`. The API key stays on the server; set `GROQ_API_KEY` in the environment used to start OpenResty, then restart OpenResty. The endpoint accepts prompts up to 2000 bytes and is rate-limited per client IP.
