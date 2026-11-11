# Voice service

Planned. This small Node service will connect live Twilio call audio to OpenAI Realtime.

It runs outside Vercel, on Fly.io, Railway, or Render, because a phone call keeps one connection open for minutes. The client demo simulates calls, so this service is not needed yet.

It will use the same rules as the web app from `@vetrix/domain`.
