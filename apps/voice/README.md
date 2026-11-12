# Voice service

Planned. This small Node service will connect live Twilio call audio to Azure OpenAI Realtime.

It runs as its own Cloud Run service, because a phone call keeps one connection open for minutes (Cloud Run allows up to 60). In sandbox mode calls are simulated in the web app, so this service is built after the web app works end to end.

It will use the same rules as the web app from `@vetrix/domain`, and call the web app's internal API with a signed, per-call token.
